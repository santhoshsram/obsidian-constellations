import { describe, it, expect, vi } from 'vitest';
/* eslint-disable @typescript-eslint/unbound-method -- the mock logger's
   methods are inspected as detached values (`.mock.calls`, `expect(fn)`) */
import { IndexingService } from '../../src/index/indexing-service';
import type { VaultSource } from '../../src/index/indexing-service';
import type { Logger } from '../../src/utils/logger';
import { ChunkIndex } from '../../src/index/chunk-index';
import { BruteForceVectorStore } from '../../src/index/vector-store';
import { HeuristicTokenCounter } from '../../src/chunking/tokens';
import { DEFAULT_MODEL } from '../../src/embed/models';

const LONG = 'content long enough to survive the minimum section length filter.';

class FakeVault implements VaultSource {
	files = new Map<string, string>();
	async listMarkdown(): Promise<string[]> {
		return [...this.files.keys()];
	}
	async read(path: string): Promise<string> {
		const content = this.files.get(path);
		if (content === undefined) throw new Error(`no such file: ${path}`);
		return content;
	}
}

/** Slow embedder that yields to the event loop so timers fire. */
function slowEmbedder(delayMs: number) {
	return {
		dimensions: 2,
		async embedDocuments(texts: string[]): Promise<Float32Array[]> {
			await new Promise((r) => setTimeout(r, delayMs));
			return texts.map(() => new Float32Array([1, 0]));
		},
		async embedQuery(): Promise<Float32Array> {
			return new Float32Array([1, 0]);
		},
	};
}

function mockLogger() {
	return {
		enabled: true,
		debug: vi.fn(),
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
	};
}

describe('IndexingService observability', () => {
	it('does not log individual files when indexing succeeds under the threshold', async () => {
		const vault = new FakeVault();
		vault.files.set('a.md', LONG);
		const logger = mockLogger() as unknown as Logger;
		const service = new IndexingService(
			new ChunkIndex(new BruteForceVectorStore(2)),
			slowEmbedder(0),
			new HeuristicTokenCounter(),
			DEFAULT_MODEL,
			logger,
		);
		await service.syncVault(vault);
		const info = logger.info as ReturnType<typeof vi.fn>;
		const line = info.mock.calls.find((c) =>
			String(c[0]).includes('indexed a.md'),
		);
		expect(line).toBeUndefined();
	});

	it('logs a debug entry when a file embeds slower than the slow-file threshold', async () => {
		const vault = new FakeVault();
		vault.files.set('slow.md', LONG);
		const logger = mockLogger() as unknown as Logger;
		const service = new IndexingService(
			new ChunkIndex(new BruteForceVectorStore(2)),
			slowEmbedder(60),
			new HeuristicTokenCounter(),
			DEFAULT_MODEL,
			logger,
			{ slowFileMs: 30, heartbeatMs: 200 },
		);
		await service.syncVault(vault);
		expect(logger.debug).toHaveBeenCalledWith(
			expect.stringContaining('slow.md'),
			expect.objectContaining({ kind: 'slow-file' }),
		);
	});

	it('logs embedding failure forensics with stage and preview', async () => {
		const vault = new FakeVault();
		vault.files.set('bad.md', LONG);
		const logger = mockLogger() as unknown as Logger;
		const embedder = {
			dimensions: 2,
			async embedDocuments(): Promise<Float32Array[]> {
				throw new Error('onnx exploded');
			},
			async embedQuery(): Promise<Float32Array> {
				return new Float32Array([1, 0]);
			},
		};
		const service = new IndexingService(
			new ChunkIndex(new BruteForceVectorStore(2)),
			embedder,
			new HeuristicTokenCounter(),
			DEFAULT_MODEL,
			logger,
		);
		await service.syncVault(vault);
		const err = (logger.error as ReturnType<typeof vi.fn>).mock.calls.find(
			(c) => String(c[0]).includes('failed to embed bad.md'),
		);
		expect(err).toBeDefined();
		// Structured data names the failing stage.
		expect(err?.[1]).toEqual(
			expect.objectContaining({ kind: 'index-failure', stage: 'embed' }),
		);
	});

	it('logs a sync summary line with throughput', async () => {
		const vault = new FakeVault();
		vault.files.set('a.md', LONG);
		vault.files.set('b.md', LONG);
		const logger = mockLogger() as unknown as Logger;
		const service = new IndexingService(
			new ChunkIndex(new BruteForceVectorStore(2)),
			slowEmbedder(0),
			new HeuristicTokenCounter(),
			DEFAULT_MODEL,
			logger,
		);
		await service.syncVault(vault);
		const info = logger.info as ReturnType<typeof vi.fn>;
		const summary = info.mock.calls.find((c) =>
			String(c[0]).includes('sync complete'),
		);
		expect(summary).toBeDefined();
		expect(String(summary?.[0])).toMatch(/2 files/);
		expect(String(summary?.[0])).toMatch(/new=2/);
	});
});

/* eslint-enable @typescript-eslint/unbound-method -- end: mock logger methods inspected as values */
