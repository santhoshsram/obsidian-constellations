import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextGraphModal } from '../../src/ui/graph/context-graph-modal';
import { TFile, type MockElement } from '../mocks/obsidian';
import type { App } from 'obsidian';
import type ObsidianBrainPlugin from '../../src/main';
import type { GraphData } from '../../src/search/graph';

describe('ContextGraphModal', () => {
	let modal: ContextGraphModal;
	let mockPlugin: ObsidianBrainPlugin;
	let mockOpenLinkText: ReturnType<typeof vi.fn>;
	let mockGetGraphData: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.useFakeTimers();
		mockOpenLinkText = vi.fn().mockResolvedValue(undefined);

		const sampleGraph: GraphData = {
			seed: { type: 'note', path: 'Active.md' },
			nodes: [
				{ id: 'Active.md', label: 'Active', filePath: 'Active.md', isSeed: true, hop: 0, radius: 10 },
				{ id: 'Related.md', label: 'Related', filePath: 'Related.md', isSeed: false, hop: 1, radius: 7 },
			],
			edges: [{ id: 'Active---Related', source: 'Active.md', target: 'Related.md', similarity: 0.88 }],
		};

		mockGetGraphData = vi.fn().mockResolvedValue(sampleGraph);

		const activeFile = Object.assign(new TFile(), { path: 'Active.md' });

		const mockApp = {
			workspace: {
				getActiveFile: vi.fn().mockReturnValue(activeFile),
				openLinkText: mockOpenLinkText,
			},
		};

		mockPlugin = {
			app: mockApp,
			settings: {
				openInNewTab: true,
				graphHop1Count: 10,
				graphHop2Count: 5,
				graphSimilarityThreshold: 0.75,
			},
			brain: {
				isReady: true,
				getGraphData: mockGetGraphData,
			},
		} as unknown as ObsidianBrainPlugin;

		modal = new ContextGraphModal(mockApp as unknown as App, mockPlugin);
	});

	afterEach(() => {
		modal.close();
		vi.useRealTimers();
	});

	it('creates UI elements when opened', async () => {
		modal.open();
		await vi.runAllTimersAsync();

		const searchInput = modal.contentEl.querySelector('.brain-context-graph-search-input');
		expect(searchInput).toBeDefined();

		const centerTitle = modal.contentEl.querySelector('.brain-context-graph-center-title');
		expect(centerTitle).toBeDefined();
		expect(centerTitle?.textContent).toBe('Active');

		const openBtn = modal.contentEl.querySelector('.brain-context-graph-open-btn');
		expect(openBtn).toBeDefined();
	});

	it('relies on Obsidian system close button and does not create duplicate custom close button', async () => {
		modal.open();
		await vi.runAllTimersAsync();

		const customClose = modal.contentEl.querySelector('.brain-context-graph-close-btn');
		expect(customClose).toBeNull();
	});

	it('seeds graph from query when search input changes', async () => {
		modal.open();
		await vi.runAllTimersAsync();

		const searchInput = modal.contentEl.querySelector(
			'.brain-context-graph-search-input',
		) as unknown as MockElement & { value?: string };
		searchInput.value = 'artificial intelligence';
		// Trigger input event
		const inputListeners = searchInput.eventListeners['input'] ?? [];
		for (const fn of inputListeners) {
			fn({ target: searchInput });
		}

		// Fast-forward debounce timer
		await vi.advanceTimersByTimeAsync(400);

		expect(vi.mocked(mockGetGraphData)).toHaveBeenCalledWith(
			expect.objectContaining({ type: 'query', query: 'artificial intelligence' }),
		);
	});

	it('opens note when open button is clicked', async () => {
		modal.open();
		await vi.runAllTimersAsync();

		const openBtn = modal.contentEl.querySelector(
			'.brain-context-graph-open-btn',
		) as unknown as MockElement | null;
		openBtn?.click();

		expect(vi.mocked(mockOpenLinkText)).toHaveBeenCalledWith('Active.md', '', 'tab');
	});
});
