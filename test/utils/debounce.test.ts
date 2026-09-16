import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { debounce } from '../../src/utils/debounce';
// Side-effect import: shims `window` onto globalThis so window.setTimeout
// resolves under Node's test environment, matching the Electron renderer.
import 'obsidian';

describe('debounce', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('calls the function once after the wait period', () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 100);
		debounced();
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('resets the timer on repeated calls', () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 100);
		debounced();
		vi.advanceTimersByTime(50);
		debounced();
		vi.advanceTimersByTime(50);
		expect(fn).not.toHaveBeenCalled();
		vi.advanceTimersByTime(50);
		expect(fn).toHaveBeenCalledTimes(1);
	});

	it('passes the latest arguments', () => {
		const fn = vi.fn();
		const debounced = debounce((x: number) => {
			fn(x);
		}, 100);
		debounced(1);
		debounced(2);
		vi.advanceTimersByTime(100);
		expect(fn).toHaveBeenCalledWith(2);
	});

	it('cancels any pending invocation when cancel is called', () => {
		const fn = vi.fn();
		const debounced = debounce(fn, 100);
		debounced();
		debounced.cancel();
		vi.advanceTimersByTime(100);
		expect(fn).not.toHaveBeenCalled();
	});
});
