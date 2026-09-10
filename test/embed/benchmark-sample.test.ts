import { describe, it, expect } from 'vitest';
import { pickLargestFiles } from '../../src/embed/benchmark';

describe('pickLargestFiles', () => {
	it('returns the N files with the largest sizes, descending', () => {
		const files = [
			{ path: 'small.md', size: 100 },
			{ path: 'big.md', size: 5000 },
			{ path: 'mid.md', size: 900 },
		];
		expect(pickLargestFiles(files, 2).map((f) => f.path)).toEqual([
			'big.md',
			'mid.md',
		]);
	});

	it('returns all files when fewer than N', () => {
		const files = [{ path: 'a.md', size: 10 }];
		expect(pickLargestFiles(files, 6)).toEqual(files);
	});
});