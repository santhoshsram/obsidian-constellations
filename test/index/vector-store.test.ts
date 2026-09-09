import { describe, it, expect } from 'vitest';
import { BruteForceVectorStore } from '../../src/index/vector-store';

function vec(values: number[]): Float32Array {
	return new Float32Array(values);
}

describe('BruteForceVectorStore', () => {
	it('adds vectors and returns sequential rows', () => {
		const store = new BruteForceVectorStore(3);
		expect(store.dimensions).toBe(3);
		expect(store.size).toBe(0);
		expect(store.add(vec([1, 0, 0]))).toBe(0);
		expect(store.add(vec([0, 1, 0]))).toBe(1);
		expect(store.size).toBe(2);
	});

	it('rejects vectors of the wrong dimension', () => {
		const store = new BruteForceVectorStore(3);
		expect(() => store.add(vec([1, 0]))).toThrow();
	});

	it('ranks by cosine similarity, best first', () => {
		const store = new BruteForceVectorStore(2);
		store.add(vec([1, 0])); // row 0 — identical to query
		store.add(vec([1, 1])); // row 1 — 45° away
		store.add(vec([0, 1])); // row 2 — orthogonal

		const results = store.search(vec([1, 0]), 3);
		expect(results.map((r) => r.row)).toEqual([0, 1, 2]);
		expect(results[0]?.score).toBeCloseTo(1, 5);
		expect(results[1]?.score).toBeCloseTo(Math.SQRT1_2, 5);
		expect(results[2]?.score).toBeCloseTo(0, 5);
	});

	it('normalizes vectors so magnitude does not affect cosine', () => {
		const store = new BruteForceVectorStore(2);
		store.add(vec([10, 0])); // same direction as [1, 0]
		const results = store.search(vec([1, 0]), 1);
		expect(results[0]?.score).toBeCloseTo(1, 5);
	});

	it('respects topK', () => {
		const store = new BruteForceVectorStore(2);
		store.add(vec([1, 0]));
		store.add(vec([1, 1]));
		store.add(vec([0, 1]));
		expect(store.search(vec([1, 0]), 2)).toHaveLength(2);
	});

	it('filters results below minScore', () => {
		const store = new BruteForceVectorStore(2);
		store.add(vec([1, 0]));
		store.add(vec([0, 1])); // orthogonal: score 0
		const results = store.search(vec([1, 0]), 10, 0.5);
		expect(results).toHaveLength(1);
		expect(results[0]?.row).toBe(0);
	});

	it('excludes removed (tombstoned) rows from search', () => {
		const store = new BruteForceVectorStore(2);
		store.add(vec([1, 0]));
		store.add(vec([0.9, 0.1]));
		store.remove(0);
		expect(store.size).toBe(1);
		const results = store.search(vec([1, 0]), 10);
		expect(results.map((r) => r.row)).toEqual([1]);
	});

	it('get returns the stored (normalized) vector or null for tombstones', () => {
		const store = new BruteForceVectorStore(2);
		store.add(vec([3, 4])); // normalizes to [0.6, 0.8]
		const stored = store.get(0);
		expect(stored?.[0]).toBeCloseTo(0.6, 5);
		expect(stored?.[1]).toBeCloseTo(0.8, 5);
		store.remove(0);
		expect(store.get(0)).toBeNull();
	});

	it('lists active rows in ascending order', () => {
		const store = new BruteForceVectorStore(2);
		store.add(vec([1, 0]));
		store.add(vec([0, 1]));
		store.add(vec([1, 1]));
		store.remove(1);
		expect(store.activeRows()).toEqual([0, 2]);
	});

	it('handles zero vectors without producing NaN scores', () => {
		const store = new BruteForceVectorStore(2);
		store.add(vec([0, 0]));
		store.add(vec([1, 0]));
		const results = store.search(vec([1, 0]), 2);
		expect(results.map((r) => r.row)).toEqual([1, 0]);
		expect(results[1]?.score).toBe(0);
	});

	it('returns an empty result for an empty store', () => {
		const store = new BruteForceVectorStore(2);
		expect(store.search(vec([1, 0]), 10)).toEqual([]);
	});
});
