import { describe, it, expect } from 'vitest';
import { ChunkIndex } from '../../src/index/chunk-index';
import type { NewChunk } from '../../src/index/chunk-index';
import { BruteForceVectorStore } from '../../src/index/vector-store';
import {
	saveIndex,
	loadIndex,
} from '../../src/index/persistence';
import type {
	IndexStorage,
	IndexState,
} from '../../src/index/persistence';

/** In-memory storage fake standing in for Obsidian's DataAdapter. */
class MemStorage implements IndexStorage {
	binaries = new Map<string, ArrayBuffer>();
	jsons = new Map<string, unknown>();

	async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
		this.binaries.set(path, data);
	}
	async writeJson(path: string, data: unknown): Promise<void> {
		this.jsons.set(path, JSON.parse(JSON.stringify(data)) as unknown);
	}
	async readBinary(path: string): Promise<ArrayBuffer | null> {
		return this.binaries.get(path) ?? null;
	}
	async readJson(path: string): Promise<unknown> {
		return this.jsons.get(path) ?? null;
	}
	async exists(path: string): Promise<boolean> {
		return this.binaries.has(path) || this.jsons.has(path);
	}
}

function chunk(filePath: string, text: string): NewChunk {
	return { filePath, headingPath: [text], titleContext: text, text };
}

const STATE: IndexState = {
	modelId: 'nomic-ai/nomic-embed-text-v1.5',
	dimensions: 2,
	fileHashes: { 'a.md': 'hash-a', 'b.md': 'hash-b' },
};

async function buildIndex() {
	const index = new ChunkIndex(new BruteForceVectorStore(2));
	const embed = async (texts: string[]) =>
		texts.map((t) => new Float32Array(t === 'alpha' ? [1, 0] : [0, 1]));
	await index.updateFile('a.md', [chunk('a.md', 'alpha')], embed);
	await index.updateFile('b.md', [chunk('b.md', 'beta')], embed);
	return index;
}

describe('index persistence', () => {
	it('round-trips chunks, vectors and state', async () => {
		const storage = new MemStorage();
		const index = await buildIndex();
		await saveIndex(storage, index, STATE);

		const loaded = await loadIndex(storage);
		expect(loaded).not.toBeNull();
		expect(loaded?.state).toEqual(STATE);
		expect(loaded?.index.size).toBe(2);

		// Search behaves identically after reload.
		const results = loaded?.index.search(new Float32Array([1, 0]), 10) ?? [];
		expect(results.map((r) => r.record.text)).toEqual(['alpha', 'beta']);
		expect(results[0]?.score).toBeCloseTo(1, 5);
	});

	it('compacts tombstoned rows on save', async () => {
		const storage = new MemStorage();
		const index = await buildIndex();
		index.removeFile('a.md');
		await saveIndex(storage, index, STATE);

		const loaded = await loadIndex(storage);
		expect(loaded?.index.size).toBe(1);
		expect(loaded?.index.chunksForFile('a.md')).toEqual([]);
		// Remapped rows are dense from 0.
		const remaining = loaded?.index.chunksForFile('b.md') ?? [];
		expect(remaining[0]?.vectorRow).toBe(0);
	});

	it('restores the embedding cache so reload + edit reuses vectors', async () => {
		const storage = new MemStorage();
		const index = await buildIndex();
		await saveIndex(storage, index, STATE);

		const loaded = await loadIndex(storage);
		const calls: string[][] = [];
		const embed = async (texts: string[]) => {
			calls.push(texts);
			return texts.map(() => new Float32Array([1, 1]));
		};
		// Re-index a.md with one unchanged chunk ('alpha') and one new one.
		await loaded?.index.updateFile(
			'a.md',
			[chunk('a.md', 'alpha'), chunk('a.md', 'gamma')],
			embed,
		);
		expect(calls).toEqual([['gamma']]); // 'alpha' reused from cache
	});

	it('returns null when no index has been saved', async () => {
		const storage = new MemStorage();
		expect(await loadIndex(storage)).toBeNull();
	});

	it('rejects a saved index with unexpected dimensions', async () => {
		const storage = new MemStorage();
		const index = await buildIndex();
		await saveIndex(storage, index, STATE);
		await expect(loadIndex(storage, 3)).rejects.toThrow();
	});

	it('returns null and does not read chunks or vectors when expectedModelId does not match', async () => {
		const storage = new MemStorage();
		const index = await buildIndex();
		await saveIndex(storage, index, STATE);

		const readBinaryCalls: string[] = [];
		const readJsonCalls: string[] = [];
		const origReadBinary = storage.readBinary.bind(storage);
		const origReadJson = storage.readJson.bind(storage);
		storage.readBinary = async (path) => {
			readBinaryCalls.push(path);
			return origReadBinary(path);
		};
		storage.readJson = async (path) => {
			readJsonCalls.push(path);
			return origReadJson(path);
		};

		const loaded = await loadIndex(storage, {
			expectedModelId: 'different-model',
		});

		expect(loaded).toBeNull();
		expect(readBinaryCalls).toEqual([]);
		expect(readJsonCalls).toEqual(['state.json']);
	});

	it('does not read chunks or vectors when expectedDimensions does not match', async () => {
		const storage = new MemStorage();
		const index = await buildIndex();
		await saveIndex(storage, index, STATE);

		const readBinaryCalls: string[] = [];
		const readJsonCalls: string[] = [];
		const origReadBinary = storage.readBinary.bind(storage);
		const origReadJson = storage.readJson.bind(storage);
		storage.readBinary = async (path) => {
			readBinaryCalls.push(path);
			return origReadBinary(path);
		};
		storage.readJson = async (path) => {
			readJsonCalls.push(path);
			return origReadJson(path);
		};

		await expect(
			loadIndex(storage, { expectedDimensions: 999 }),
		).rejects.toThrow();

		expect(readBinaryCalls).toEqual([]);
		expect(readJsonCalls).toEqual(['state.json']);
	});
});
