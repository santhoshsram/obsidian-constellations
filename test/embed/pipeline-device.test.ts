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
