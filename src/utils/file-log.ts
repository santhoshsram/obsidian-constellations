/**
 * A file-backed, debounced log store.
 *
 * Appended lines are buffered in memory and written to a single text
 * file on a trailing debounce (and on explicit flush), preserving any
 * content that already existed in the file across sessions. This lets
 * plugin logs be grepped from disk instead of only the console.
 */

export interface LogTextStore {
	read(): Promise<string | null>;
	write(content: string): Promise<void>;
}

export class BufferedLogFile {
	private lines: string[] = [];
	private timer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		private store: LogTextStore,
		private flushMs = 1000,
		private maxLines = 5000,
	) {}

	/** Load any pre-existing content from the store (capped at maxLines). */
	async init(): Promise<void> {
		const existing = await this.store.read();
		if (existing) {
			const parsed = existing.split('\n').filter((l) => l.length > 0);
			this.lines =
				parsed.length > this.maxLines
					? parsed.slice(-this.maxLines)
					: parsed;
		}
	}

	/** Copy of the currently buffered lines (for tests / inspection). */
	snapshot(): string[] {
		return [...this.lines];
	}

	/** Buffer a formatted log line (rotating FIFO at maxLines) and schedule a debounced flush. */
	append(line: string): void {
		this.lines.push(line);
		if (this.lines.length > this.maxLines) {
			this.lines.shift();
		}
		if (this.timer) {
			clearTimeout(this.timer);
		}
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.flush();
		}, this.flushMs);
	}

	/** Write all buffered lines (plus pre-existing content) to the file. */
	async flush(): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		if (this.lines.length === 0) {
			return;
		}
		await this.store.write(this.lines.join('\n') + '\n');
	}

	/** Clear all in-memory lines and overwrite the file store with empty content. */
	async clear(): Promise<void> {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
		this.lines = [];
		await this.store.write('');
	}

	/** Cancel any pending flush (e.g. on plugin unload without save). */
	dispose(): void {
		if (this.timer) {
			clearTimeout(this.timer);
			this.timer = null;
		}
	}
}