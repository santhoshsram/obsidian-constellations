import { describe, it, expect, vi, beforeEach } from 'vitest';
import ConstellationsPlugin from '../src/main';
import { pluginName } from '../src/plugin-name';
import { VIEW_TYPE_RELATED } from '../src/ui/related-notes-view';
import type { App, Command, PluginManifest, WorkspaceLeaf } from 'obsidian';

interface MockWorkspace {
	onLayoutReady: ReturnType<typeof vi.fn>;
	getLeavesOfType: ReturnType<typeof vi.fn>;
	getRightLeaf: ReturnType<typeof vi.fn>;
	revealLeaf: ReturnType<typeof vi.fn>;
}

describe('ConstellationsPlugin', () => {
	let plugin: ConstellationsPlugin;
	let registeredCommands: Command[];
	let registeredViews: Record<string, unknown>;
	let mockWorkspace: MockWorkspace;
	let addRibbonIconSpy: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		registeredCommands = [];
		registeredViews = {};

		mockWorkspace = {
			onLayoutReady: vi.fn(),
			getLeavesOfType: vi.fn().mockReturnValue([]),
			getRightLeaf: vi.fn().mockReturnValue({
				setViewState: vi.fn().mockResolvedValue(undefined),
			}),
			revealLeaf: vi.fn().mockResolvedValue(undefined),
		};

		const mockApp = {
			workspace: mockWorkspace,
		} as unknown as App;

		const mockManifest: PluginManifest = {
			id: 'constellations',
			name: 'Test Brain Plugin',
			version: '0.1.0',
			minAppVersion: '1.7.2',
			description: '',
			author: '',
		};

		plugin = new ConstellationsPlugin(mockApp, mockManifest);
		plugin.addCommand = vi.fn((cmd: Command) => {
			registeredCommands.push(cmd);
			return cmd;
		});
		plugin.registerView = vi.fn((type: string, viewCreator: unknown) => {
			registeredViews[type] = viewCreator;
		});
		plugin.loadData = vi.fn().mockResolvedValue({});
		plugin.addSettingTab = vi.fn();
		plugin.addStatusBarItem = vi.fn().mockReturnValue({ setText: vi.fn() });
		addRibbonIconSpy = vi.fn().mockReturnValue({});
		plugin.addRibbonIcon = addRibbonIconSpy;
	});

	it('initializes plugin display name from manifest in onload', async () => {
		await plugin.onload();
		expect(pluginName()).toBe('Test Brain Plugin');
	});

	it('registers sidebar view in onload', async () => {
		await plugin.onload();
		expect(registeredViews[VIEW_TYPE_RELATED]).toBeDefined();
	});

	it('registers consolidated commands including open-constellation-graph', async () => {
		await plugin.onload();

		const commandIds = registeredCommands.map((c) => c.id);
		expect(commandIds).toContain('reindex-notes');
		expect(commandIds).toContain('show-related-notes');
		expect(commandIds).toContain('open-constellation-graph');

		// Old notice commands should no longer exist
		expect(commandIds).not.toContain('find-related-notes');
		expect(commandIds).not.toContain('find-related-notes-maxsim');
		expect(commandIds).not.toContain('find-related-notes-cursor');
		expect(commandIds).not.toContain('find-related-notes-mean');
	});

	it('registers ribbon icon for Open Constellation Graph', async () => {
		await plugin.onload();
		expect(addRibbonIconSpy).toHaveBeenCalledWith(
			'brain-circuit',
			'Open constellation graph',
			expect.any(Function),
		);
	});

	it('reveals existing leaf when show-related-notes executes', async () => {
		const mockLeaf = { id: 'leaf-1' } as unknown as WorkspaceLeaf;
		mockWorkspace.getLeavesOfType.mockReturnValue([mockLeaf]);

		await plugin.onload();
		const showCommand = registeredCommands.find((c) => c.id === 'show-related-notes');
		await showCommand?.callback?.();

		expect(mockWorkspace.revealLeaf).toHaveBeenCalledWith(mockLeaf);
	});

	it('creates and reveals right leaf when no leaf exists', async () => {
		const mockRightLeaf = {
			setViewState: vi.fn().mockResolvedValue(undefined),
		};
		mockWorkspace.getLeavesOfType.mockReturnValue([]);
		mockWorkspace.getRightLeaf.mockReturnValue(mockRightLeaf);

		await plugin.onload();
		const showCommand = registeredCommands.find((c) => c.id === 'show-related-notes');
		await showCommand?.callback?.();

		expect(mockWorkspace.getRightLeaf).toHaveBeenCalledWith(false);
		expect(mockRightLeaf.setViewState).toHaveBeenCalledWith({
			type: VIEW_TYPE_RELATED,
			active: true,
		});
		expect(mockWorkspace.revealLeaf).toHaveBeenCalledWith(mockRightLeaf);
	});
});
