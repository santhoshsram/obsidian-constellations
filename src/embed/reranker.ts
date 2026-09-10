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
export type RerankPairsFn = (pairs: TextPair[]) => Promise<number[]>;

export interface Reranker {
	rerankPairs(pairs: TextPair[]): Promise<number[]>;
	rerank(query: string, passages: string[]): Promise<number[]>;
}

export class TransformersReranker implements Reranker {
	constructor(
		private pipe: RerankPairsFn,
		private model: RerankerModelSpec,
	) {}

	async rerankPairs(pairs: TextPair[]): Promise<number[]> {
		if (pairs.length === 0) {
			return [];
		}

		const scores: number[] = [];
		const batchSize = Math.max(1, this.model.batchSize);

		for (let i = 0; i < pairs.length; i += batchSize) {
			const batch = pairs.slice(i, i + batchSize);
			const batchScores = await this.pipe(batch);
			scores.push(...batchScores);
		}

		return scores;
	}

	async rerank(query: string, passages: string[]): Promise<number[]> {
		const pairs = passages.map((passage) => ({ query, passage }));
		return this.rerankPairs(pairs);
	}
}
