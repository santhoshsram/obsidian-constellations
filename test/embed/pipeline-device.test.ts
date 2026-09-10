import { describe, it, expect, vi } from 'vitest';
import { selectDeviceConfig } from '../../src/embed/pipeline';

describe('selectDeviceConfig', () => {
	it('prefers WebGPU when available', () => {
		const { config } = selectDeviceConfig(true);
		expect(config.device).toBe('webgpu');
	});

	it('falls back to WASM when WebGPU is unavailable', () => {
		const { config } = selectDeviceConfig(false);
		expect(config.device).toBeUndefined();
		expect(config.dtype).toBe('q8');
	});

	it('returns the full ordered list of fallback configs', () => {
		const { fallbacks } = selectDeviceConfig(true);
		expect(fallbacks).toHaveLength(3);
		expect(fallbacks[0]).toMatchObject({ device: 'webgpu', dtype: 'q8' });
		expect(fallbacks[1]).toMatchObject({ dtype: 'q8' });
		expect(fallbacks[2]).toEqual({});
	});
});

describe('isModelCached', () => {
	it('returns false when caches global is undefined', async () => {
		const { isModelCached } = await import('../../src/embed/pipeline');
		const result = await isModelCached('test-model');
		expect(result).toBe(false);
	});

	it('returns true when model is present in CacheStorage', async () => {
		const mockCache = {
			keys: vi.fn(async () => [
				{ url: 'https://huggingface.co/onnx-community/model-a/model.onnx' },
			]),
		};
		const globalObj = globalThis as { caches?: unknown };
		globalObj.caches = {
			open: vi.fn(async () => mockCache),
		};

		try {
			const { isModelCached } = await import('../../src/embed/pipeline');
			const result = await isModelCached('model-a');
			expect(result).toBe(true);

			const notFound = await isModelCached('model-b');
			expect(notFound).toBe(false);
		} finally {
			delete globalObj.caches;
		}
	});
});
