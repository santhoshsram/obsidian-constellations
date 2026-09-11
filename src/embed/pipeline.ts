/**
 * Real transformers.js pipeline construction. Kept separate from
 * `embedder.ts` so unit tests never touch the model runtime.
 *
 * Obsidian environment workaround — two moves, both required, both done
 * BEFORE `@huggingface/transformers` is evaluated:
 *
 * 1. Delete `globalThis[Symbol.for('onnxruntime')]`. Modern
 *    onnxruntime-web self-registers there on evaluation, and
 *    transformers.js checks that symbol FIRST — but its symbol branch
 *    never populates `supportedDevices`/`defaultDevices`, so every
 *    device ("cpu", "wasm", …) is rejected as unsupported.
 *
 * 2. Temporarily patch `process.release.name` around a DYNAMIC import.
 *    Obsidian's Electron renderer has Node integration, so
 *    transformers.js misdetects the environment as Node and selects the
 *    onnxruntime-node backend — which is an empty stub in the web build.
 *    The environment snapshot is computed once at module evaluation, so
 *    a patch that only covers the import is sufficient and safe.
 *
 * Result: transformers.js takes its web branch — the real
 * onnxruntime-web WASM runtime with proper device lists.
 */

// Static import: forces onnxruntime-web to evaluate (and self-register
// the symbol) before we delete it below, all before transformers.js runs.
import 'onnxruntime-web/webgpu';

delete (globalThis as Record<symbol, unknown>)[Symbol.for('onnxruntime')];

import type { EmbeddingModelSpec, RerankerModelSpec } from './models';
import type { RerankPairsFn, TextPair } from './reranker';
import { pluginName } from '../plugin-name';

export interface PipelineProgress {
	status: string;
	file?: string;
	progress?: number;
}

export type DeviceMode = 'webgpu' | 'wasm' | 'unknown';

export interface DeviceConfig {
	device?: string;
	dtype?: string;
}

/** Minimal shape of a transformers.js feature-extraction pipeline. */
export type EmbeddingPipelineFn = (
	texts: string[],
	options?: Record<string, unknown>,
) => Promise<{ data: Float32Array | number[]; dims: number[] }>;

/** Ordered fallback device configurations, WebGPU-favouring. */
export function selectDeviceConfig(
	webgpuAvailable: boolean,
): { config: DeviceConfig; fallbacks: DeviceConfig[] } {
	const all: DeviceConfig[] = [
		{ device: 'webgpu', dtype: 'q8' },
		{ dtype: 'q8' },
		{},
	];
	const fallbacks = webgpuAvailable ? all : all.slice(1);
	return { config: fallbacks[0] ?? {}, fallbacks };
}

/**
 * Build the device fallback chain for a specific model from its shipped
 * dtype variants: each spec dtype tried on WebGPU first (if available),
 * then WASM q8, then the bare WASM-auto fallback.
 */
export function buildFallbackChain(
	model: { dtypes: string[] },
	webgpuAvailable: boolean,
): DeviceConfig[] {
	const chain: DeviceConfig[] = [];
	if (webgpuAvailable) {
		for (const dtype of model.dtypes) {
			chain.push({ device: 'webgpu', dtype });
		}
	}
	chain.push({ dtype: 'q8' }, {});
	return chain;
}

async function loadTransformers(): Promise<typeof import('@huggingface/transformers')> {
	// process.release is read-only in Obsidian's renderer, so we cannot
	// patch release.name directly. Instead, swap the global `process` for
	// a Proxy that overrides only `release.name`, just for the duration
	// of the dynamic import (transformers.js snapshots its environment
	// detection once, at module evaluation).
	const globalScope = window as { process?: unknown };
	const originalProcess = globalScope.process;
	if (typeof originalProcess !== 'object' || originalProcess === null) {
		throw new Error('expected a global process object');
	}
	globalScope.process = new Proxy(originalProcess, {
		get(target, prop, receiver) {
			if (prop === 'release') {
				const release = Reflect.get(target, prop, receiver) as Record<
					string,
					unknown
				>;
				return { ...release, name: 'obsidian-renderer' };
			}
			return Reflect.get(target, prop, receiver) as unknown;
		},
	});
	let transformers: typeof import('@huggingface/transformers');
	try {
		transformers = await import('@huggingface/transformers');
	} finally {
		globalScope.process = originalProcess;
	}
	const { env } = transformers;
	env.allowRemoteModels = true; // one-time download from Hugging Face
	env.allowLocalModels = false; // models come from the HF hub cache only
	env.useBrowserCache = true;
	const wasm = env.backends.onnx.wasm;
	if (wasm) {
		wasm.numThreads = 4;
	}
	return transformers;
}

