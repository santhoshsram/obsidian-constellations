import { describe, it, expect } from 'vitest';
import { sha1Hex } from '../../src/index/hasher';

describe('sha1Hex', () => {
	it('produces the well-known sha1 of "hello"', async () => {
		expect(await sha1Hex('hello')).toBe(
			'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d',
		);
	});

	it('is deterministic', async () => {
		expect(await sha1Hex('obsidian brain')).toBe(await sha1Hex('obsidian brain'));
	});

	it('differs for different inputs', async () => {
		expect(await sha1Hex('a')).not.toBe(await sha1Hex('b'));
	});

	it('handles unicode', async () => {
		const hash = await sha1Hex('héllo ✦ 世界');
		expect(hash).toMatch(/^[0-9a-f]{40}$/);
	});
});
