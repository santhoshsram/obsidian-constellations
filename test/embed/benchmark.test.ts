import { describe, it, expect } from 'vitest';
import {
	benchmarkOneModel,
	collectSampleTexts,
	BenchmarkSample,
} from '../../src/embed/benchmark';

/** Controlled fake pipeline we can time. */
function stubCreatePipeline(delayMs: number) {
	return async () => {
		const pipe = async (texts: string[]) => {
			await new Promise((r) => setTimeout(r, delayMs));
			const data = new Float32Array(texts.length * 2);
			return { data, dims: [texts.length, 2] };
		};
		return { pipe };
	};
}

const MODEL = {
	modelId: 'test-model',
	dimensions: 2,
	documentPrefix: '',
	queryPrefix: '',
	maxTokensPerChunk: 128,
	batchSize: 4,
	dtypes: ['q8'],
	maxLength: 512,
};

describe('collectSampleTexts', () => {
	it('flattens chunks from multiple files into strings', () => {
		const samples: BenchmarkSample[] = [
			{ path: 'a.md', chunks: [{ text: 'one' }, { text: 'two' }] },
			{ path: 'b.md', chunks: [{ text: 'three' }] },
		];
		expect(collectSampleTexts(samples)).toEqual(['one', 'two', 'three']);
	});

	it('caps the sample at the provided limit', () => {
		const samples: BenchmarkSample[] = [
			{ path: 'a.md', chunks: [{ text: 'one' }, { text: 'two' }, { text: 'three' }] },
		];
		expect(collectSampleTexts(samples, 2)).toEqual(['one', 'two']);
	});

	it('applies the model document prefix to each sample', () => {
		const samples: BenchmarkSample[] = [
			{ path: 'a.md', chunks: [{ text: 'one' }] },
		];
		expect(collectSampleTexts(samples, 10, 'search_document: ')).toEqual([
			'search_document: one',
		]);
	});
});

describe('benchmarkOneModel', () => {
	it('times warmup + one run and returns overall throughput', async () => {
		const res = await benchmarkOneModel(MODEL, ['a', 'b', 'c', 'd'], {
			createPipeline: stubCreatePipeline(5),
			warmupMs: 0,
		});
		expect(res.chunks).toBe(4);
		// 4 chunks with a 5ms-per-batch fake; overall should be > 0
		expect(res.batchCount).toBe(1);
		expect(res.ms).toBeGreaterThanOrEqual(0);
	});
});