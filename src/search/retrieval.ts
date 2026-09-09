/**
 * Note-level retrieval: find notes related to a given note by averaging
 * its chunk vectors into a single query vector. Reuses the embeddings
 * already computed at index time — no model call needed.
 */

import type { ChunkIndex } from '../index/chunk-index';
import { relatedNotes } from './related';
import type { RelatedNote } from './related';

export interface RetrievalOptions {
	maxNotes: number;
	maxChunksPerNote: number;
	minScore: number;
}

/** Component-wise mean of a set of equal-length vectors. */
export function meanVector(vectors: Float32Array[]): Float32Array {
	const dimensions = vectors[0]?.length ?? 0;
	const out = new Float32Array(dimensions);
	for (const vector of vectors) {
		for (let i = 0; i < dimensions; i++) {
			out[i] = (out[i] ?? 0) + (vector[i] ?? 0);
		}
	}
	if (vectors.length > 0) {
		for (let i = 0; i < dimensions; i++) {
			out[i] = (out[i] ?? 0) / vectors.length;
		}
	}
	return out;
}

/**
 * Find the notes most related to `filePath`. The note is represented by
 * the mean of its chunk vectors; results exclude the note itself and are
 * grouped to at most `maxChunksPerNote` chunks per related note.
 */
export function relatedToNote(
	index: ChunkIndex,
	filePath: string,
	options: RetrievalOptions,
): RelatedNote[] {
	const vectors = index.vectorsForFile(filePath);
	if (vectors.length === 0) {
		return [];
	}
	const query = meanVector(vectors);
	// Over-fetch at chunk level so note-level grouping has enough to work
	// with; brute-force search makes this cheap at vault scale.
	const topK = Math.max(
		50,
		options.maxNotes * options.maxChunksPerNote * 5,
	);
	const scored = index.search(query, topK, options.minScore);
	return relatedNotes(scored, {
		excludeFile: filePath,
		maxNotes: options.maxNotes,
		maxChunksPerNote: options.maxChunksPerNote,
	});
}
