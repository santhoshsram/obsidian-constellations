/**
 * Orchestrates indexing: chunks files, embeds new chunks via the
 * embedder, keeps per-file content hashes for incremental syncs, and
 * exposes the state that gets persisted alongside the index.
 *
 * IO is behind the `VaultSource` interface so tests run against an
 * in-memory fake; the plugin wires it to Obsidian's vault API.
 *
 * Instrumentation: logs per-file timing/throughput, flags slow files,
 * emits embedding progress within a file (heartbeat), and reports
 * failure forensics (stage + underlying error) so slow or failing
 * files can be diagnosed from the console.
 */

import { chunkMarkdown } from '../chunking/chunker';
import type { NewChunk } from './chunk-index';
import type { TokenCounter } from '../chunking/tokens';
import type { Embedder } from '../embed/embedder';
import type { EmbeddingModelSpec } from '../embed/models';
import { sha1Hex } from './hasher';
import { diffVaultFiles } from './vault-scan';
import type { ChunkIndex } from './chunk-index';
import type { IndexState } from './persistence';
import type { Logger } from '../utils/logger';

export interface VaultSource {
	listMarkdown(): Promise<string[]>;
	read(path: string): Promise<string>;
}

export interface SyncResult {
	indexed: number;
	removed: number;
	skipped: number;
	/** Files that failed to read or index (skipped, not fatal). */
	failed: number;
	/** Total files found in vault. */
	total: number;
}

export interface IndexingProgress {
	(done: number, total: number, path: string): void;
}

export interface IndexingOptions {
	/** Warn when a single file takes longer than this to index (ms). */
	slowFileMs?: number;
	/** Log embedding progress within a file after this many ms. */
	heartbeatMs?: number;
}

const noopLogger: Logger = {
	enabled: false,
	debug: () => {},
	info: () => {},
	warn: () => {},
	error: () => {},
};

export class IndexingService {
	private fileHashes: Record<string, string> = {};
	private logger: Logger;
	private slowFileMs: number;
	private heartbeatMs: number;

	constructor(
		private index: ChunkIndex,
		private embedder: Embedder,
		private counter: TokenCounter,
		private model: EmbeddingModelSpec,
		logger?: Logger,
		options: IndexingOptions = {},
	) {
		this.logger = logger ?? noopLogger;
		this.slowFileMs = options.slowFileMs ?? 2000;
		this.heartbeatMs = options.heartbeatMs ?? 5000;
	}

	/** Chunk + embed + index a single file, and record its hash. */
	async indexFile(path: string, content: string): Promise<void> {
		const started = performance.now();
		let chunks: NewChunk[];
		try {
			chunks = chunkMarkdown(
				path,
				content,
				this.counter,
				this.model.maxTokensPerChunk,
			);
		} catch (e) {
			this.logger.error(
				`failed to chunk ${path}`,
				{ kind: 'index-failure', stage: 'chunk' },
				e,
			);
			throw e;
		}
		const chunkMs = performance.now() - started;

		const embedStarted = performance.now();
		try {
			await this.index.updateFile(path, chunks, (texts) =>
				this.embedWithHeartbeat(path, texts),
			);
		} catch (e) {
			this.logger.error(
				`failed to embed ${path}`,
				{ kind: 'index-failure', stage: 'embed' },
				e,
			);
			throw e;
		}
		const embedMs = performance.now() - embedStarted;

		this.fileHashes[path] = await sha1Hex(content);

		const total = chunkMs + embedMs;
		if (total > this.slowFileMs) {
			this.logger.debug(
				`slow file ${path} chunks=${chunks.length} ` +
					`chunkMs=${Math.round(chunkMs)} embedMs=${Math.round(embedMs)} ` +
					`totalMs=${Math.round(total)}`,
				{ kind: 'slow-file' },
			);
		}
	}

	/** Embed a batch in slices, emitting a heartbeat when it runs long. */
	private async embedWithHeartbeat(
		path: string,
		texts: string[],
	): Promise<Float32Array[]> {
		const started = performance.now();
		const batchSize = this.model.batchSize;
		const totalBatches = Math.ceil(texts.length / batchSize);
		const out: Float32Array[] = [];
		for (let b = 0; b < totalBatches; b++) {
			const batch = texts.slice(b * batchSize, (b + 1) * batchSize);
			const vecs = await this.embedder.embedDocuments(batch);
			out.push(...vecs);
			if (performance.now() - started > this.heartbeatMs) {
				this.logger.debug(
					`embedding ${path} batch ${b + 1}/${totalBatches} ` +
						`(done=${(b + 1) * batch.length}/${texts.length}) ` +
						`elapsed=${Math.round(performance.now() - started)}ms`,
				);
			}
		}
		return out;
	}

	removeFile(path: string): void {
		this.index.removeFile(path);
		delete this.fileHashes[path];
	}

	/**
	 * Bring the index in line with the vault: index new/changed files,
	 * drop removed ones, skip unchanged ones.
	 */
	async syncVault(
		vault: VaultSource,
		progress?: IndexingProgress,
	): Promise<SyncResult> {
		const paths = await vault.listMarkdown();
		const current: Record<string, string> = {};
		const contents = new Map<string, string>();
		let failed = 0;
		for (const path of paths) {
			try {
				const content = await vault.read(path);
				contents.set(path, content);
				current[path] = await sha1Hex(content);
			} catch (e) {
				failed++;
				this.logger.warn(
					`failed to read ${path} (skipping)`,
					{ kind: 'read-failure' },
					e,
				);
			}
		}

		const { toIndex, toRemove } = diffVaultFiles(current, this.fileHashes);

		for (const path of toRemove) {
			this.removeFile(path);
		}

		const syncStarted = performance.now();
		let done = 0;
		let indexed = 0;
		for (const path of toIndex) {
			const content = contents.get(path);
			if (content !== undefined) {
				try {
					await this.indexFile(path, content);
					indexed++;
				} catch (e) {
					failed++;
					this.logger.warn(
						`failed to index ${path} (skipping)`,
						{ kind: 'index-failure' },
						e,
					);
				}
			}
			done++;
			progress?.(done, toIndex.length, path);
		}

		const summary: SyncResult = {
			indexed,
			removed: toRemove.length,
			skipped: paths.length - toIndex.length - failed,
			failed,
			total: paths.length,
		};
		this.logger.info(
			`sync complete - ${paths.length} files: new=${indexed} ` +
				`removed=${summary.removed} skipped=${summary.skipped} ` +
				`failed=${failed} elapsed=${Math.round(performance.now() - syncStarted)}ms`,
		);
		return summary;
	}

	getState(): IndexState {
		return {
			modelId: this.model.modelId,
			dimensions: this.model.dimensions,
			fileHashes: { ...this.fileHashes },
		};
	}

	setState(state: IndexState): void {
		this.fileHashes = { ...state.fileHashes };
	}
}
