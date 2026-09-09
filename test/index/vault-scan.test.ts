import { describe, it, expect } from 'vitest';
import { diffVaultFiles } from '../../src/index/vault-scan';

describe('diffVaultFiles', () => {
	it('indexes everything on first run (empty previous state)', () => {
		const { toIndex, toRemove } = diffVaultFiles(
			{ 'a.md': 'h1', 'b.md': 'h2' },
			{},
		);
		expect(toIndex.sort()).toEqual(['a.md', 'b.md']);
		expect(toRemove).toEqual([]);
	});

	it('skips unchanged files', () => {
		const { toIndex, toRemove } = diffVaultFiles(
			{ 'a.md': 'h1', 'b.md': 'h2' },
			{ 'a.md': 'h1', 'b.md': 'h2' },
		);
		expect(toIndex).toEqual([]);
		expect(toRemove).toEqual([]);
	});

	it('indexes only changed files', () => {
		const { toIndex, toRemove } = diffVaultFiles(
			{ 'a.md': 'h1', 'b.md': 'h2-changed' },
			{ 'a.md': 'h1', 'b.md': 'h2' },
		);
		expect(toIndex).toEqual(['b.md']);
		expect(toRemove).toEqual([]);
	});

	it('removes files that no longer exist', () => {
		const { toIndex, toRemove } = diffVaultFiles(
			{ 'a.md': 'h1' },
			{ 'a.md': 'h1', 'deleted.md': 'h9' },
		);
		expect(toIndex).toEqual([]);
		expect(toRemove).toEqual(['deleted.md']);
	});

	it('handles a mix of added, changed, unchanged and removed', () => {
		const { toIndex, toRemove } = diffVaultFiles(
			{ 'same.md': 'h1', 'changed.md': 'new', 'added.md': 'h3' },
			{ 'same.md': 'h1', 'changed.md': 'old', 'gone.md': 'h4' },
		);
		expect(toIndex.sort()).toEqual(['added.md', 'changed.md']);
		expect(toRemove).toEqual(['gone.md']);
	});
});
