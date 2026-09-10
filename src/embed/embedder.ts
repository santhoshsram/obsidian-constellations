/**
 * Embedding service: turns text into vectors via a transformers.js
 * feature-extraction pipeline, applying the model's task prefixes
 * (nomic uses `search_document:` / `search_query:`) and batching.
 *
 * The pipeline is injected as a minimal structural type so unit tests
 * run without downloading a model; `createEmbedder` wires up the real
 * transformers.js pipeline in the plugin.
 */

import type { EmbeddingModelSpec } from './models';

/** Minimal shape of a transformers.js feature-extraction pipeline. */
export type FeatureExtractionFn = (
	texts: string[],
	options?: Record<string, unknown>,
) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

export interface Embedder {
	readonly dimensions: number;
	embedDocuments(texts: string[]): Promise<Float32Array[]>;
	embedQuery(text: string): Promise<Float32Array>;
}

/**
 * Conservative chars/token ratio for pre-truncation.
 * FeatureExtractionPipeline._call ignores `truncation`/`max_length` options —
 * it calls the tokenizer with a hardcoded `truncation: true` but no max_length,
 * relying on the model's tokenizer config (which may not match the ONNX limit).
 * Pre-truncating by chars is the only reliable guard.
 */
const CHARS_PER_TOKEN = 3;

export class TransformersEmbedder implements Embedder {
	constructor(
		private pipe: FeatureExtractionFn,
		private model: EmbeddingModelSpec,
	) {}

	get dimensions(): number {
		return this.model.dimensions;
	}

	async embedDocuments(texts: string[]): Promise<Float32Array[]> {
		const out: Float32Array[] = [];
		const charBudget = this.model.maxLength * CHARS_PER_TOKEN;
		for (let i = 0; i < texts.length; i += this.model.batchSize) {
			const batch = texts
				.slice(i, i + this.model.batchSize)
				.map((t) => {
					const prefixed = this.model.documentPrefix + t;
					return prefixed.length > charBudget
						? prefixed.slice(0, charBudget)
						: prefixed;
				});
			const result = await this.pipe(batch, {
				pooling: this.model.pooling ?? 'mean',
				normalize: true,
			});
			for (let r = 0; r < batch.length; r++) {
				out.push(sliceRow(result.data, r, this.dimensions));
			}
		}
		return out;
	}

	async embedQuery(text: string): Promise<Float32Array> {
		const charBudget = this.model.maxLength * CHARS_PER_TOKEN;
		let prefixed = this.model.queryPrefix + text;
		if (prefixed.length > charBudget) {
			prefixed = prefixed.slice(0, charBudget);
		}
		const result = await this.pipe([prefixed], {
			pooling: this.model.pooling ?? 'mean',
			normalize: true,
		});
		return sliceRow(result.data, 0, this.dimensions);
	}
}

/** Copy row `row` out of a flattened [n, dim] tensor's data. */
function sliceRow(
	data: Float32Array | number[],
	row: number,
	dimensions: number,
): Float32Array {
	const start = row * dimensions;
	return new Float32Array(
		Array.from(data.slice(start, start + dimensions)),
	);
}
