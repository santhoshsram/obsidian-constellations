import { describe, it, expect } from 'vitest';
import { Brain } from '../src/brain';
import { ChunkIndex } from '../src/index/chunk-index';
import { BruteForceVectorStore } from '../src/index/vector-store';
import type ProximaPlugin from '../src/main';

describe('Brain.getGraphData', () => {
	it('returns empty graph when brain is not ready', async () => {
		const mockPlugin = {
			settings: {
				maxRelatedNotes: 10,
				minScore: 0.45,
			},
		} as unknown as ProximaPlugin;

		const brain = new Brain(mockPlugin);
		const data = await brain.getGraphData({ type: 'note', path: 'Foo.md' });
		expect(data.nodes).toEqual([]);
		expect(data.edges).toEqual([]);
	});

	it('builds graph when index is present and brain is ready', async () => {
		const mockPlugin = {
			settings: {
				maxRelatedNotes: 10,
				minScore: 0.45,
			},
		} as unknown as ProximaPlugin;

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

	it('includes 2-hop satellites and secondary edges by default', async () => {
		const mockPlugin = {
			settings: {
				maxRelatedNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.45,
				retrievalStrategy: 'document',
			},
		} as unknown as ProximaPlugin;

		const brain = new Brain(mockPlugin);
		const index = new ChunkIndex(new BruteForceVectorStore(4));
		// Seed: N1 [1, 0, 0, 0]
		await index.updateFile(
			'N1.md',
			[{ filePath: 'N1.md', headingPath: [], titleContext: 'N1', text: 'n1' }],
			async () => [new Float32Array([1, 0, 0, 0])],
		);
		// Hop 1: N2 [0.8, 0.6, 0, 0] - sim to N1 = 0.8 (>= 0.45)
		await index.updateFile(
			'N2.md',
			[{ filePath: 'N2.md', headingPath: [], titleContext: 'N2', text: 'n2' }],
			async () => [new Float32Array([0.8, 0.6, 0, 0])],
		);
		// Hop 2: N3 [0, 0.9, 0.435, 0] - sim to N1 = 0 (< 0.45), sim to N2 = 0.6 * 0.9 = 0.54 (>= 0.45)
		await index.updateFile(
			'N3.md',
			[{ filePath: 'N3.md', headingPath: [], titleContext: 'N3', text: 'n3' }],
			async () => [new Float32Array([0, 0.9, 0.435, 0])],
		);

		const testBrain = brain as unknown as { index: ChunkIndex; ready: boolean };
		testBrain.index = index;
		testBrain.ready = true;

		const data = await brain.getGraphData({ type: 'note', path: 'N1.md' });
		const hop2Nodes = data.nodes.filter((n) => n.hop === 2);
		expect(hop2Nodes.length).toBeGreaterThanOrEqual(1);
		expect(data.edges.some((e) => e.isSecondary)).toBe(true);
	});
});