export async function createEmbeddingPipeline(
	model: EmbeddingModelSpec,
	onProgress?: (progress: PipelineProgress) => void,
): Promise<{ pipe: EmbeddingPipelineFn; device: DeviceMode }> {
	const transformers = await loadTransformers();
	const { pipeline } = transformers;

	// Report WebGPU availability so we know whether WASM is a fallback or
	// the only option (WASM single-thread is slow).
	const gpuStatus = await probeWebgpu();
	console.debug(`${pluginName()}: embedding model webgpu probe=${gpuStatus}`);

	const fallbacks = buildFallbackChain(model, gpuStatus === 'usable');
	let lastError: unknown;
	for (const cfg of fallbacks) {
		try {
			const pipe = await pipeline('feature-extraction', model.modelId, {
				...(cfg as Record<string, unknown>),
				progress_callback: onProgress,
			});
			const device: DeviceMode = cfg.device === 'webgpu' ? 'webgpu' : 'wasm';
			console.debug(`${pluginName()}: embedding model using device=${device}`);
			return { pipe, device };
		} catch (e) {
			console.warn(
				`${pluginName()}: pipeline failed with config ${JSON.stringify(cfg)}`,
				e,
			);
			lastError = e;
		}
	}
	throw lastError;
}

export async function createRerankerPipeline(
	model: RerankerModelSpec,
	onProgress?: (progress: PipelineProgress) => void,
): Promise<{ rerankPairs: RerankPairsFn; device: DeviceMode }> {
	const transformers = await loadTransformers();
	const { AutoTokenizer, AutoModelForSequenceClassification } = transformers;

	const gpuStatus = await probeWebgpu();
	console.debug(`${pluginName()}: reranker webgpu probe=${gpuStatus}`);

	const tokenizer = await AutoTokenizer.from_pretrained(model.modelId, {
		progress_callback: onProgress,
	});

	const fallbacks = buildFallbackChain(model, gpuStatus === 'usable');
	let lastError: unknown;
	for (const cfg of fallbacks) {
		try {
			const session_options =
				cfg.dtype === 'fp16'
					? { graphOptimizationLevel: 'basic' as const }
					: undefined;

			const classifier = await AutoModelForSequenceClassification.from_pretrained(
				model.modelId,
				{
					...(cfg as Record<string, unknown>),
					progress_callback: onProgress,
					...(session_options ? { session_options } : {}),
				},
			);
			const device: DeviceMode = cfg.device === 'webgpu' ? 'webgpu' : 'wasm';
			console.debug(`${pluginName()}: reranker using device=${device}`);

			const rerankPairs: RerankPairsFn = async (
				pairs: TextPair[],
				onTiming?: (timing: { tokenizeMs: number; inferMs: number }) => void,
			): Promise<number[]> => {
				if (pairs.length === 0) return [];
				try {
					const tTokenizeStart = performance.now();
					const queries = pairs.map((p) => p.query);
					const passages = pairs.map((p) => p.passage);
					const inputs = (tokenizer as (texts: string[], options: Record<string, unknown>) => unknown)(queries, {
						text_pair: passages,
						padding: 'max_length',
						truncation: true,
						max_length: model.maxLength,
					});
					const tokenizeMs = performance.now() - tTokenizeStart;

					const tInferStart = performance.now();
					const outputs = (await (classifier as (inp: unknown) => Promise<{ logits?: { data: ArrayLike<number> } }>)(inputs));
					const inferMs = performance.now() - tInferStart;

					console.debug(`${pluginName()}: reranker outputs keys:`, outputs ? Object.keys(outputs) : null);

					onTiming?.({ tokenizeMs, inferMs });

					const rawScores = await extractLogitsAsync(outputs?.logits);
					const scores: number[] = [];
					const isTwoClass = rawScores.length === pairs.length * 2;
					for (let i = 0; i < pairs.length; i++) {
						const idx = isTwoClass ? i * 2 + 1 : i;
						scores.push(Number(rawScores[idx] ?? 0));
					}
					return scores;
				} catch (err) {
					console.error(`${pluginName()}: rerankPairs execution failed`, err);
					throw err;
				}
			};

			return { rerankPairs, device };
		} catch (e) {
			console.warn(
				`${pluginName()}: reranker pipeline failed with config ${JSON.stringify(cfg)}`,
				e,
			);
			lastError = e;
		}
	}
	throw lastError;
}

