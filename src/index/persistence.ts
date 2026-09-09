/**
 * Persistence for the chunk index.
 *
 * Three files in the plugin directory (see docs/architecture.md):
 * - `vectors.bin` — contiguous Float32 matrix, row = chunk (normalized)
 * - `chunks.json` — ChunkRecord[], vectorRow remapped dense from 0
 * - `state.json`  — model id, dimensions, per-file content hashes
 *
 * Saving compacts away tombstoned rows. `IndexStorage` is a minimal
 * abstraction over Obsidian's DataAdapter so tests can run in-memory.
 */

import { ChunkIndex } from './chunk-index';
import type { ChunkRecord } from './chunk-index';
import { BruteForceVectorStore } from './vector-store';

export const VECTORS_FILE = 'vectors.bin';
export const CHUNKS_FILE = 'chunks.json';
export const STATE_FILE = 'state.json';

export interface IndexStorage {
	writeBinary(path: string, data: ArrayBuffer): Promise<void>;
	writeJson(path: string, data: unknown): Promise<void>;
	readBinary(path: string): Promise<ArrayBuffer | null>;
	readJson(path: string): Promise<unknown>;
	exists(path: string): Promise<boolean>;
}

export interface IndexState {
	/** Model the embeddings were created with; mismatch → full rebuild. */
	modelId: string;
	dimensions: number;
	/** filePath → content hash at last indexing. */
	fileHashes: Record<string, string>;
}

export interface LoadedIndex {
	index: ChunkIndex;
	state: IndexState;
}

/** Save the index, compacted to active chunks only. */
export async function saveIndex(
	storage: IndexStorage,
	index: ChunkIndex,
	state: IndexState,
): Promise<void> {
	const { records, vectors } = index.snapshot();

	const buffer = new Float32Array(records.length * state.dimensions);
	vectors.forEach((vector, i) => buffer.set(vector, i * state.dimensions));

	await storage.writeBinary(VECTORS_FILE, buffer.buffer);
	await storage.writeJson(CHUNKS_FILE, records);
	await storage.writeJson(STATE_FILE, state);
}

/**
 * Load a previously saved index, or null if none exists. Throws when the
 * saved dimensions don't match `expectedDimensions` (caller should treat
 * this as a full-rebuild signal).
 */
export async function loadIndex(
	storage: IndexStorage,
	expectedDimensions?: number,
): Promise<LoadedIndex | null> {
	if (!(await storage.exists(STATE_FILE))) {
		return null;
	}
	const state = (await storage.readJson(STATE_FILE)) as IndexState | null;
	const records = (await storage.readJson(CHUNKS_FILE)) as
		| ChunkRecord[]
		| null;
	const vectorsBuffer = await storage.readBinary(VECTORS_FILE);
	if (!state || !records || !vectorsBuffer) {
		return null;
	}

	const dimensions = expectedDimensions ?? state.dimensions;
	if (state.dimensions !== dimensions) {
		throw new Error(
			`saved index has ${state.dimensions} dimensions, expected ${dimensions}`,
		);
	}

	const floats = new Float32Array(vectorsBuffer);
	if (floats.length !== records.length * dimensions) {
		throw new Error(
			'corrupt index: vectors.bin size does not match chunks.json',
		);
	}

	const index = new ChunkIndex(new BruteForceVectorStore(dimensions));
	const vectors = records.map((_, i) =>
		floats.slice(i * dimensions, (i + 1) * dimensions),
	);
	index.loadSnapshot(records, vectors);
	return { index, state };
}
