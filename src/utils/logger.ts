/**
 * Minimal leveled logger for observable indexing.
 *
 * Lines are prefixed with the plugin tag and an elapsed-ms timestamp
 * (since process start) so gaps in time are visible in the console.
 * `debug`/`info` are gated by `enabled`; `warn`/`error` always emit so
 * regressions can never be hidden by a toggle.
 */

export interface LoggerOptions {
	enabled: boolean;
	/** Millisecond threshold before a single file is flagged as slow. */
	slowFileMs?: number;
	/**
	 * Optional file-style sink: every emitted (formatted) line is also
	 * forwarded here, so logs can be written to disk for greppability.
	 */
	sink?: (line: string) => void;
}

export interface Logger {
	enabled: boolean;
	debug(message: string, ...args: unknown[]): void;
	info(message: string, ...args: unknown[]): void;
	warn(message: string, ...args: unknown[]): void;
	error(message: string, ...args: unknown[]): void;
	/** Optional file-style sink with a final flush (e.g. on unload). */
	flushSink?(): void | Promise<void>;
	/** Replace the file-style sink at runtime (e.g. once plugin dir is known). */
	setSink?(sink: (line: string) => void): void;
}

/** @internal elapsed ms since the caller set the origin (default: load time). */
export function elapsed(origin = performance.now()): string {
	return `+${Math.round(performance.now() - origin)}ms`;
}

export class ConsoleLogger implements Logger {
	enabled: boolean;
	private origin: number;
	private tag: string;
	private sink?: (line: string) => void;
	/** Lines emitted before a sink attaches (flushed on setSink). */
	private pending: string[] = [];
	private static readonly PENDING_CAP = 5000;

	constructor(
		tag = 'obsidian-brain',
		options: LoggerOptions = { enabled: false },
	) {
		this.tag = tag;
		this.enabled = options.enabled;
		this.slowFileMs = options.slowFileMs ?? 2000;
		this.origin = performance.now();
		this.sink = options.sink;
	}

	/** @internal slow-file threshold, used by the indexing service. */
	readonly slowFileMs: number;

	setSink(sink: (line: string) => void): void {
		this.sink = sink;
		if (this.pending.length > 0) {
			for (const line of this.pending) {
				sink(line);
			}
			this.pending = [];
		}
	}

	debug(message: string, ...args: unknown[]): void {
		if (this.enabled) this.emit('debug', console.debug, message, args);
	}

	info(message: string, ...args: unknown[]): void {
		// console.info is not in obsidianmd's allowed methods, so debug it.
		this.emit('info', console.debug, message, args);
	}

	warn(message: string, ...args: unknown[]): void {
		this.emit('warn', console.warn, message, args);
	}

	error(message: string, ...args: unknown[]): void {
		this.emit('error', console.error, message, args);
	}

	private emit(
		level: 'debug' | 'info' | 'warn' | 'error',
		fn: (...args: unknown[]) => void,
		message: string,
		args: unknown[],
	): void {
		const line = `[${this.tag}] ${elapsed(this.origin)} ${level} ${message}`;
		fn(line, ...args);
		const full = args.length ? `${line} ${jsonPreview(args)}` : line;
		if (this.sink) {
			this.sink(full);
		} else if (this.pending.length < ConsoleLogger.PENDING_CAP) {
			this.pending.push(full);
		}
	}
}

/** Compact JSON preview of extra args for the log file. */
function jsonPreview(args: unknown[]): string {
	try {
		return JSON.stringify(args);
	} catch {
		return String(args);
	}
}
