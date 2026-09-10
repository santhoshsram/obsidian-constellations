import { describe, it, expect, vi } from 'vitest';
import { Brain } from '../src/brain';
import type ObsidianBrainPlugin from '../src/main';

vi.mock('obsidian', () => ({
	Notice: vi.fn(),
	normalizePath: (p: string) => p,
}));

import type { PipelineProgress } from '../src/embed/pipeline';

const mockCreateEmbeddingPipeline = vi.fn(
	async (
		_model: unknown,
		progress?: (p: PipelineProgress) => void,
	) => {
		progress?.({ status: 'progress', file: 'model.onnx', progress: 100 });
		return {
			pipe: vi.fn(async () => ({ data: new Float32Array([1, 0]) })),
			device: 'webgpu',
		};
	},
);

const mockCreateRerankerPipeline = vi.fn(
	async (
		_model: unknown,
		progress?: (p: PipelineProgress) => void,
	) => {
		progress?.({ status: 'progress', file: 'reranker.onnx', progress: 50 });
		return {
			rerankPairs: vi.fn(async () => [1]),
			device: 'webgpu',
		};
	},
);

const mockIsModelCached = vi.fn(async (_modelId?: string) => false);

vi.mock('../src/embed/pipeline', () => ({
	createEmbeddingPipeline: (...args: unknown[]) =>
		(mockCreateEmbeddingPipeline as (...a: unknown[]) => unknown)(...args),
	createRerankerPipeline: (...args: unknown[]) =>
		(mockCreateRerankerPipeline as (...a: unknown[]) => unknown)(...args),
	isModelCached: (modelId: string) => mockIsModelCached(modelId),
}));

describe('Brain progress transitions during init', () => {
	it('updates progress through loading, reranker, scanning, and completion', async () => {
		const statuses: string[] = [];
		const progressFiles: string[] = [];

		const fakePlugin = {
			app: {
				vault: {
					adapter: {
						exists: vi.fn().mockResolvedValue(false),
						write: vi.fn().mockResolvedValue(undefined),
						writeBinary: vi.fn().mockResolvedValue(undefined),
						append: vi.fn().mockResolvedValue(undefined),
						mkdir: vi.fn().mockResolvedValue(undefined),
					},
					getMarkdownFiles: vi.fn(() => []),
					getFileByPath: vi.fn(),
					cachedRead: vi.fn().mockResolvedValue(''),
					on: vi.fn(),
				},
				workspace: {
					on: vi.fn(),
				},
			},
			manifest: { id: 'obsidian-brain' },
			settings: {
				embeddingModel: 'test-model',
				rerankerModel: 'cross-encoder/ettin-reranker-150m-v1',
				rerankerEnabled: true,
				retrievalStrategy: 'maxsim' as const,
				maxRelatedNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.1,
				debugLogging: false,
				lastIndexedAt: null,
			},
			setStatus: vi.fn((s: string) => statuses.push(s)),
			saveSettings: vi.fn(),
			registerEvent: vi.fn(),
		} as unknown as ObsidianBrainPlugin;

		const brain = new Brain(fakePlugin);
		brain.onProgress((p) => {
			progressFiles.push(p.currentFile);
		});

		await brain.init();

		// Check statuses include descriptive model download & check messages
		expect(statuses).toContain('Brain: downloading embedding model 100%');
		expect(statuses).toContain('Brain: loading embedding model…');
		expect(statuses).toContain('Brain: loading reranking model…');
		expect(statuses).toContain('Brain: downloading reranking model 50%');
		expect(statuses).toContain('Brain: checking for changes…');
		expect(statuses[statuses.length - 1]).toBe('');

		// Check vault progress does NOT contain model downloads
		expect(progressFiles).not.toContain('Downloading embedding model (100%)');
		expect(progressFiles).toContain('Checking vault for changes…');

		// Check model statuses
		expect(brain.embeddingStatus.state).toBe('ready');
		expect(brain.rerankerStatus.state).toBe('ready');
	});

	it('does not emit downloading status when models are already cached', async () => {
		mockIsModelCached.mockResolvedValue(true);
		const statuses: string[] = [];

		const fakePlugin = {
			app: {
				vault: {
					adapter: {
						exists: vi.fn().mockResolvedValue(false),
						write: vi.fn().mockResolvedValue(undefined),
						writeBinary: vi.fn().mockResolvedValue(undefined),
						append: vi.fn().mockResolvedValue(undefined),
						mkdir: vi.fn().mockResolvedValue(undefined),
					},
					getMarkdownFiles: vi.fn(() => []),
					getFileByPath: vi.fn(),
					cachedRead: vi.fn().mockResolvedValue(''),
					on: vi.fn(),
				},
				workspace: {
					on: vi.fn(),
				},
			},
			manifest: { id: 'obsidian-brain' },
			settings: {
				embeddingModel: 'test-model',
				rerankerModel: 'cross-encoder/ettin-reranker-150m-v1',
				rerankerEnabled: true,
				retrievalStrategy: 'maxsim' as const,
				maxRelatedNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.1,
				debugLogging: false,
				lastIndexedAt: null,
			},
			setStatus: vi.fn((s: string) => statuses.push(s)),
			saveSettings: vi.fn(),
			registerEvent: vi.fn(),
		} as unknown as ObsidianBrainPlugin;

		const brain = new Brain(fakePlugin);
		await brain.init();

		// Should NOT say downloading
		expect(statuses).not.toContain('Brain: downloading embedding model 100%');
		expect(statuses).not.toContain('Brain: downloading reranking model 50%');

		// Should say loading & checking
		expect(statuses).toContain('Brain: loading embedding model…');
		expect(statuses).toContain('Brain: loading reranking model…');
		expect(statuses).toContain('Brain: checking for changes…');
		expect(statuses[statuses.length - 1]).toBe('');
	});
});
