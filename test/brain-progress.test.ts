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

vi.mock('../src/embed/pipeline', () => ({
	createEmbeddingPipeline: (...args: unknown[]) =>
		(mockCreateEmbeddingPipeline as (...a: unknown[]) => unknown)(...args),
	createRerankerPipeline: (...args: unknown[]) =>
		(mockCreateRerankerPipeline as (...a: unknown[]) => unknown)(...args),
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

		// Check statuses include reranker downloading and scanning vault
		expect(statuses).toContain('Brain: downloading model 100%');
		expect(statuses).toContain('Brain: loading reranker…');
		expect(statuses).toContain('Brain: downloading reranker 50%');
		expect(statuses).toContain('Brain: scanning vault…');
		expect(statuses[statuses.length - 1]).toBe('');

		// Check progress files include transition messages
		expect(progressFiles).toContain('Downloading model.onnx (100%)');
		expect(progressFiles).toContain('Scanning vault for changes…');
	});
});
