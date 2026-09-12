import { describe, it, expect } from 'vitest';
import { IndexingService } from '../../src/index/indexing-service';
import { INDEXING_CONFIG } from '../../src/config';
import type { VaultSource } from '../../src/index/indexing-service';
import { ChunkIndex } from '../../src/index/chunk-index';
import { BruteForceVectorStore } from '../../src/index/vector-store';
import { HeuristicTokenCounter } from '../../src/chunking/tokens';
import { DEFAULT_MODEL } from '../../src/embed/models';

/** In-memory vault fake. */
class FakeVault implements VaultSource {
	files = new Map<string, string>();
	async listMarkdown(): Promise<string[]> {
		return [...this.files.keys()];
	}
	async read(path: string): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) {
			throw new Error(`no such file: ${path}`);
		}
		return content;
	}
}

const LONG = 'content long enough to survive the minimum section length filter.';

function fakeEmbedder() {
	const calls: string[][] = [];
	return {
		dimensions: 2,
		calls,
		async embedDocuments(texts: string[]): Promise<Float32Array[]> {
			calls.push(texts);
			return texts.map(() => new Float32Array([1, 0]));
		},
		async embedQuery(): Promise<Float32Array> {
			return new Float32Array([1, 0]);
		},
	};
}

function makeService(embedder = fakeEmbedder()) {
	const index = new ChunkIndex(new BruteForceVectorStore(2));
	const service = new IndexingService(
		index,
		embedder,
		new HeuristicTokenCounter(),
		DEFAULT_MODEL,
	);
	return { service, index, embedder };
}

describe('IndexingService', () => {
	it('indexes all vault files on first sync', async () => {
		const vault = new FakeVault();
		vault.files.set('a.md', LONG);
		vault.files.set('b.md', LONG);
		const { service, index, embedder } = makeService();

		const result = await service.syncVault(vault);
		expect(result.indexed).toBe(2);
		expect(result.removed).toBe(0);
		expect(result.total).toBe(2);
		expect(index.size).toBe(2);
		expect(embedder.calls.length).toBeGreaterThan(0);
	});

	it('skips unchanged files on subsequent syncs', async () => {
		const vault = new FakeVault();
		vault.files.set('a.md', LONG);
		const { service, embedder } = makeService();

		await service.syncVault(vault);
		const callsAfterFirst = embedder.calls.length;

		const result = await service.syncVault(vault);
		expect(result.indexed).toBe(0);
		expect(result.skipped).toBe(1);
		expect(embedder.calls.length).toBe(callsAfterFirst);
	});

	it('re-indexes only modified files', async () => {
		const vault = new FakeVault();
		vault.files.set('a.md', LONG);
		vault.files.set('b.md', LONG);
		const { service } = makeService();
		await service.syncVault(vault);

		vault.files.set('b.md', LONG + ' Changed.');
		const result = await service.syncVault(vault);
		expect(result.indexed).toBe(1);
		expect(result.skipped).toBe(1);
	});

	it('removes deleted files from the index', async () => {
		const vault = new FakeVault();
		vault.files.set('a.md', LONG);
		vault.files.set('b.md', LONG);
		const { service, index } = makeService();
		await service.syncVault(vault);

		vault.files.delete('a.md');
		const result = await service.syncVault(vault);
		expect(result.removed).toBe(1);
		expect([...index.indexedFiles()]).toEqual(['b.md']);
	});

	it('tracks file hashes in its state for persistence', async () => {
		const vault = new FakeVault();
		vault.files.set('a.md', LONG);
		const { service } = makeService();
		await service.syncVault(vault);

		const state = service.getState();
		expect(state.modelId).toBe(DEFAULT_MODEL.modelId);
		expect(state.dimensions).toBe(DEFAULT_MODEL.dimensions);
		expect(Object.keys(state.fileHashes)).toEqual(['a.md']);
	});

	it('restores file hashes from a loaded state', async () => {
		const vault = new FakeVault();
		vault.files.set('a.md', LONG);
		const { service } = makeService();
		await service.syncVault(vault);
		const state = service.getState();

		// New service (fresh embedder) restored from state: no re-embedding.
		const { service: restored, embedder } = makeService();
		restored.setState(state);
		const result = await restored.syncVault(vault);
		expect(result.skipped).toBe(1);
		expect(embedder.calls).toEqual([]);
	});

	it('continues indexing when a file fails and reports the failure', async () => {
		const vault = new FakeVault();
		vault.files.set('good.md', LONG);
		vault.files.set('bad.md', LONG);
		vault.files.set('good2.md', LONG);
		const { service, index } = makeService();

		// Make reading bad.md explode mid-sync by breaking its chunk content
		const origRead = vault.read.bind(vault);
		vault.read = async (path: string) => {
			if (path === 'bad.md') {
				throw new Error('read exploded');
			}
			return origRead(path);
		};

		const result = await service.syncVault(vault);
		expect(result.indexed).toBe(2);
		expect(result.failed).toBe(1);
		expect([...index.indexedFiles()].sort()).toEqual(['good.md', 'good2.md']);
	});

	it('indexFile and removeFile keep hashes in sync', async () => {
		const { service, index } = makeService();
		await service.indexFile('x.md', LONG);
		expect(index.chunksForFile('x.md')).toHaveLength(1);
		expect(service.getState().fileHashes['x.md']).toBeDefined();

		service.removeFile('x.md');
		expect(index.chunksForFile('x.md')).toEqual([]);
		expect(service.getState().fileHashes['x.md']).toBeUndefined();
	});

	it('embeds batches concurrently up to INDEXING_CONFIG.embeddingConcurrency', async () => {
		let activeCalls = 0;
		let maxActiveCalls = 0;

		const embedder = {
			dimensions: 2,
			calls: [] as string[][],
			async embedDocuments(texts: string[]): Promise<Float32Array[]> {
				activeCalls++;
				if (activeCalls > maxActiveCalls) {
					maxActiveCalls = activeCalls;
				}
				await new Promise((resolve) => setTimeout(resolve, 20));
				activeCalls--;
				return texts.map((_, idx) => new Float32Array([idx, 0]));
			},
			async embedQuery(): Promise<Float32Array> {
				return new Float32Array([1, 0]);
			},
		};

		const { service, index } = makeService(embedder);

		// DEFAULT_MODEL has batchSize: 8. 40 sections -> 40 chunks -> 5 batches.
		const sections = Array.from(
			{ length: 40 },
			(_, i) => `# Section ${i}\n${LONG} ${i}`,
		).join('\n\n');

		await service.indexFile('concurrent.md', sections);

		expect(maxActiveCalls).toBeGreaterThan(1);
		expect(maxActiveCalls).toBeLessThanOrEqual(INDEXING_CONFIG.embeddingConcurrency);

		const chunks = index.chunksForFile('concurrent.md');
		expect(chunks).toHaveLength(40);
	});
});
