/**
 * Text extraction and cross-encoder reranking service for candidate chunks.
 */

import type { ScoredChunk } from '../index/chunk-index';
import type { Reranker, TextPair, BatchTimingInfo } from '../embed/reranker';
import { RETRIEVAL_CONFIG } from '../config';
import type { Logger } from '../utils/logger';
import { pluginName } from '../plugin-name';

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
	logger?: Logger;
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
		topK = RETRIEVAL_CONFIG.stage1CandidatePoolSize,
		defaultQueryText,
		fallbackOnError = true,
		logger,
	} = options;

	if (candidates.length === 0) {
		return [];
	}

	const tFunnelStart = performance.now();
	const pool = [...candidates]
		.sort((a, b) => b.score - a.score)
		.slice(0, topK);
	const funnelMs = performance.now() - tFunnelStart;
	logger?.debug(
		`[rerank] Top-${topK} funneling: took ${funnelMs.toFixed(1)}ms (${candidates.length} stage 1 chunks -> pool of ${pool.length})`,
	);

	const pathsToRead = new Set<string>();
	for (const c of pool) {
		pathsToRead.add(c.record.filePath);
		if (c.sourceChunk?.filePath) {
			pathsToRead.add(c.sourceChunk.filePath);
		}
	}

	const tReadStart = performance.now();
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
			if (logger?.warn) {
				logger.warn('[rerank] File read failed during reranking', e);
			} else {
				console.warn(`${pluginName()}: file read failed during reranking`, e);
			}
			return pool;
		}
		throw e;
	}
	const readMs = performance.now() - tReadStart;
	logger?.debug(
		`[rerank] Chunk fetch: read ${pathsToRead.size} unique note files in ${readMs.toFixed(1)}ms (avg ${(readMs / Math.max(1, pathsToRead.size)).toFixed(1)}ms/file)`,
	);

	const tPairStart = performance.now();
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
	const pairMs = performance.now() - tPairStart;
	logger?.debug(
		`[rerank] Chunk slicing: extracted ${pairs.length} (query, passage) pairs in ${pairMs.toFixed(1)}ms`,
	);

	try {
		const tInferStart = performance.now();
		const rerankOptions = logger
			? {
					onBatch: (info: BatchTimingInfo) => {
						const details =
							info.tokenizeMs !== undefined && info.inferMs !== undefined
								? ` (tokenize=${info.tokenizeMs.toFixed(1)}ms, inference=${info.inferMs.toFixed(1)}ms)`
								: '';
						logger.debug(
							`[rerank] Batch ${info.batchIdx}/${info.totalBatches} (${info.batchSize} pairs): ${info.batchMs.toFixed(1)}ms${details} [${(info.batchMs / Math.max(1, info.batchSize)).toFixed(1)}ms/pair]`,
						);
					},
			  }
			: undefined;

		const scores = rerankOptions
			? await reranker.rerankPairs(pairs, rerankOptions)
			: await reranker.rerankPairs(pairs);

		const inferTotalMs = performance.now() - tInferStart;
		logger?.debug(
			`[rerank] Cross-encoder inference complete: ${inferTotalMs.toFixed(1)}ms for ${pairs.length} pairs (${(inferTotalMs / Math.max(1, pairs.length)).toFixed(1)}ms/pair, device=${reranker.device ?? 'unknown'})`,
		);

		const reranked: ScoredChunk[] = pool.map((c, i) => ({
			...c,
			vectorScore: c.score,
			score: scores[i] ?? c.score,
		}));

		reranked.sort((a, b) => b.score - a.score);

		for (let i = 0; i < Math.min(10, reranked.length); i++) {
			const c = reranked[i];
			if (!c) continue;
			const heading = c.record.headingPath.join(' > ') || 'root';
			const origRank = pool.findIndex((p) => p.record.id === c.record.id) + 1;
			const vecScore =
				c.vectorScore !== undefined ? c.vectorScore.toFixed(3) : '?';
			const rrScore = c.score.toFixed(3);
			logger?.debug(
				`[rerank] Candidate #${i + 1}: "${c.record.filePath}" (${heading}) | rank ${origRank} -> ${i + 1} | vectorScore=${vecScore} -> rerankScore=${rrScore}`,
			);
		}

		return reranked;
	} catch (e) {
		const errStr = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
		if (logger?.warn) {
			logger.warn(`[rerank] Cross-encoder reranking failed: ${errStr}`, e);
		} else {
			console.warn(
				`${pluginName()}: cross-encoder reranking failed, falling back to vector scores`,
				e,
			);
		}
		if (fallbackOnError) {
			return pool;
		}
		throw e;
	}
}
