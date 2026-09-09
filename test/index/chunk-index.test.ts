import { describe, it, expect } from 'vitest';
import { ChunkIndex } from '../../src/index/chunk-index';
import type { NewChunk } from '../../src/index/chunk-index';
import { BruteForceVectorStore } from '../../src/index/vector-store';

/** Deterministic fake embedder: known texts get axis-aligned vectors. */
function fakeEmbed(table: Record<string, number[]>) {
	const calls: string[][] = [];
	const fn = async (texts: string[]): Promise<Float32Array[]> => {
		calls.push(texts);
		return texts.map((t) => new Float32Array(table[t] ?? [0.5, 0.5]));
	};
	return { fn, calls };
}

function chunk(filePath: string, text: string, headingPath: string[] = []): NewChunk {
	return { filePath, headingPath, titleContext: headingPath.join(' '), text };
}

describe('ChunkIndex', () => {
	it('adds chunks for a file and makes them searchable', async () => {
		const { fn } = fakeEmbed({ alpha: [1, 0], beta: [0, 1] });
		const index = new ChunkIndex(new BruteForceVectorStore(2));
		await index.updateFile('a.md', [chunk('a.md', 'alpha'), chunk('a.md', 'beta')], fn);

		expect(index.size).toBe(2);
		const results = index.search(new Float32Array([1, 0]), 10);
		expect(results.map((r) => r.record.text)).toEqual(['alpha', 'beta']);
		expect(results[0]?.score).toBeCloseTo(1, 5);
		expect(results[0]?.record.filePath).toBe('a.md');
	});

	it('assigns content-addressed ids (sha1 of text)', async () => {
		const { fn } = fakeEmbed({});
		const index = new ChunkIndex(new BruteForceVectorStore(2));
		await index.updateFile('a.md', [chunk('a.md', 'hello')], fn);
		const record = index.chunksForFile('a.md')[0];
		// sha1("hello")
		expect(record?.id).toBe('aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
	});

	it('reuses embeddings for unchanged chunks when a file is edited', async () => {
		const { fn, calls } = fakeEmbed({ keep: [1, 0], old: [0, 1], new: [1, 1] });
		const index = new ChunkIndex(new BruteForceVectorStore(2));
		await index.updateFile('a.md', [chunk('a.md', 'keep'), chunk('a.md', 'old')], fn);
		expect(calls).toEqual([['keep', 'old']]);

		// Edit: 'old' -> 'new', 'keep' unchanged.
		await index.updateFile('a.md', [chunk('a.md', 'keep'), chunk('a.md', 'new')], fn);
		// Only the changed chunk is embedded.
		expect(calls[1]).toEqual(['new']);
		expect(index.size).toBe(2);

		// The reused chunk still searches correctly.
		const results = index.search(new Float32Array([1, 0]), 10);
		expect(results.map((r) => r.record.text)).toContain('keep');
	});

	it('reuses embeddings across files with identical content', async () => {
		const { fn, calls } = fakeEmbed({ shared: [1, 0] });
		const index = new ChunkIndex(new BruteForceVectorStore(2));
		await index.updateFile('a.md', [chunk('a.md', 'shared')], fn);
		await index.updateFile('b.md', [chunk('b.md', 'shared')], fn);
		expect(calls).toEqual([['shared']]); // embedded once
		expect(index.size).toBe(2);
	});

	it('removes all chunks of a deleted file', async () => {
		const { fn } = fakeEmbed({ alpha: [1, 0], beta: [0, 1] });
		const index = new ChunkIndex(new BruteForceVectorStore(2));
		await index.updateFile('a.md', [chunk('a.md', 'alpha')], fn);
		await index.updateFile('b.md', [chunk('b.md', 'beta')], fn);

		index.removeFile('a.md');
		expect(index.size).toBe(1);
		expect(index.chunksForFile('a.md')).toEqual([]);
		const results = index.search(new Float32Array([1, 0]), 10);
		expect(results.map((r) => r.record.filePath)).toEqual(['b.md']);
	});

	it('handles renames as remove + add', async () => {
		const { fn, calls } = fakeEmbed({ alpha: [1, 0] });
		const index = new ChunkIndex(new BruteForceVectorStore(2));
		await index.updateFile('old.md', [chunk('old.md', 'alpha')], fn);
		index.removeFile('old.md');
		await index.updateFile('new.md', [chunk('new.md', 'alpha')], fn);
		// Embedding reused despite the rename — no second embed call.
		expect(calls).toEqual([['alpha']]);
		expect(index.chunksForFile('new.md')).toHaveLength(1);
	});

	it('respects minScore in search', async () => {
		const { fn } = fakeEmbed({ alpha: [1, 0], beta: [0, 1] });
		const index = new ChunkIndex(new BruteForceVectorStore(2));
		await index.updateFile('a.md', [chunk('a.md', 'alpha'), chunk('a.md', 'beta')], fn);
		const results = index.search(new Float32Array([1, 0]), 10, 0.5);
		expect(results.map((r) => r.record.text)).toEqual(['alpha']);
	});

	it('tracks the set of indexed files', async () => {
		const { fn } = fakeEmbed({});
		const index = new ChunkIndex(new BruteForceVectorStore(2));
		await index.updateFile('a.md', [chunk('a.md', 'x')], fn);
		await index.updateFile('b.md', [chunk('b.md', 'y')], fn);
		index.removeFile('a.md');
		expect([...index.indexedFiles()].sort()).toEqual(['b.md']);
	});
});
