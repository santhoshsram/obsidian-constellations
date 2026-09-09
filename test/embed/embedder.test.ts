import { describe, it, expect } from 'vitest';
import { TransformersEmbedder } from '../../src/embed/embedder';
import { NOMIC_EMBED_TEXT_V1_5 } from '../../src/embed/models';

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
		const embedder = new TransformersEmbedder(fn, NOMIC_EMBED_TEXT_V1_5);
		await embedder.embedDocuments(['chunk one', 'chunk two']);
		expect(calls[0]).toEqual([
			'search_document: chunk one',
			'search_document: chunk two',
		]);
	});

	it('prefixes queries with the model query prefix', async () => {
		const { fn, calls } = fakePipe(768);
		const embedder = new TransformersEmbedder(fn, NOMIC_EMBED_TEXT_V1_5);
		await embedder.embedQuery('what is async?');
		expect(calls[0]).toEqual(['search_query: what is async?']);
	});

	it('slices the result tensor into one vector per text', async () => {
		const { fn } = fakePipe(3);
		const embedder = new TransformersEmbedder(fn, {
			...NOMIC_EMBED_TEXT_V1_5,
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
			...NOMIC_EMBED_TEXT_V1_5,
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
			...NOMIC_EMBED_TEXT_V1_5,
			dimensions: 4,
		});
		const vector = await embedder.embedQuery('q');
		expect(vector).toBeInstanceOf(Float32Array);
		expect(vector).toHaveLength(4);
	});
});
