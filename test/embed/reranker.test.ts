import { describe, it, expect, vi } from 'vitest';
import { TransformersReranker } from '../../src/embed/reranker';
import type { RerankerModelSpec } from '../../src/embed/models';

const TEST_RERANKER_SPEC: RerankerModelSpec = {
	modelId: 'test/reranker',
	batchSize: 2,
	maxLength: 512,
	dtypes: ['fp16', 'fp32'],
};

describe('TransformersReranker', () => {
	it('returns empty array when given empty pairs', async () => {
		const mockPipe = vi.fn();
		const reranker = new TransformersReranker(mockPipe, TEST_RERANKER_SPEC);
		const scores = await reranker.rerankPairs([]);
		expect(scores).toEqual([]);
		expect(mockPipe).not.toHaveBeenCalled();
	});

	it('batches pairs according to batchSize and returns scores', async () => {
		const mockPipe = vi.fn().mockImplementation(async (pairs: Array<{ query: string; passage: string }>) => {
			return pairs.map((_: unknown, i: number) => 0.5 + i * 0.1);
		});

		const reranker = new TransformersReranker(mockPipe, TEST_RERANKER_SPEC);
		const pairs = [
			{ query: 'q1', passage: 'p1' },
			{ query: 'q1', passage: 'p2' },
			{ query: 'q1', passage: 'p3' },
		];

		const scores = await reranker.rerankPairs(pairs);
		expect(scores).toHaveLength(3);
		expect(mockPipe).toHaveBeenCalledTimes(2);
		expect(mockPipe).toHaveBeenNthCalledWith(1, [
			{ query: 'q1', passage: 'p1' },
			{ query: 'q1', passage: 'p2' },
		]);
		expect(mockPipe).toHaveBeenNthCalledWith(2, [
			{ query: 'q1', passage: 'p3' },
		]);
	});

	it('rerank(query, passages) converts passages to pairs', async () => {
		const mockPipe = vi.fn().mockResolvedValue([0.9, 0.4]);
		const reranker = new TransformersReranker(mockPipe, {
			...TEST_RERANKER_SPEC,
			batchSize: 10,
		});

		const scores = await reranker.rerank('my query', ['doc 1', 'doc 2']);
		expect(scores).toEqual([0.9, 0.4]);
		expect(mockPipe).toHaveBeenCalledWith([
			{ query: 'my query', passage: 'doc 1' },
			{ query: 'my query', passage: 'doc 2' },
		]);
	});
});
