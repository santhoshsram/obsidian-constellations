/**
 * Text extraction and cross-encoder reranking service for candidate chunks.
 */

import type { ScoredChunk } from '../index/chunk-index';
import type { Reranker, TextPair } from '../embed/reranker';

export interface FileReader {
	read(path: string): Promise<string>;
}

/**
 * Extract chunk text from note content using 0-indexed line numbers.
 */
export function sliceChunkText(
	content: string,
	startLine?: number,
	endLine?: number,
): string {
	if (typeof startLine !== 'number' || typeof endLine !== 'number') {
		return content.trim();
	}

	const lines = content.split('\n');
	const start = Math.max(0, Math.min(startLine, lines.length - 1));
	const end = Math.max(start, Math.min(endLine + 1, lines.length));
	const sliced = lines.slice(start, end).join('\n').trim();
	return sliced.length > 0 ? sliced : content.trim();
}

export interface RerankCandidateOptions {
	candidates: ScoredChunk[];
	fileReader: FileReader;
	reranker: Reranker;
	topK?: number;
	defaultQueryText?: string;
	fallbackOnError?: boolean;
}

/**
 * Concurrently fetch file content, extract candidate pairs, and rerank
 * the top-K candidates using the cross-encoder.
 */
export async function rerankCandidateChunks(
	options: RerankCandidateOptions,
): Promise<ScoredChunk[]> {
	const {
		candidates,
		fileReader,
		reranker,
		topK = 50,
		defaultQueryText,
		fallbackOnError = true,
	} = options;

	if (candidates.length === 0) {
		return [];
	}

	// 1. Top-K funneling: sort by vector similarity descending and take topK
	const pool = [...candidates]
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);

	// 2. Identify unique files needed
	const pathsToRead = new Set<string>();
	for (const c of pool) {
		pathsToRead.add(c.record.filePath);
		if (c.sourceChunk?.filePath) {
			pathsToRead.add(c.sourceChunk.filePath);
		}
	}

	// 3. Parallel file reads
	const fileMap = new Map<string, string>();
	try {
		await Promise.all(
			Array.from(pathsToRead).map(async (path) => {
				const content = await fileReader.read(path);
				fileMap.set(path, content);
			}),
		);
	} catch (e) {
		if (fallbackOnError) {
			console.warn('Obsidian brain: file read failed during reranking', e);
			return pool;
		}
		throw e;
	}

	// 4. Build text pairs for inference
	const pairs: TextPair[] = [];
	for (const c of pool) {
		const targetContent = fileMap.get(c.record.filePath) ?? '';
		const passage = sliceChunkText(
			targetContent,
			c.record.startLine,
			c.record.endLine,
		);

		let query = defaultQueryText ?? '';
		if (c.sourceChunk) {
			const sourceContent = fileMap.get(c.sourceChunk.filePath) ?? '';
			query = sliceChunkText(
				sourceContent,
				c.sourceChunk.startLine,
				c.sourceChunk.endLine,
			);
		}
		if (!query) {
			query = c.matchedSourceHeading ?? c.record.titleContext;
		}

		pairs.push({ query, passage });
	}

	// 5. Batch cross-encoder inference
	try {
		const scores = await reranker.rerankPairs(pairs);
		const reranked: ScoredChunk[] = pool.map((c, i) => ({
			...c,
			score: scores[i] ?? c.score,
		}));

		// Re-sort descending by reranker score
		reranked.sort((a, b) => b.score - a.score);
		return reranked;
	} catch (e) {
		if (fallbackOnError) {
			console.warn('Obsidian brain: cross-encoder reranking failed, falling back to vector scores', e);
			return pool;
		}
		throw e;
	}
}
