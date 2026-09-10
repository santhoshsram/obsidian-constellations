import { describe, it, expect } from 'vitest';
import {
	EMBEDDING_MODELS,
	BENCHMARK_MODELS,
	DEFAULT_MODEL,
} from '../../src/embed/models';

describe('model registry', () => {
	it('exposes a dropdown-safe list of model ids with distinct dims', () => {
		const ids = Object.keys(EMBEDDING_MODELS);
		expect(ids).toContain(DEFAULT_MODEL.modelId);
		expect(ids).toContain('Snowflake/snowflake-arctic-embed-xs');
		expect(ids).toContain('Xenova/all-MiniLM-L6-v2');
		expect(ids).toHaveLength(3);
	});

	it('every entry has sane batch/token budgets', () => {
		for (const spec of Object.values(EMBEDDING_MODELS)) {
			expect(spec.dimensions).toBeGreaterThan(0);
			expect(spec.batchSize).toBeGreaterThanOrEqual(1);
			expect(spec.maxTokensPerChunk).toBeGreaterThanOrEqual(128);
		}
	});

	it('benchmark list covers every non-default registry model + default', () => {
		for (const id of Object.keys(EMBEDDING_MODELS)) {
			expect(BENCHMARK_MODELS.map((m) => m.modelId)).toContain(id);
		}
	});

	it('every entry has a clean display name and hint', () => {
		for (const spec of Object.values(EMBEDDING_MODELS)) {
			expect(spec.displayName).toBeDefined();
			expect(spec.displayName?.length).toBeGreaterThan(0);
			expect(spec.hint).toBeDefined();
			expect(spec.hint?.length).toBeGreaterThan(0);
		}
	});
});