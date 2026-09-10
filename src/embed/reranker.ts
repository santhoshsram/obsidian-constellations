/**
 * Reranking service: scores (query, passage) pairs using a cross-encoder model.
 * Injected as a minimal functional pipeline type so unit tests run without
 * evaluating ONNX runtimes or downloading model checkpoints.
 */

import type { RerankerModelSpec } from './models';

export interface TextPair {
	query: string;
	passage: string;
}

/** Minimal shape of a function that scores a batch of text pairs. */
export type RerankPairsFn = (
	pairs: TextPair[],
	onTiming?: (timing: { tokenizeMs: number; inferMs: number }) => void,
) => Promise<number[]>;

export interface BatchTimingInfo {
	batchIdx: number;
	totalBatches: number;
	batchSize: number;
	batchMs: number;
	tokenizeMs?: number;
	inferMs?: number;
}

export interface RerankPairsOptions {
	onBatch?: (info: BatchTimingInfo) => void;
}

export interface Reranker {
	device?: string;
	rerankPairs(
		pairs: TextPair[],
		options?: RerankPairsOptions,
	): Promise<number[]>;
	rerank(query: string, passages: string[]): Promise<number[]>;
}

export class TransformersReranker implements Reranker {
	constructor(
		private pipe: RerankPairsFn,
		private model: RerankerModelSpec,
		readonly device?: string,
	) {}

	async rerankPairs(
		pairs: TextPair[],
		options?: RerankPairsOptions,
	): Promise<number[]> {
		if (pairs.length === 0) {
			return [];
		}

		const scores: number[] = [];
		const batchSize = Math.max(1, this.model.batchSize);
		const totalBatches = Math.ceil(pairs.length / batchSize);

		for (let i = 0; i < pairs.length; i += batchSize) {
			const batch = pairs.slice(i, i + batchSize);
			const batchIdx = Math.floor(i / batchSize) + 1;
			const tStart = performance.now();
			let tokenizeMs: number | undefined;
			let inferMs: number | undefined;

			const batchScores = options?.onBatch
				? await this.pipe(batch, (timing) => {
						tokenizeMs = timing.tokenizeMs;
						inferMs = timing.inferMs;
				  })
				: await this.pipe(batch);
			const batchMs = performance.now() - tStart;
			scores.push(...batchScores);

			options?.onBatch?.({
				batchIdx,
				totalBatches,
				batchSize: batch.length,
				batchMs,
				tokenizeMs,
				inferMs,
			});
		}

		return scores;
	}

	async rerank(query: string, passages: string[]): Promise<number[]> {
		const pairs = passages.map((passage) => ({ query, passage }));
		return this.rerankPairs(pairs);
	}
}
