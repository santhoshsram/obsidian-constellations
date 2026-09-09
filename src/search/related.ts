/**
 * Turn raw chunk-level search results into note-level relatedness:
 * group by file, keep the top chunks per note, rank notes by their best
 * chunk.
 */

import type { ScoredChunk } from '../index/chunk-index';

export interface RelatedNote {
	filePath: string;
	/** Score of the note's best-matching chunk. */
	bestScore: number;
	/** Top-scoring chunks, best first, at most `maxChunksPerNote`. */
	chunks: ScoredChunk[];
}

export interface RelatedOptions {
	/** Active note to exclude from results (don't relate a note to itself). */
	excludeFile?: string;
	maxNotes: number;
	maxChunksPerNote: number;
}

/**
 * Group scored chunks (assumed pre-filtered by score threshold) into
 * related notes. Input order doesn't matter; output is ranked by each
 * note's best chunk score, descending.
 */
export function relatedNotes(
	scored: ScoredChunk[],
	options: RelatedOptions,
): RelatedNote[] {
	const byFile = new Map<string, ScoredChunk[]>();
	for (const chunk of scored) {
		if (chunk.record.filePath === options.excludeFile) {
			continue;
		}
		const group = byFile.get(chunk.record.filePath);
		if (group) {
			group.push(chunk);
		} else {
			byFile.set(chunk.record.filePath, [chunk]);
		}
	}

	const notes: RelatedNote[] = [];
	for (const [filePath, chunks] of byFile) {
		chunks.sort((a, b) => b.score - a.score);
		const top = chunks.slice(0, options.maxChunksPerNote);
		const best = top[0];
		if (best) {
			notes.push({ filePath, bestScore: best.score, chunks: top });
		}
	}
	notes.sort((a, b) => b.bestScore - a.bestScore);
	return notes.slice(0, options.maxNotes);
}
