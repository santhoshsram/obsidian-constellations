/**
 * Context Graph full-screen modal view.
 *
 * Immersive semantic graph overlay with real-time concept search,
 * click-to-recenter semantic exploration, and double-click / button note opening.
 */

import { Modal, type App, setIcon } from 'obsidian';
import type ObsidianBrainPlugin from '../../main';
import { ContextGraphEngine } from './context-graph-engine';
import type { GraphData, GraphNode, GraphSeed } from '../../search/graph';
import { debounce, type DebouncedFn } from '../../utils/debounce';

export class ContextGraphModal extends Modal {
	private engine: ContextGraphEngine | null = null;
	private currentSeed: GraphSeed | null = null;
	private currentCenterPath: string | null = null;
	private currentCenterLabel = '';

	private searchInput!: HTMLInputElement;
	private centerTitleEl!: HTMLElement;
	private openButtonEl!: HTMLElement;
	private emptyStateEl!: HTMLElement;

	private debouncedSearch: DebouncedFn<[string]>;

	constructor(
		app: App,
		private plugin: ObsidianBrainPlugin,
	) {
		super(app);
		this.debouncedSearch = debounce((query: string) => {
			void this.applySearchQuery(query);
		}, 300);
	}

	onOpen(): void {
		this.modalEl.addClass('brain-context-graph-modal');

		const { contentEl } = this;
		contentEl.empty();

		// 1. Top floating overlay header
		const headerEl = contentEl.createDiv({
			cls: 'brain-context-graph-header',
		});

		// Left: Search input
		const searchWrapper = headerEl.createDiv({
			cls: 'brain-context-graph-search-container',
		});
		const searchIconEl = searchWrapper.createSpan({
			cls: 'brain-context-graph-search-icon',
		});
		setIcon(searchIconEl, 'search');

		this.searchInput = searchWrapper.createEl('input', {
			cls: 'brain-context-graph-search-input',
			attr: {
				type: 'text',
				placeholder: 'Search notes or concepts…',
			},
		});

		this.searchInput.addEventListener('input', (e: Event) => {
			const target = e.target as HTMLInputElement;
			const val = target?.value?.trim() ?? '';
			this.debouncedSearch(val);
		});

		// Right: Active node badge + Open note button
		const centerWrapper = headerEl.createDiv({
			cls: 'brain-context-graph-center-container',
		});
		this.centerTitleEl = centerWrapper.createSpan({
			cls: 'brain-context-graph-center-title',
			text: 'Context Graph',
		});
		this.openButtonEl = centerWrapper.createEl('button', {
			cls: 'brain-context-graph-open-btn',
			text: 'Open note ↗',
		});
		this.openButtonEl.addEventListener('click', () => {
			if (this.currentCenterPath) {
				void this.openNote(this.currentCenterPath);
			}
		});

		// 2. Canvas Container
		const canvasContainer = contentEl.createDiv({
			cls: 'brain-context-graph-canvas-container',
		});

		this.emptyStateEl = contentEl.createDiv({
			cls: 'brain-context-graph-empty is-hidden',
		});

		// 3. Mount engine
		this.engine = new ContextGraphEngine(canvasContainer, {
			onNodeClick: (node) => {
				this.handleNodeClick(node);
			},
			onNodeDoubleClick: (node) => {
				this.handleNodeDoubleClick(node);
			},
		});

		// 4. Initial seed
		const activeFile = this.app.workspace.getActiveFile();
		if (activeFile) {
			void this.reseed({ type: 'note', path: activeFile.path });
		} else {
			this.setCenterBadge('', null);
			this.showEmptyState('Open a note or search a concept to start exploring');
		}
	}

	private handleNodeClick(node: GraphNode): void {
		if (node.filePath && !node.isSeed) {
			this.searchInput.value = '';
			this.engine?.optimisticFocus(node.id, node.label);
			this.setCenterBadge(node.label, node.filePath);
			void this.reseed({ type: 'note', path: node.filePath });
		}
	}

	private handleNodeDoubleClick(node: GraphNode): void {
		if (node.filePath) {
			void this.openNote(node.filePath);
		}
	}

	private async applySearchQuery(query: string): Promise<void> {
		if (!query) {
			const activeFile = this.app.workspace.getActiveFile();
			if (activeFile) {
				await this.reseed({ type: 'note', path: activeFile.path });
			} else {
				this.showEmptyState('Type a query to explore semantic connections');
			}
			return;
		}

		await this.reseed({ type: 'query', query });
	}

	private async reseed(seed: GraphSeed): Promise<void> {
		this.currentSeed = seed;
		const brain = this.plugin.brain;
		if (!brain.isReady) {
			this.showEmptyState('Brain index is loading…');
			return;
		}

		const data: GraphData = await brain.getGraphData(seed);
		if (data.nodes.length === 0) {
			if (seed.type === 'note') {
				this.showEmptyState('Note not found in index or has no content');
			} else {
				this.showEmptyState(`No notes related to "${seed.query}"`);
			}
			return;
		}

		this.hideEmptyState();

		if (seed.type === 'note') {
			const base = seed.path.split('/').pop()?.replace(/\.md$/, '') ?? seed.path;
			this.setCenterBadge(base, seed.path);
		} else {
			this.setCenterBadge(`"${seed.query}"`, null);
		}

		this.engine?.setData(data);
	}

	private setCenterBadge(label: string, filePath: string | null): void {
		this.currentCenterLabel = label;
		this.currentCenterPath = filePath;
		this.centerTitleEl.setText(label);
		if (filePath) {
			this.openButtonEl.removeClass('is-hidden');
		} else {
			this.openButtonEl.addClass('is-hidden');
		}
	}

	private showEmptyState(msg: string): void {
		this.emptyStateEl.setText(msg);
		this.emptyStateEl.removeClass('is-hidden');
	}

	private hideEmptyState(): void {
		this.emptyStateEl.addClass('is-hidden');
	}

	private async openNote(filePath: string): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType('markdown');
		const existingLeaf = leaves.find((leaf) => {
			const view = leaf.view as { file?: { path: string } } | undefined;
			return view?.file?.path === filePath;
		});

		if (existingLeaf) {
			this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
		} else {
			const inNewTab = this.plugin.settings.openInNewTab;
			await this.app.workspace.openLinkText(
				filePath,
				'',
				inNewTab ? 'tab' : false,
			);
		}

		if (this.openButtonEl) {
			const origText = this.openButtonEl.textContent || 'Open note ↗';
			this.openButtonEl.setText('Opened ✓');
			window.setTimeout(() => {
				if (this.openButtonEl && this.openButtonEl.textContent === 'Opened ✓') {
					this.openButtonEl.setText(origText);
				}
			}, 1200);
		}
	}

	onClose(): void {
		this.debouncedSearch.cancel();
		this.engine?.destroy();
		this.engine = null;
		this.contentEl.empty();
	}
}
