import { describe, it, expect } from 'vitest';
import { Brain } from '../src/brain';
import { ChunkIndex } from '../src/index/chunk-index';
import { BruteForceVectorStore } from '../src/index/vector-store';
import type ObsidianBrainPlugin from '../src/main';

describe('Brain.getGraphData', () => {
	it('returns empty graph when brain is not ready', async () => {
		const mockPlugin = {
			settings: {
				graphHop1Count: 10,
				graphHop2Count: 5,
				graphSimilarityThreshold: 0.75,
			},
		} as unknown as ObsidianBrainPlugin;

		const brain = new Brain(mockPlugin);
		const data = await brain.getGraphData({ type: 'note', path: 'Foo.md' });
		expect(data.nodes).toEqual([]);
		expect(data.edges).toEqual([]);
	});

	it('builds graph when index is present and brain is ready', async () => {
		const mockPlugin = {
			settings: {
				graphHop1Count: 10,
				graphHop2Count: 5,
				graphSimilarityThreshold: 0.75,
			},
		} as unknown as ObsidianBrainPlugin;

		const brain = new Brain(mockPlugin);
		const index = new ChunkIndex(new BruteForceVectorStore(2));
		await index.updateFile(
			'Note1.md',
			[{ filePath: 'Note1.md', headingPath: [], titleContext: 'Note1', text: 'hello' }],
			async () => [new Float32Array([1, 0])],
		);

		// Set internal fields for test
		const testBrain = brain as unknown as { index: ChunkIndex; ready: boolean };
		testBrain.index = index;
		testBrain.ready = true;

		const data = await brain.getGraphData({ type: 'note', path: 'Note1.md' });
		expect(data.nodes.length).toBe(1);
		expect(data.nodes[0]?.id).toBe('Note1.md');
	});
});
