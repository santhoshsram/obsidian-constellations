import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS, formatLastIndexed } from '../src/settings';

describe('settings', () => {
	it('includes lastIndexedAt default as null', () => {
		expect(DEFAULT_SETTINGS.lastIndexedAt).toBeNull();
	});

	it('defaults debugLogging to false', () => {
		expect(DEFAULT_SETTINGS.debugLogging).toBe(false);
	});

	it('formats null or undefined timestamp as Never', () => {
		expect(formatLastIndexed(null)).toBe('Never');
		expect(formatLastIndexed(undefined)).toBe('Never');
	});

	it('formats a timestamp for today with time', () => {
		const now = new Date();
		const formatted = formatLastIndexed(now.getTime());
		expect(formatted).toContain('Today at');
	});

	it('formats an older timestamp with date and time', () => {
		const past = new Date('2024-01-15T12:00:00Z');
		const formatted = formatLastIndexed(past.getTime());
		expect(formatted).not.toContain('Today');
		expect(formatted).toMatch(/Jan 15/);
	});
});
