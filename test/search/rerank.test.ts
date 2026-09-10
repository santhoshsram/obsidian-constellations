import { describe, it, expect, vi } from 'vitest';
import {
	sliceChunkText,
	rerankCandidateChunks,
	type FileReader,
} from '../../src/search/rerank';
import type { ScoredChunk, ChunkRecord } from '../../src/index/chunk-index';
import type { Reranker, TextPair } from '../../src/embed/reranker';

describe('sliceChunkText', () => {
	const content = [
		'# Title',
		'',
		'First paragraph of text.',
		'Second line of first paragraph.',
		'',
		'## Section Two',
		'Second section text here.',
	].join('\n');

	it('extracts lines within startLine and endLine (0-indexed)', () => {
		const slice = sliceChunkText(content, 2, 3);
		expect(slice).toBe('First paragraph of text.\nSecond line of first paragraph.');
	});

	it('handles single line range', () => {
		const slice = sliceChunkText(content, 5, 5);
		expect(slice).toBe('## Section Two');
	});

	it('falls back to whole content if lines are undefined', () => {
		const slice = sliceChunkText(content);
		expect(slice).toBe(content.trim());
	});

	it('clamps out-of-bounds line numbers safely', () => {
		const slice = sliceChunkText(content, 0, 100);
		expect(slice).toBe(content.trim());
	});
});

describe('rerankCandidateChunks', () => {
	const fileA = 'NoteA.md';
	const fileB = 'NoteB.md';

	const fileContents: Record<string, string> = {
		[fileA]: '# Note A\n\nActive section text about neural networks.',
		[fileB]: '# Note B\n\nCandidate section text about deep learning.',
	};

	const mockFileReader: FileReader = {
		read: vi.fn(async (path: string) => {
			const c = fileContents[path];
			if (!c) throw new Error(`Not found: ${path}`);
			return c;
		}),
	};

	function makeChunk(
		id: string,
		filePath: string,
		startLine: number,
		endLine: number,
		score: number,
		sourceChunk?: ChunkRecord,
	): ScoredChunk {
		return {
			score,
			record: {
				id,
				filePath,
				startLine,
				endLine,
				headingPath: ['Heading'],
				titleContext: 'Title',
				text: 'clean text',
				vectorRow: 0,
			},
			sourceChunk,
		};
	}

	it('reads files concurrently and reranks candidate pairs', async () => {
		const sourceChunk: ChunkRecord = {
			id: 'source-1',
			filePath: fileA,
			startLine: 2,
			endLine: 2,
			headingPath: ['Note A'],
			titleContext: 'Note A',
			text: 'source text',
			vectorRow: 0,
		};

		const candidate1 = makeChunk('c1', fileB, 2, 2, 0.5, sourceChunk);
		const candidate2 = makeChunk('c2', fileB, 0, 0, 0.8, sourceChunk);		// Candidate 2 (score 0.8) is first in pool, candidate 1 (score 0.5) is second
		const mockReranker: Reranker = {
			rerankPairs: vi.fn(async (pairs: TextPair[]) => {
				expect(pairs).toHaveLength(2);
				expect(pairs[0]?.passage).toBe('# Note B');
				expect(pairs[1]?.passage).toBe('Candidate section text about deep learning.');
				// Candidate 2 gets 0.2, candidate 1 gets 0.95
				return [0.2, 0.95];
			}),
			rerank: vi.fn(),
		};

		const reranked = await rerankCandidateChunks({
			candidates: [candidate2, candidate1],
			fileReader: mockFileReader,
			reranker: mockReranker,
			topK: 50,
		});

		expect(reranked).toHaveLength(2);
		expect(reranked[0]?.record.id).toBe('c1');
		expect(reranked[0]?.score).toBe(0.95);
		expect(reranked[1]?.record.id).toBe('c2');
		expect(reranked[1]?.score).toBe(0.2);
	});

	it('limits candidate pool to topK before reranking', async () => {
		const candidates: ScoredChunk[] = [];
		for (let i = 0; i < 10; i++) {
			candidates.push(makeChunk(`c${i}`, fileB, 2, 2, i * 0.1));
		}

		const rerankPairsMock = vi.fn(async (pairs: TextPair[]) => {
			return pairs.map(() => 0.7);
		});
		const mockReranker: Reranker = {
			rerankPairs: rerankPairsMock,
			rerank: vi.fn(),
		};

		const reranked = await rerankCandidateChunks({
			candidates,
			fileReader: mockFileReader,
			reranker: mockReranker,
			topK: 5,
		});

		expect(reranked).toHaveLength(5);
		expect(rerankPairsMock).toHaveBeenCalledWith(
			expect.arrayContaining([expect.anything()]),
		);
		expect(rerankPairsMock.mock.calls[0]?.[0]).toHaveLength(5);
	});

	it('gracefully falls back to vector scores if reranker throws', async () => {
		const candidate1 = makeChunk('c1', fileB, 2, 2, 0.6);
		const candidate2 = makeChunk('c2', fileB, 0, 0, 0.9);

		const failingReranker: Reranker = {
			rerankPairs: vi.fn().mockRejectedValue(new Error('GPU OOM')),
			rerank: vi.fn(),
		};

		const reranked = await rerankCandidateChunks({
			candidates: [candidate1, candidate2],
			fileReader: mockFileReader,
			reranker: failingReranker,
			fallbackOnError: true,
		});

		expect(reranked).toHaveLength(2);
		expect(reranked[0]?.record.id).toBe('c2');
		expect(reranked[0]?.score).toBe(0.9);
		expect(reranked[1]?.record.id).toBe('c1');
		expect(reranked[1]?.score).toBe(0.6);
	});
});
