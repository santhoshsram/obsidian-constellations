import { describe, it, expect } from 'vitest';
import { relatedNotes } from '../../src/search/related';
import type { ScoredChunk } from '../../src/index/chunk-index';

function scored(filePath: string, text: string, score: number): ScoredChunk {
	return {
		record: {
			id: `id-${text}`,
			filePath,
			headingPath: [text],
			titleContext: text,
			text,
			vectorRow: 0,
		},
		score,
	};
}

describe('relatedNotes', () => {
	it('groups chunks by file, best note first', () => {
		const results = relatedNotes(
			[
				scored('a.md', 'a1', 0.9),
				scored('b.md', 'b1', 0.95),
				scored('a.md', 'a2', 0.8),
			],
			{ maxNotes: 10, maxChunksPerNote: 3 },
		);
		expect(results.map((r) => r.filePath)).toEqual(['b.md', 'a.md']);
		expect(results[0]?.bestScore).toBeCloseTo(0.95);
	});

	it('excludes the active note', () => {
		const results = relatedNotes(
			[scored('self.md', 's1', 0.99), scored('other.md', 'o1', 0.5)],
			{ excludeFile: 'self.md', maxNotes: 10, maxChunksPerNote: 3 },
		);
		expect(results.map((r) => r.filePath)).toEqual(['other.md']);
	});

	it('keeps only the top chunks per note, sorted by score', () => {
		const results = relatedNotes(
			[
				scored('a.md', 'worst', 0.6),
				scored('a.md', 'best', 0.9),
				scored('a.md', 'mid', 0.7),
			],
			{ maxNotes: 10, maxChunksPerNote: 2 },
		);
		expect(results[0]?.chunks.map((c) => c.record.text)).toEqual([
			'best',
			'mid',
		]);
	});

	it('limits the number of notes', () => {
		const results = relatedNotes(
			[
				scored('a.md', 'a1', 0.9),
				scored('b.md', 'b1', 0.8),
				scored('c.md', 'c1', 0.7),
			],
			{ maxNotes: 2, maxChunksPerNote: 3 },
		);
		expect(results.map((r) => r.filePath)).toEqual(['a.md', 'b.md']);
	});

	it('returns an empty list when nothing matches', () => {
		expect(
			relatedNotes([], { maxNotes: 10, maxChunksPerNote: 3 }),
		).toEqual([]);
	});
});
