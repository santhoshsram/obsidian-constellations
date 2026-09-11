import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BufferedLogFile } from '../../src/utils/file-log';
import type { LogTextStore } from '../../src/utils/file-log';

class FakeStore implements LogTextStore {
	content = '';
	written = 0;
	async read(): Promise<string | null> {
		return this.content === '' ? null : this.content;
	}
	async write(content: string): Promise<void> {
		this.content = content;
		this.written++;
	}
}

describe('BufferedLogFile', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	it('loads existing lines from the store on init', async () => {
		const store = new FakeStore();
		store.content = 'line1\nline2';
		const f = new BufferedLogFile(store, 500);
		await f.init();
		expect(f.snapshot()).toEqual(['line1', 'line2']);
	});

	it('buffers appended lines until the debounce elapses', async () => {
		const store = new FakeStore();
		const f = new BufferedLogFile(store, 500);
		await f.init();
		f.append('a');
		f.append('b');
		expect(store.written).toBe(0); // not yet flushed
		await vi.advanceTimersByTimeAsync(500);
		expect(store.written).toBe(1);
		expect(store.content).toContain('a');
		expect(store.content).toContain('b');
	});

	it('writes the combined buffer on flush', async () => {
		const store = new FakeStore();
		store.content = 'old';
		const f = new BufferedLogFile(store, 500);
		await f.init();
		f.append('newline');
		await f.flush();
		expect(store.content).toMatch(/old/);
		expect(store.content).toMatch(/newline/);
	});

	it('truncates existing content on init when exceeding maxLines', async () => {
		const store = new FakeStore();
		store.content = ['l1', 'l2', 'l3', 'l4', 'l5'].join('\n');
		const f = new BufferedLogFile(store, 500, 3); // maxLines = 3
		await f.init();
		expect(f.snapshot()).toEqual(['l3', 'l4', 'l5']);
	});

	it('rotates rolling buffer FIFO when appended lines exceed maxLines', async () => {
		const store = new FakeStore();
		const f = new BufferedLogFile(store, 500, 3); // maxLines = 3
		await f.init();
		f.append('l1');
		f.append('l2');
		f.append('l3');
		f.append('l4');
		f.append('l5');
		expect(f.snapshot()).toEqual(['l3', 'l4', 'l5']);
		await f.flush();
		expect(store.content).toBe('l3\nl4\nl5\n');
	});

	it('clears all buffered lines and persists empty store on clear()', async () => {
		const store = new FakeStore();
		store.content = 'line1\nline2';
		const f = new BufferedLogFile(store, 500, 3);
		await f.init();
		expect(f.snapshot()).toHaveLength(2);
		await f.clear();
		expect(f.snapshot()).toEqual([]);
		expect(store.content).toBe('');
	});
});