async function probeWebgpu(): Promise<'usable' | 'missing' | 'failed'> {
	const gpu = (navigator as { gpu?: { requestAdapter?(): Promise<unknown> } })
		.gpu;
	if (!gpu) {
		return 'missing';
	}
	try {
		const adapter = await gpu.requestAdapter?.();
		return adapter ? 'usable' : 'failed';
	} catch {
		return 'failed';
	}
}

/** Check whether ONNX model weights (.onnx) exist in Chromium CacheStorage ('transformers-cache'). */
export async function isModelCached(modelId: string): Promise<boolean> {
	if (typeof caches === 'undefined') {
		return false;
	}
	try {
		const cache = await caches.open('transformers-cache');
		const keys = await cache.keys();
		return keys.some(
			(req) => req.url.includes(modelId) && req.url.includes('.onnx'),
		);
	} catch {
		return false;
	}
}

/**
 * Extract an ArrayLike of numbers from model logits, handling ONNX WebGPU tensors,
 * CPU tensors, direct TypedArrays, and nested lists.
 */
export async function extractLogitsAsync(logits: unknown): Promise<ArrayLike<number>> {
	if (!logits) {
		console.error(`${pluginName()}: extractLogitsAsync received falsy logits:`, logits);
		throw new Error('Model outputs missing logits');
	}

	// 1. Direct array or TypedArray
	if (Array.isArray(logits) || ArrayBuffer.isView(logits)) {
		return logits as ArrayLike<number>;
	}

	const obj = logits as Record<string, unknown>;

	// 2. If it has getData() (ONNX WebGPU tensor needing download to CPU)
	if (typeof obj.getData === 'function') {
		try {
			const gpuData = await (obj.getData as () => Promise<unknown>)();
			if (Array.isArray(gpuData) || ArrayBuffer.isView(gpuData)) {
				return gpuData as ArrayLike<number>;
			}
		} catch (e) {
			console.warn('logits.getData() threw:', e);
		}
	}

	// 3. If ort_tensor has getData()
	if (
		obj.ort_tensor &&
		typeof (obj.ort_tensor as Record<string, unknown>).getData === 'function'
	) {
		try {
			const gpuData = await (
				(obj.ort_tensor as Record<string, unknown>).getData as () => Promise<unknown>
			)();
			if (Array.isArray(gpuData) || ArrayBuffer.isView(gpuData)) {
				return gpuData as ArrayLike<number>;
			}
		} catch (e) {
			console.warn('ort_tensor.getData() threw:', e);
		}
	}

	// 4. If it has .tolist()
	if (typeof obj.tolist === 'function') {
		try {
			const list = (obj.tolist as () => unknown)();
			if (Array.isArray(list)) {
				return list.flat(Infinity) as ArrayLike<number>;
			}
		} catch (e) {
			console.warn('logits.tolist() threw:', e);
		}
	}

	// 5. Check .data property
	try {
		if (obj.data && (Array.isArray(obj.data) || ArrayBuffer.isView(obj.data))) {
			return obj.data as ArrayLike<number>;
		}
	} catch (e) {
		console.warn('Accessing logits.data threw:', e);
	}

	// 6. Check .cpuData property
	if (obj.cpuData && (Array.isArray(obj.cpuData) || ArrayBuffer.isView(obj.cpuData))) {
		return obj.cpuData as ArrayLike<number>;
	}

	// 7. Check if it has an ort_tensor with data / cpuData
	if (obj.ort_tensor) {
		const ort = obj.ort_tensor as Record<string, unknown>;
		try {
			if (ort.data && (Array.isArray(ort.data) || ArrayBuffer.isView(ort.data))) {
				return ort.data as ArrayLike<number>;
			}
		} catch {
			// ignore
		}
		if (ort.cpuData && (Array.isArray(ort.cpuData) || ArrayBuffer.isView(ort.cpuData))) {
			return ort.cpuData as ArrayLike<number>;
		}
	}

	const proto = Object.getPrototypeOf(obj) as object | null;
	const protoProps = proto ? Object.getOwnPropertyNames(proto) : [];
	const ownProps = Object.getOwnPropertyNames(obj);
	throw new Error(
		`Cannot extract tensor data from logits (constructor: ${obj.constructor?.name ?? 'unknown'}). Own props: ${JSON.stringify(ownProps)}, Proto methods: ${JSON.stringify(protoProps)}`,
	);
}


