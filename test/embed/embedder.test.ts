import { describe, it, expect } from 'vitest';
import { TransformersEmbedder } from '../../src/embed/embedder';
import type { EmbeddingModelSpec } from '../../src/embed/models';

const TEST_MODEL: EmbeddingModelSpec = {
	modelId: 'test/embedding-model',
	dimensions: 768,
	documentPrefix: 'search_document: ',
	queryPrefix: 'search_query: ',
	maxTokensPerChunk: 2048,
	batchSize: 16,
	dtypes: ['fp16', 'q8', 'fp32'],
	maxLength: 2048,
};

/** Fake transformers.js feature-extraction pipeline. */
function fakePipe(dimensions: number) {
	const calls: string[][] = [];
	const fn = async (texts: string[]) => {
		calls.push(texts);
		const data = new Float32Array(texts.length * dimensions);
		for (let r = 0; r < texts.length; r++) {
			data[r * dimensions] = r + 1; // mark rows for identification
		}
		return { data, dims: [texts.length, dimensions] };
	};
	return { fn, calls };
}

describe('TransformersEmbedder', () => {
	it('prefixes documents with the model document prefix', async () => {
		const { fn, calls } = fakePipe(768);
		const embedder = new TransformersEmbedder(fn, TEST_MODEL);
		await embedder.embedDocuments(['chunk one', 'chunk two']);
		expect(calls[0]).toEqual([
			'search_document: chunk one',
			'search_document: chunk two',
		]);
	});

	it('pre-truncates inputs to maxLength * 3 chars (position-embedding safety)', async () => {
		// FeatureExtractionPipeline._call ignores truncation/max_length options,
		// so we guard by slicing texts before the pipe call.
		const seen: string[][] = [];
		const pipe = async (
			texts: string[],
			_options?: Record<string, unknown>,
		) => {
			seen.push(texts);
			return {
				data: new Float32Array(texts.length * 2),
				dims: [texts.length, 2],
			};
		};
		const maxLength = 10; // small limit for easy verification
		const embedder = new TransformersEmbedder(pipe, {
			...TEST_MODEL,
			maxLength,
			documentPrefix: '',
			queryPrefix: '',
		});
		const longText = 'a'.repeat(maxLength * 3 + 50); // definitely over budget
		await embedder.embedDocuments([longText]);
		await embedder.embedQuery(longText);
		for (const batch of seen) {
			for (const text of batch) {
				expect(text.length).toBeLessThanOrEqual(maxLength * 3);
			}
		}
	});

	it('prefixes queries with the model query prefix', async () => {
		const { fn, calls } = fakePipe(768);
		const embedder = new TransformersEmbedder(fn, TEST_MODEL);
		await embedder.embedQuery('what is async?');
		expect(calls[0]).toEqual(['search_query: what is async?']);
	});

	it('slices the result tensor into one vector per text', async () => {
		const { fn } = fakePipe(3);
		const embedder = new TransformersEmbedder(fn, {
			...TEST_MODEL,
			dimensions: 3,
		});
		const vectors = await embedder.embedDocuments(['a', 'b']);
		expect(vectors).toHaveLength(2);
		expect(vectors[0]).toHaveLength(3);
		expect(vectors[0]?.[0]).toBeCloseTo(1, 5); // row marker 1
		expect(vectors[1]?.[0]).toBeCloseTo(2, 5); // row marker 2
	});

	it('embeds in batches', async () => {
		const { fn, calls } = fakePipe(2);
		const embedder = new TransformersEmbedder(fn, {
			...TEST_MODEL,
			dimensions: 2,
			batchSize: 2,
		});
		const vectors = await embedder.embedDocuments(['a', 'b', 'c', 'd', 'e']);
		expect(calls.map((c) => c.length)).toEqual([2, 2, 1]);
		expect(vectors).toHaveLength(5);
	});

	it('embedQuery returns a single vector', async () => {
		const { fn } = fakePipe(4);
		const embedder = new TransformersEmbedder(fn, {
			...TEST_MODEL,
			dimensions: 4,
		});
		const vector = await embedder.embedQuery('q');
		expect(vector).toBeInstanceOf(Float32Array);
		expect(vector).toHaveLength(4);
	});
});
