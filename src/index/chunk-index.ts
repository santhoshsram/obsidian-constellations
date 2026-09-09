/**
 * In-memory index of chunk records aligned with vector-store rows.
 *
 * Chunk identity is content-addressed: `id = sha1(text)`. An embedding
 * cache (id → vector) lets unchanged chunks keep their embeddings across
 * edits, renames, and duplicate content in other files — only genuinely
 * new text is ever embedded. The cache is rebuilt from active chunks on
 * load/compact, bounding its growth.
 */

import { sha1Hex } from './hasher';
import type { VectorStore } from './vector-store';

/** A parsed chunk not yet present in the index. */
export interface NewChunk {
	filePath: string;
	headingPath: string[];
	titleContext: string;
	text: string;
}

/** A chunk stored in the index. */
export interface ChunkRecord extends NewChunk {
	/** sha1 of `text`. */
	id: string;
	/** Row of this chunk's vector in the vector store. */
	vectorRow: number;
}

export interface ScoredChunk {
	record: ChunkRecord;
	score: number;
}

/** Embeds a batch of texts, returning one vector per text. */
export type EmbedFn = (texts: string[]) => Promise<Float32Array[]>;

export class ChunkIndex {
	/** Parallel to vector-store rows; null for tombstoned rows. */
	private records: Array<ChunkRecord | null> = [];
	private rowsByFile = new Map<string, Set<number>>();
	/** Embedding cache: chunk id → vector. Survives edits and renames. */
	private embeddings = new Map<string, Float32Array>();

	constructor(private store: VectorStore) {}

	get size(): number {
		return this.store.size;
	}

	/**
	 * Replace a file's chunks, embedding only chunks whose content has
	 * never been seen before.
	 */
	async updateFile(
		filePath: string,
		chunks: NewChunk[],
		embed: EmbedFn,
	): Promise<void> {
		const ids = await Promise.all(chunks.map((c) => sha1Hex(c.text)));

		// Collect reusable vectors before removing anything.
		const vectors: Array<Float32Array | null> = ids.map(
			(id) => this.embeddings.get(id) ?? null,
		);

		this.removeFile(filePath);

		// Embed only the chunks missing from the cache.
		const missingIdx: number[] = [];
		const missingTexts: string[] = [];
		for (let i = 0; i < chunks.length; i++) {
			if (vectors[i] == null) {
				missingIdx.push(i);
				missingTexts.push(chunks[i]?.text ?? '');
			}
		}
		if (missingTexts.length > 0) {
			const embedded = await embed(missingTexts);
			missingIdx.forEach((chunkIdx, k) => {
				const vector = embedded[k];
				if (!vector) {
					throw new Error('embedder returned fewer vectors than texts');
				}
				this.embeddings.set(ids[chunkIdx] ?? '', vector);
				vectors[chunkIdx] = vector;
			});
		}

		for (let i = 0; i < chunks.length; i++) {
			const chunk = chunks[i];
			const vector = vectors[i];
			const id = ids[i];
			if (!chunk || !vector || id === undefined) {
				continue;
			}
			const row = this.store.add(vector);
			this.records[row] = { ...chunk, id, vectorRow: row };
			let rows = this.rowsByFile.get(filePath);
			if (!rows) {
				rows = new Set();
				this.rowsByFile.set(filePath, rows);
			}
			rows.add(row);
		}
	}

	/** Remove all of a file's chunks (tombstones in the store). */
	removeFile(filePath: string): void {
		const rows = this.rowsByFile.get(filePath);
		if (!rows) {
			return;
		}
		for (const row of rows) {
			this.store.remove(row);
			this.records[row] = null;
		}
		this.rowsByFile.delete(filePath);
	}

	/** Active chunk records for a file, in insertion order. */
	chunksForFile(filePath: string): ChunkRecord[] {
		const rows = this.rowsByFile.get(filePath);
		if (!rows) {
			return [];
		}
		return [...rows]
			.sort((a, b) => a - b)
			.map((row) => this.records[row])
			.filter((r): r is ChunkRecord => r != null);
	}

	indexedFiles(): Iterable<string> {
		return this.rowsByFile.keys();
	}

	/** Vectors of a file's active chunks (for note-level queries). */
	vectorsForFile(filePath: string): Float32Array[] {
		const rows = this.rowsByFile.get(filePath);
		if (!rows) {
			return [];
		}
		const vectors: Float32Array[] = [];
		for (const row of rows) {
			const vector = this.store.get(row);
			if (vector) {
				vectors.push(vector);
			}
		}
		return vectors;
	}

	/** Cosine-search the store and attach chunk records. */
	search(query: Float32Array, topK: number, minScore?: number): ScoredChunk[] {
		const results = this.store.search(query, topK, minScore);
		const scored: ScoredChunk[] = [];
		for (const { row, score } of results) {
			const record = this.records[row];
			if (record) {
				scored.push({ record, score });
			}
		}
		return scored;
	}

	/**
	 * Active chunks (ascending row order) with their vectors, vectorRow
	 * remapped dense from 0. Used to persist the index compacted.
	 */
	snapshot(): { records: ChunkRecord[]; vectors: Float32Array[] } {
		const records: ChunkRecord[] = [];
		const vectors: Float32Array[] = [];
		for (const row of this.store.activeRows()) {
			const record = this.records[row];
			const vector = this.store.get(row);
			if (record && vector) {
				records.push({ ...record, vectorRow: records.length });
				vectors.push(vector);
			}
		}
		return { records, vectors };
	}

	/**
	 * Bulk-load a snapshot into an empty index, rebuilding all lookups
	 * including the embedding cache. Rows are reassigned sequentially.
	 */
	loadSnapshot(records: ChunkRecord[], vectors: Float32Array[]): void {
		if (this.records.length > 0) {
			throw new Error('loadSnapshot requires an empty index');
		}
		records.forEach((record, i) => {
			const vector = vectors[i];
			if (!vector) {
				throw new Error(`missing vector for chunk ${record.id}`);
			}
			const row = this.store.add(vector);
			const loaded: ChunkRecord = { ...record, vectorRow: row };
			this.records[row] = loaded;
			let rows = this.rowsByFile.get(loaded.filePath);
			if (!rows) {
				rows = new Set();
				this.rowsByFile.set(loaded.filePath, rows);
			}
			rows.add(row);
			this.embeddings.set(loaded.id, vector);
		});
	}
}
