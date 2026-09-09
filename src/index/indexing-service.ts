/**
 * Orchestrates indexing: chunks files, embeds new chunks via the
 * embedder, keeps per-file content hashes for incremental syncs, and
 * exposes the state that gets persisted alongside the index.
 *
 * IO is behind the `VaultSource` interface so tests run against an
 * in-memory fake; the plugin wires it to Obsidian's vault API.
 */

import { chunkMarkdown } from '../chunking/chunker';
import type { TokenCounter } from '../chunking/tokens';
import type { Embedder } from '../embed/embedder';
import type { EmbeddingModelSpec } from '../embed/models';
import { sha1Hex } from './hasher';
import { diffVaultFiles } from './vault-scan';
import type { ChunkIndex } from './chunk-index';
import type { IndexState } from './persistence';

export interface VaultSource {
	listMarkdown(): Promise<string[]>;
	read(path: string): Promise<string>;
}

export interface SyncResult {
	indexed: number;
	removed: number;
	skipped: number;
}

export interface IndexingProgress {
	(done: number, total: number, path: string): void;
}

export class IndexingService {
	private fileHashes: Record<string, string> = {};

	constructor(
		private index: ChunkIndex,
		private embedder: Embedder,
		private counter: TokenCounter,
		private model: EmbeddingModelSpec,
	) {}

	/** Chunk + embed + index a single file, and record its hash. */
	async indexFile(path: string, content: string): Promise<void> {
		const chunks = chunkMarkdown(
			path,
			content,
			this.counter,
			this.model.maxTokensPerChunk,
		);
		await this.index.updateFile(path, chunks, (texts) =>
			this.embedder.embedDocuments(texts),
		);
		this.fileHashes[path] = await sha1Hex(content);
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
		for (const path of paths) {
			const content = await vault.read(path);
			contents.set(path, content);
			current[path] = await sha1Hex(content);
		}

		const { toIndex, toRemove } = diffVaultFiles(current, this.fileHashes);

		for (const path of toRemove) {
			this.removeFile(path);
		}

		let done = 0;
		for (const path of toIndex) {
			const content = contents.get(path);
			if (content !== undefined) {
				await this.indexFile(path, content);
			}
			done++;
			progress?.(done, toIndex.length, path);
		}

		return {
			indexed: toIndex.length,
			removed: toRemove.length,
			skipped: paths.length - toIndex.length,
		};
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
