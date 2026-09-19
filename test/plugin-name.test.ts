import { describe, it, expect, beforeEach } from 'vitest';
import { pluginName, setPluginName } from '../src/plugin-name';

describe('plugin-name', () => {
	beforeEach(() => {
		setPluginName('Proxima');
	});

	it('returns default fallback name when unchanged', () => {
		expect(pluginName()).toBe('Proxima');
	});

	it('allows updating the plugin name via setPluginName', () => {
		setPluginName('My Second Brain');
		expect(pluginName()).toBe('My Second Brain');
	});
});
