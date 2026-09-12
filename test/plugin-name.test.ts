import { describe, it, expect, beforeEach } from 'vitest';
import { pluginName, setPluginName } from '../src/plugin-name';

describe('plugin-name', () => {
	beforeEach(() => {
		setPluginName('Constellations');
	});

	it('returns default fallback name when unchanged', () => {
		expect(pluginName()).toBe('Constellations');
	});

	it('allows updating the plugin name via setPluginName', () => {
		setPluginName('My Second Brain');
		expect(pluginName()).toBe('My Second Brain');
	});
});
