/**
 * Headless embedding-model benchmark. Runs a fixed set of chunk texts
 * through candidate models and reports per-model throughput, so we can
 * pick a model that is actually fast on the user's GPU/WASM.
 *
 * The pipeline factory is injected so unit tests use a fake; the plugin
 * passes `createEmbeddingPipeline` (which also drives device selection).
 */

import type { EmbeddingModelSpec } from './models';

/** One note's worth of already-parsed chunks, for the sample. */
export interface BenchmarkSample {
	path: string;
	chunks: { text: string }[];
}

export interface BenchmarkResult {
	modelId: string;
	chunks: number;
	batchCount: number;
	/** Total measured embedding time (ms) across measured runs. */
	ms: number;
	/** Throughput: chunks per second. */
	chunksPerSec: number;
}

/** Flatten sample chunks into strings, capped, with model prefix. */
export function collectSampleTexts(
	samples: BenchmarkSample[],
	maxChunks = 64,
	documentPrefix = '',
): string[] {
	const out: string[] = [];
	for (const { chunks } of samples) {
		for (const c of chunks) {
			if (out.length >= maxChunks) {
				return out;
			}
			out.push(documentPrefix + c.text);
		}
	}
	return out;
}

/** A vault file with its size, for largest-first sample selection. */
export interface SizedFile {
	path: string;
	size: number;
}

/** Return the N largest files, descending by size. */
export function pickLargestFiles(files: SizedFile[], n: number): SizedFile[] {
	return [...files].sort((a, b) => b.size - a.size).slice(0, n);
}

/**
 * Benchmark one model over the given sample texts. Reports total ms and
 * throughput for `maxRuns` measured runs (after `warmupMs` warm-up).
 */
/**
 * Conservative chars-per-token ratio for pre-truncation. The HuggingFace
 * tokenizer's `truncation: true` inside FeatureExtractionPipeline has no
 * `max_length` — it relies on the model's tokenizer config, which may not
 * match the ONNX position-embedding table size. We pre-truncate by chars
 * so no sequence ever exceeds the model's hard ONNX limit.
 * 3 chars/token is conservative (typical English is ~4, but code/CJK/
 * punctuation-heavy text can drop to ~3 or less).
 */
const CHARS_PER_TOKEN = 3;

/** Options accepted by FeatureExtractionPipeline._call (others are ignored). */
const PIPE_OPTIONS: Record<string, unknown> = {
	pooling: 'mean',
	normalize: true,
};

/** Truncate a batch of texts to fit within the model's ONNX sequence limit. */
function truncateBatch(texts: string[], maxLength: number): string[] {
	const charBudget = maxLength * CHARS_PER_TOKEN;
	return texts.map((t) => (t.length > charBudget ? t.slice(0, charBudget) : t));
}

export async function benchmarkOneModel(
	model: EmbeddingModelSpec,
	texts: string[],
	opts: {
		createPipeline: () => Promise<{
			pipe: (
				texts: string[],
				options?: Record<string, unknown>,
			) => Promise<{ data: Float32Array | number[]; dims: number[] }>;
		}>;
		warmupMs?: number;
		maxRuns?: number;
	},
): Promise<BenchmarkResult> {
	const { pipe } = await opts.createPipeline();
	const batchSize = model.batchSize;
	const pipeOpts: Record<string, unknown> = {
		pooling: model.pooling ?? 'mean',
		normalize: true,
	};
	// Pre-truncate once; same safe texts are used for warm-up and measured runs.
	const safeBatches = sliceBatches(truncateBatch(texts, model.maxLength), batchSize);

	// Warm-up: iterate all batches once so shader/cache are primed.
	for (const batch of safeBatches) {
		await pipe(batch, pipeOpts);
	}

	const runs = opts.maxRuns ?? 3;
	const measuredRuns: number[] = [];
	for (let i = 0; i < runs; i++) {
		const started = performance.now();
		for (const batch of safeBatches) {
			await pipe(batch, pipeOpts);
		}
		measuredRuns.push(performance.now() - started);
	}
	const meanMs = measuredRuns.reduce((a, b) => a + b, 0) / measuredRuns.length;
	return {
		modelId: model.modelId,
		chunks: texts.length,
		batchCount: safeBatches.length,
		ms: Math.round(meanMs),
		chunksPerSec: texts.length / (meanMs / 1000),
	};
}

/** Split texts into model.batchSize batches. */
function sliceBatches(texts: string[], batchSize: number): string[][] {
	const out: string[][] = [];
	for (let i = 0; i < texts.length; i += batchSize) {
		out.push(texts.slice(i, i + batchSize));
	}
	return out;
}