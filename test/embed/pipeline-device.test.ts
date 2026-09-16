import { describe, it, expect, vi } from 'vitest';
// Side-effect import: shims `window` onto globalThis so window.caches
// resolves under Node's test environment, matching the Electron renderer.
import 'obsidian';

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
		const windowObj = window as unknown as { caches?: unknown };
		windowObj.caches = {
			open: vi.fn(async () => mockCache),
		};

		try {
			const { isModelCached } = await import('../../src/embed/pipeline');
			const result = await isModelCached('model-a');
			expect(result).toBe(true);

			const notFound = await isModelCached('model-b');
			expect(notFound).toBe(false);
		} finally {
			delete windowObj.caches;
		}
	});

	it('returns false when only metadata is present but not .onnx weights', async () => {
		const mockCache = {
			keys: vi.fn(async () => [
				{ url: 'https://huggingface.co/onnx-community/model-a/tokenizer.json' },
				{ url: 'https://huggingface.co/onnx-community/model-a/config.json' },
			]),
		};
		const windowObj = window as unknown as { caches?: unknown };
		windowObj.caches = {
			open: vi.fn(async () => mockCache),
		};

		try {
			const { isModelCached } = await import('../../src/embed/pipeline');
			const result = await isModelCached('model-a');
			expect(result).toBe(false);
		} finally {
			delete windowObj.caches;
		}
	});
});
