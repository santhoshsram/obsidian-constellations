import { describe, it, expect } from 'vitest';
import {
	truncateSection,
	halvedByDelimiter,
	forceSplitOversizedBlock,
	MAX_RECURSION,
} from '../../src/chunking/split';
import type { TokenCounter } from '../../src/chunking/tokens';
import { HeuristicTokenCounter } from '../../src/chunking/tokens';

/** Deterministic counter for tests: 1 character = 1 token. */
class CharCounter implements TokenCounter {
	count(text: string): number {
		return text.length;
	}
}

const counter = new CharCounter();

describe('halvedByDelimiter', () => {
	it('returns [text, ""] when the delimiter is not found', () => {
		expect(halvedByDelimiter('no newlines here', counter)).toEqual([
			'no newlines here',
			'',
		]);
	});

	it('splits directly when there are exactly two chunks', () => {
		expect(halvedByDelimiter('left\nright', counter)).toEqual([
			'left',
			'right',
		]);
	});

	it('balances tokens on each side', () => {
		const [left, right] = halvedByDelimiter(
			'aaaa\nbbbb\ncccc\ndddd',
			counter,
		);
		expect(left).toBe('aaaa\nbbbb');
		expect(right).toBe('cccc\ndddd');
	});
});

describe('truncateSection', () => {
	it('truncates to the token limit', () => {
		expect(truncateSection('hello world', counter, 5)).toBe('hello');
	});

	it('leaves text within the limit untouched', () => {
		expect(truncateSection('hi', counter, 5)).toBe('hi');
	});
});

describe('forceSplitOversizedBlock', () => {
	it('returns titles + text as a single chunk when within the limit', () => {
		expect(forceSplitOversizedBlock('Titles', 'short text', counter, 100, 100)).toEqual([
			'Titles\nshort text',
		]);
	});

	it('splits oversized text so every chunk fits, keeping titles', () => {
		const paragraph = 'x'.repeat(20);
		const text = Array(8).fill(paragraph).join('\n\n'); // ~180 chars
		const chunks = forceSplitOversizedBlock('T', text, counter, 60, 60);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.startsWith('T\n')).toBe(true);
			expect(counter.count(chunk)).toBeLessThanOrEqual(60);
		}
	});

	it('truncates when no delimiter allows a split', () => {
		const text = 'x'.repeat(100); // no \n\n, \n, '. ', or ' ' delimiters
		const chunks = forceSplitOversizedBlock('', text, counter, 10, 10);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]).toHaveLength(10);
	});

	it('splits on space delimiter when no newlines or periods exist', () => {
		const words = Array(20).fill('hello').join(' ');
		const chunks = forceSplitOversizedBlock('T', words, counter, 40, 40);
		expect(chunks.length).toBeGreaterThan(1);
		for (const chunk of chunks) {
			expect(chunk.startsWith('T\n')).toBe(true);
			expect(counter.count(chunk)).toBeLessThanOrEqual(40);
		}
	});

	it('works with the heuristic token counter', () => {
		const heuristic = new HeuristicTokenCounter();
		expect(heuristic.count('abcd')).toBe(1);
		expect(heuristic.count('abcde')).toBe(2);
		const chunks = forceSplitOversizedBlock('T', 'a'.repeat(100), heuristic, 10, 10);
		expect(chunks[0]).toBeDefined();
		expect(heuristic.count(chunks[0] ?? '')).toBeLessThanOrEqual(10);
	});
});
