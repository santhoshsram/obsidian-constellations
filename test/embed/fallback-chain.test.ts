import { describe, it, expect } from 'vitest';
import { buildFallbackChain } from '../../src/embed/pipeline';
import type { EmbeddingModelSpec } from '../../src/embed/models';

const BASE: EmbeddingModelSpec = {
	modelId: 'test-model',
	dimensions: 2,
	documentPrefix: '',
	queryPrefix: '',
	maxTokensPerChunk: 128,
	batchSize: 4,
	dtypes: ['fp16', 'q8', 'fp32'],
	maxLength: 512,
};

describe('buildFallbackChain', () => {
	it('orders webgpu dtypes from the spec, then wasm fallbacks', () => {
		const chain = buildFallbackChain(BASE, true);
		expect(chain).toEqual([
			{ device: 'webgpu', dtype: 'fp16' },
			{ device: 'webgpu', dtype: 'q8' },
			{ device: 'webgpu', dtype: 'fp32' },
			{ dtype: 'q8' },
			{},
		]);
	});

	it('skips webgpu entries entirely when WebGPU is unavailable', () => {
		const chain = buildFallbackChain(BASE, false);
		expect(chain).toEqual([{ dtype: 'q8' }, {}]);
	});

	it('restricts to shipped variants (bge-micro: fp32 + q8 only)', () => {
		const micro = { ...BASE, dtypes: ['q8', 'fp32'] as const };
		const chain = buildFallbackChain(
			{ ...BASE, dtypes: [...micro.dtypes] },
			true,
		);
		expect(chain[0]).toEqual({ device: 'webgpu', dtype: 'q8' });
		expect(chain).not.toContainEqual({ device: 'webgpu', dtype: 'fp16' });
	});

	it('works with RerankerModelSpec', async () => {
		const { GTE_RERANKER_MODERNBERT_BASE } = await import('../../src/embed/models');
		const chain = buildFallbackChain(GTE_RERANKER_MODERNBERT_BASE, true);
		expect(chain).toEqual([
			{ device: 'webgpu', dtype: 'fp32' },
			{ dtype: 'q8' },
			{},
		]);
	});
});