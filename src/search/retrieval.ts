/**
 * Note-level retrieval: find notes related to a given note by averaging
 * its chunk vectors into a single query vector. Reuses the embeddings
 * already computed at index time — no model call needed.
 */

import type { ChunkIndex, ScoredChunk } from '../index/chunk-index';
import { relatedNotes } from './related';
import type { RelatedNote } from './related';

export interface RetrievalOptions {
	maxNotes: number;
	maxChunksPerNote: number;
	minScore: number;
}

export type RetrievalStrategy = 'maxsim' | 'cursor' | 'mean';

export interface CursorRetrievalOptions extends RetrievalOptions {
	cursorLine?: number;
	cursorHeading?: string;
	chunkIndex?: number;
}

export interface StrategyRetrievalOptions extends CursorRetrievalOptions {
	strategy?: RetrievalStrategy;
}

/** Extract the most specific heading for attribution display. */
export function chunkSourceHeading(chunk: { headingPath: string[]; titleContext: string }): string {
	if (chunk.headingPath && chunk.headingPath.length > 1) {
		return chunk.headingPath[chunk.headingPath.length - 1] ?? chunk.titleContext;
	}
	return chunk.headingPath?.[0] ?? chunk.titleContext;
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
 * Baseline candidates: search using mean vector centroid.
 */
export function candidateChunksMean(
	index: ChunkIndex,
	filePath: string,
	options: RetrievalOptions,
): ScoredChunk[] {
	const sourceChunks = index.chunksWithVectorsForFile(filePath);
	if (sourceChunks.length === 0) {
		return [];
	}
	const query = meanVector(sourceChunks.map((s) => s.vector));
	const topK = Math.max(
		50,
		options.maxNotes * options.maxChunksPerNote * 5,
	);
	const scored = index.search(query, topK, options.minScore);
	const primarySource = sourceChunks[0]?.record;
	return scored
		.filter((s) => s.record.filePath !== filePath)
		.map((s) => ({
			...s,
			sourceChunk: primarySource,
		}));
}

/**
 * Baseline: Find the notes most related to `filePath` by averaging its
 * chunk vectors into a single query vector.
 */
export function relatedToNote(
	index: ChunkIndex,
	filePath: string,
	options: RetrievalOptions,
): RelatedNote[] {
	const scored = candidateChunksMean(index, filePath, options);
	return relatedNotes(scored, {
		excludeFile: filePath,
		maxNotes: options.maxNotes,
		maxChunksPerNote: options.maxChunksPerNote,
	});
}

/**
 * Chunk-to-Chunk MaxSim candidates (All-Pairs Matching):
 * Evaluates every chunk of the active note individually against vault chunks.
 */
export function candidateChunksMaxSim(
	index: ChunkIndex,
	filePath: string,
	options: RetrievalOptions,
): ScoredChunk[] {
	const sourceChunks = index.chunksWithVectorsForFile(filePath);
	if (sourceChunks.length === 0) {
		return [];
	}

	const topK = Math.max(
		50,
		options.maxNotes * options.maxChunksPerNote * 5,
	);

	const allScored: ScoredChunk[] = [];
	for (const { record, vector } of sourceChunks) {
		const heading = chunkSourceHeading(record);
		const scored = index.search(vector, topK, options.minScore);
		for (const s of scored) {
			if (s.record.filePath !== filePath) {
				allScored.push({
					...s,
					matchedSourceHeading: heading,
					sourceChunk: record,
				});
			}
		}
	}
	return allScored;
}

/**
 * Chunk-to-Chunk MaxSim (All-Pairs Matching):
 * Evaluates every chunk of the active note individually against vault chunks.
 * Prevents topic dilution in multi-topic notes and attributes which section
 * triggered each related note match.
 */
export function relatedToNoteMaxSim(
	index: ChunkIndex,
	filePath: string,
	options: RetrievalOptions,
): RelatedNote[] {
	const scored = candidateChunksMaxSim(index, filePath, options);
	return relatedNotes(scored, {
		excludeFile: filePath,
		maxNotes: options.maxNotes,
		maxChunksPerNote: options.maxChunksPerNote,
	});
}

/**
 * Cursor / Active Section candidates:
 * Retrieves candidates relevant to the section or line under cursor.
 */
export function candidateChunksCursor(
	index: ChunkIndex,
	filePath: string,
	options: CursorRetrievalOptions,
): ScoredChunk[] {
	const sourceChunks = index.chunksWithVectorsForFile(filePath);
	if (sourceChunks.length === 0) {
		return [];
	}

	let targetChunks: Array<{ record: typeof sourceChunks[0]['record']; vector: Float32Array }> = [];

	// 1. Direct chunkIndex if specified
	if (typeof options.chunkIndex === 'number') {
		const c = sourceChunks[options.chunkIndex];
		if (c) {
			targetChunks = [c];
		}
	}

	// 2. Heading match
	if (targetChunks.length === 0 && options.cursorHeading) {
		const normalized = options.cursorHeading.trim().toLowerCase();
		targetChunks = sourceChunks.filter((c) =>
			c.record.headingPath.some((h) => h.trim().toLowerCase() === normalized),
		);
	}

	// 3. Line range match
	if (targetChunks.length === 0 && typeof options.cursorLine === 'number') {
		const line = options.cursorLine;
		const match = sourceChunks.find(
			(c) =>
				typeof c.record.startLine === 'number' &&
				typeof c.record.endLine === 'number' &&
				c.record.startLine <= line &&
				line <= c.record.endLine,
		);
		if (match) {
			targetChunks = [match];
		}
	}

	// 4. Fallback to first chunk (the note's lead/overview section)
	if (targetChunks.length === 0) {
		const first = sourceChunks[0];
		if (first) {
			targetChunks = [first];
		}
	}

	const topK = Math.max(
		50,
		options.maxNotes * options.maxChunksPerNote * 5,
	);

	const allScored: ScoredChunk[] = [];
	for (const { record, vector } of targetChunks) {
		const heading = chunkSourceHeading(record);
		const scored = index.search(vector, topK, options.minScore);
		for (const s of scored) {
			if (s.record.filePath !== filePath) {
				allScored.push({
					...s,
					matchedSourceHeading: heading,
					sourceChunk: record,
				});
			}
		}
	}
	return allScored;
}

/**
 * Cursor / Active Section Matching:
 * Retrieves notes relevant to the specific section the user is currently
 * reading or editing under their cursor.
 */
export function relatedToNoteCursor(
	index: ChunkIndex,
	filePath: string,
	options: CursorRetrievalOptions,
): RelatedNote[] {
	const scored = candidateChunksCursor(index, filePath, options);
	return relatedNotes(scored, {
		excludeFile: filePath,
		maxNotes: options.maxNotes,
		maxChunksPerNote: options.maxChunksPerNote,
	});
}

/**
 * Retrieve candidate scored chunks based on configured or requested strategy.
 */
export function candidateChunksWithStrategy(
	index: ChunkIndex,
	filePath: string,
	options: StrategyRetrievalOptions,
): ScoredChunk[] {
	const strategy = options.strategy ?? 'maxsim';
	switch (strategy) {
		case 'maxsim':
			return candidateChunksMaxSim(index, filePath, options);
		case 'cursor':
			return candidateChunksCursor(index, filePath, options);
		case 'mean':
		default:
			return candidateChunksMean(index, filePath, options);
	}
}

/**
 * Route retrieval based on configured or requested strategy.
 */
export function relatedToNoteWithStrategy(
	index: ChunkIndex,
	filePath: string,
	options: StrategyRetrievalOptions,
): RelatedNote[] {
	const scored = candidateChunksWithStrategy(index, filePath, options);
	return relatedNotes(scored, {
		excludeFile: filePath,
		maxNotes: options.maxNotes,
		maxChunksPerNote: options.maxChunksPerNote,
	});
}
