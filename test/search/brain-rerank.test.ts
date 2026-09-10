import { describe, it, expect, vi } from 'vitest';
import { Brain } from '../../src/brain';
import type ObsidianBrainPlugin from '../../src/main';
import { ChunkIndex } from '../../src/index/chunk-index';
import { BruteForceVectorStore } from '../../src/index/vector-store';
import type { NewChunk } from '../../src/index/chunk-index';
import type { Reranker, TextPair } from '../../src/embed/reranker';

function chunk(filePath: string, text: string, heading: string, startLine = 0, endLine = 0): NewChunk {
	return {
		filePath,
		headingPath: [heading],
		titleContext: heading,
		text,
		startLine,
		endLine,
	};
}

function mockEmbed(table: Record<string, number[]>) {
	return async (texts: string[]) =>
		texts.map((t) => new Float32Array(table[t] ?? [0, 0]));
}

describe('Brain.relatedTo with reranker', () => {
	const fileA = 'alpha.md';
	const fileB = 'beta.md';
	const fileC = 'gamma.md';

	const fileContents: Record<string, string> = {
		[fileA]: '# Alpha Note\n\nContent about compilers and parsers.',
		[fileB]: '# Beta Note\n\nContent about abstract syntax trees.',
		[fileC]: '# Gamma Note\n\nContent about code generation and optimizers.',
	};

	const VECTORS: Record<string, number[]> = {
		alpha: [1, 0],
		beta: [0.95, 0.1], // vector similarity: ~0.99
		gamma: [0.8, 0.4], // vector similarity: ~0.89
	};

	async function setupBrain(
		rerankerEnabled = true,
		extraSettings: Partial<ObsidianBrainPlugin['settings']> = {},
	): Promise<Brain> {
		const store = new BruteForceVectorStore(2);
		const index = new ChunkIndex(store);

		await index.updateFile(
			fileA,
			[chunk(fileA, 'alpha', 'Compilers', 2, 2)],
			mockEmbed(VECTORS),
		);
		await index.updateFile(
			fileB,
			[chunk(fileB, 'beta', 'AST', 2, 2)],
			mockEmbed(VECTORS),
		);
		await index.updateFile(
			fileC,
			[chunk(fileC, 'gamma', 'Codegen', 2, 2)],
			mockEmbed(VECTORS),
		);

		const fakePlugin = {
			app: {
				vault: {
					adapter: {
						exists: vi.fn().mockResolvedValue(false),
					},
					getFileByPath: vi.fn((path: string) => ({ path })),
					cachedRead: vi.fn(async (file: { path: string }) => {
						return fileContents[file.path] ?? '';
					}),
				},
				workspace: {
					on: vi.fn(),
				},
			},
			manifest: { id: 'obsidian-brain' },
			settings: {
				embeddingModel: 'test-model',
				rerankerModel: 'cross-encoder/ettin-reranker-150m-v1',
				rerankerEnabled,
				retrievalStrategy: 'maxsim' as const,
				maxRelatedNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.1,
				debugLogging: false,
				lastIndexedAt: null,
				...extraSettings,
			},
			setStatus: vi.fn(),
			saveSettings: vi.fn(),
			registerEvent: vi.fn(),
		} as unknown as ObsidianBrainPlugin;

		const brain = new Brain(fakePlugin);
		Object.assign(brain, { index, ready: true });

		return brain;
	}

	it('returns vector results when no reranker is set', async () => {
		const brain = await setupBrain();
		const results = await brain.relatedTo(fileA);
		expect(results).toHaveLength(2);
		// Beta has higher vector similarity than Gamma
		expect(results[0]?.filePath).toBe(fileB);
		expect(results[1]?.filePath).toBe(fileC);
	});

	it('applies reranker to reorder candidates when reranker is set', async () => {
		const brain = await setupBrain();

		const rerankPairsMock = vi.fn(async (pairs: TextPair[]) => {
			return pairs.map((p) => {
				if (p.passage.includes('code generation')) {
					return 0.98;
				}
				return 0.35;
			});
		});

		const mockReranker: Reranker = {
			rerankPairs: rerankPairsMock,
			rerank: vi.fn(),
		};

		brain.setReranker(mockReranker);

		const results = await brain.relatedTo(fileA);
		expect(results).toHaveLength(2);
		// Gamma is now first because cross-encoder gave it 0.98 vs 0.35
		expect(results[0]?.filePath).toBe(fileC);
		expect(results[0]?.bestScore).toBe(0.98);
		expect(results[1]?.filePath).toBe(fileB);
		expect(results[1]?.bestScore).toBe(0.35);

		expect(rerankPairsMock).toHaveBeenCalled();
	});

	it('ignores reranker if rerankerEnabled is false in settings', async () => {
		const brain = await setupBrain(false);

		const rerankPairsMock = vi.fn(async () => [0.1, 0.9]);
		const mockReranker: Reranker = {
			rerankPairs: rerankPairsMock,
			rerank: vi.fn(),
		};
		brain.setReranker(mockReranker);

		const results = await brain.relatedTo(fileA);
		// Should still be ordered by vector score: Beta first
		expect(results[0]?.filePath).toBe(fileB);
		expect(rerankPairsMock).not.toHaveBeenCalled();
	});
});
