import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ConsoleLogger } from '../../src/utils/logger';

describe('ConsoleLogger', () => {
	let spy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		spy = vi.spyOn(console, 'debug').mockImplementation(() => {});
		vi.spyOn(console, 'info').mockImplementation(() => {});
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('emits debug entries only when enabled', () => {
		const disabled = new ConsoleLogger('obsidian-brain', { enabled: false });
		disabled.debug('secret timing data');
		expect(spy).not.toHaveBeenCalled();

		const enabled = new ConsoleLogger('obsidian-brain', { enabled: true });
		enabled.debug('visible timing data');
		expect(spy).toHaveBeenCalledWith(
			expect.stringMatching(/^\[obsidian-brain\] \+\d+ms debug/),
		);
		expect(String(spy.mock.calls[0]?.[0])).toContain('visible timing data');
	});

	it('allows toggling enabled at runtime', () => {
		const logger = new ConsoleLogger('obsidian-brain', { enabled: false });
		logger.debug('one');
		expect(spy).not.toHaveBeenCalled();
		logger.enabled = true;
		logger.debug('two');
		expect(spy).toHaveBeenCalledTimes(1);
	});

	it('always emits warn and error regardless of the toggle', () => {
		const logger = new ConsoleLogger('obsidian-brain', { enabled: false });
		const warnSpy = vi.spyOn(console, 'warn');
		const errorSpy = vi.spyOn(console, 'error');
		logger.warn('slow file');
		logger.error('failed to embed', new Error('boom'));
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(errorSpy).toHaveBeenCalledTimes(1);
	});
});
