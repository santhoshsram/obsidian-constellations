/**
 * Real transformers.js pipeline construction. Kept separate from
 * `embedder.ts` so unit tests never touch the model runtime.
 *
 * Runs in Obsidian's Electron renderer: transformers.js uses the browser
 * Cache API for model files, so the one-time Hugging Face download is
 * cached by the app across restarts.
 */

import { pipeline, env } from '@huggingface/transformers';
import type { FeatureExtractionFn } from './embedder';

export interface PipelineProgress {
	status: string;
	file?: string;
	progress?: number;
}

export async function createEmbeddingPipeline(
	modelId: string,
	onProgress?: (progress: PipelineProgress) => void,
): Promise<FeatureExtractionFn> {
	env.allowRemoteModels = true; // one-time download from Hugging Face
	env.allowLocalModels = false; // models come from the HF hub cache only

	const pipe = await pipeline('feature-extraction', modelId, {
		dtype: 'q8',
		progress_callback: onProgress,
	});
	return pipe;
}
