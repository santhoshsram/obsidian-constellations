import { describe, it, expect } from 'vitest';
import { meanVector, relatedToNote } from '../../src/search/retrieval';
import { ChunkIndex } from '../../src/index/chunk-index';
import type { NewChunk } from '../../src/index/chunk-index';
import { BruteForceVectorStore } from '../../src/index/vector-store';

function chunk(filePath: string, text: string): NewChunk {
	return { filePath, headingPath: [text], titleContext: text, text };
}

/** Fake embedder: known texts → fixed vectors. */
function embed(table: Record<string, number[]>) {
	return async (texts: string[]) =>
		texts.map((t) => new Float32Array(table[t] ?? [0, 0]));
}

const VECTORS: Record<string, number[]> = {
	a1: [1, 0],
	a2: [1, 0.1],
	b1: [0.9, 0.2],
	c1: [0, 1],
};

async function buildIndex(): Promise<ChunkIndex> {
	const index = new ChunkIndex(new BruteForceVectorStore(2));
	await index.updateFile('a.md', [chunk('a.md', 'a1'), chunk('a.md', 'a2')], embed(VECTORS));
	await index.updateFile('b.md', [chunk('b.md', 'b1')], embed(VECTORS));
	await index.updateFile('c.md', [chunk('c.md', 'c1')], embed(VECTORS));
	return index;
}

describe('meanVector', () => {
	it('averages component-wise', () => {
		const mean = meanVector([
			new Float32Array([1, 0]),
			new Float32Array([0, 1]),
		]);
		expect(Array.from(mean)).toEqual([0.5, 0.5]);
	});
});

describe('relatedToNote', () => {
	it('finds semantically close notes and excludes the note itself', async () => {
		const index = await buildIndex();
		const results = relatedToNote(index, 'a.md', {
			maxNotes: 10,
			maxChunksPerNote: 3,
			minScore: 0.5,
		});
		expect(results.map((r) => r.filePath)).toEqual(['b.md']);
	});

	it('returns an empty list for an unindexed note', async () => {
		const index = await buildIndex();
		expect(
			relatedToNote(index, 'ghost.md', {
				maxNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.5,
			}),
		).toEqual([]);
	});

	it('respects minScore', async () => {
		const index = await buildIndex();
		const results = relatedToNote(index, 'a.md', {
			maxNotes: 10,
			maxChunksPerNote: 3,
			minScore: 0.9999, // higher than b1's similarity to a.md's mean
		});
		expect(results).toEqual([]);
	});
});
