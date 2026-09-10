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

export interface PipelineProgress {
	status: string;
	file?: string;
	progress?: number;
}

export async function createEmbeddingPipeline(
	modelId: string,
	onProgress?: (progress: PipelineProgress) => void,
) {
	const release = process.release as { name?: string };
	const originalName = release.name;
	release.name = 'obsidian-renderer';
	let transformers: typeof import('@huggingface/transformers');
	try {
		transformers = await import('@huggingface/transformers');
	} finally {
		release.name = originalName;
	}

	const { pipeline, env } = transformers;
	env.allowRemoteModels = true; // one-time download from Hugging Face
	env.allowLocalModels = false; // models come from the HF hub cache only

	const pipe = await pipeline('feature-extraction', modelId, {
		dtype: 'q8',
		progress_callback: onProgress,
	});
	return pipe;
}
