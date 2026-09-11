import {
	ItemView,
	MarkdownView,
	setIcon,
	TFile,
	type WorkspaceLeaf,
} from 'obsidian';
import type ObsidianBrainPlugin from '../main';
import type { BrainProgress } from '../brain';
import type { RelatedNote } from '../search/related';
import { getSectionDisplay } from './snippet';
import { debounce, type DebouncedFn } from '../utils/debounce';
import { ContextGraphEngine } from './graph/context-graph-engine';
import type { GraphData } from '../search/graph';

export const VIEW_TYPE_RELATED = 'brain-related-notes';

export class RelatedNotesView extends ItemView {
	private plugin: ObsidianBrainPlugin;
	private unsubscribeProgress?: () => void;
	private debouncedRefresh: DebouncedFn<[]>;
	private wasIndexing = false;
	private mode: 'list' | 'graph' = 'list';
	private graphEngine: ContextGraphEngine | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: ObsidianBrainPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.mode = this.plugin.settings.sidebarViewMode ?? 'list';
		this.debouncedRefresh = debounce(() => {
			void this.refresh();
		}, 300);
	}

	getViewType(): string {
		return VIEW_TYPE_RELATED;
	}

	getDisplayText(): string {
		return 'Related notes';
	}

	getIcon(): string {
		return 'brain-circuit';
	}

	onload(): void {
		super.onload();
		this.contentEl.addClass('brain-related-view-content');
		this.unsubscribeProgress = this.plugin.brain.onProgress(
			(progress: BrainProgress) => {
				const isNowIndexing = progress.isIndexing;
				if (this.wasIndexing && !isNowIndexing) {
					void this.refresh();
				} else if (isNowIndexing) {
					this.renderEmptyState(
						`Indexing (${progress.done}/${progress.total})…`,
					);
				}
				this.wasIndexing = isNowIndexing;
			},
		);

		this.registerEvent(
			this.app.workspace.on('active-leaf-change', () => {
				this.debouncedRefresh();
			}),
		);

		void this.refresh();
	}

	onunload(): void {
		this.debouncedRefresh.cancel();
		this.cleanupGraph();
		if (this.unsubscribeProgress) {
			this.unsubscribeProgress();
			this.unsubscribeProgress = undefined;
		}
	}

	private renderHeader(): HTMLElement {
		const headerEl = this.contentEl.createDiv({
			cls: 'brain-view-header',
		});
		const toggleGroup = headerEl.createDiv({
			cls: 'brain-view-toggle-group',
		});
		const listBtn = toggleGroup.createEl('button', {
			cls: `brain-view-toggle ${this.mode === 'list' ? 'is-active' : ''}`,
			text: 'List',
		});
		const graphBtn = toggleGroup.createEl('button', {
			cls: `brain-view-toggle ${this.mode === 'graph' ? 'is-active' : ''}`,
			text: 'Graph',
		});

		listBtn.addEventListener('click', () => {
			if (this.mode !== 'list') {
				void this.setMode('list');
			}
		});

		graphBtn.addEventListener('click', () => {
			if (this.mode !== 'graph') {
				void this.setMode('graph');
			}
		});

		return headerEl;
	}

	async setMode(mode: 'list' | 'graph'): Promise<void> {
		this.mode = mode;
		this.plugin.settings.sidebarViewMode = mode;
		await this.plugin.saveSettings();
		await this.refresh();
	}

	private cleanupGraph(): void {
		if (this.graphEngine) {
			this.graphEngine.destroy();
			this.graphEngine = null;
		}
	}

	renderEmptyState(message: string): void {
		this.cleanupGraph();
		this.contentEl.empty();
		this.renderHeader();
		const container = this.contentEl.createDiv({
			cls: 'brain-empty-state-container',
		});
		container.createDiv({
			cls: 'brain-empty-state',
			text: message,
		});
	}

	async refresh(): Promise<void> {
		this.mode = this.plugin.settings.sidebarViewMode ?? 'list';
		const brain = this.plugin.brain;
		if (!brain.isReady) {
			const embStatus = brain.embeddingStatus;
			const rerankStatus = brain.rerankerStatus;

			if (embStatus?.state === 'downloading') {
				this.renderEmptyState(
					`Downloading model (${embStatus.progress ?? 0}%)`,
				);
				return;
			}
			if (rerankStatus?.state === 'downloading') {
				this.renderEmptyState(
					`Downloading model (${rerankStatus.progress ?? 0}%)`,
				);
				return;
			}
			if (
				embStatus?.state === 'loading' ||
				rerankStatus?.state === 'loading'
			) {
				this.renderEmptyState('Loading model…');
				return;
			}
			if (brain.progress?.isIndexing) {
				this.renderEmptyState(
					`Indexing (${brain.progress.done}/${brain.progress.total})…`,
				);
				return;
			}
			if (!brain.started) {
				this.renderEmptyState('Loading model…');
				return;
			}
		}

		if (brain.progress?.isIndexing) {
			this.renderEmptyState(
				`Indexing (${brain.progress.done}/${brain.progress.total})…`,
			);
			return;
		}

		const file = this.app.workspace.getActiveFile();
		if (!file) {
			this.renderEmptyState('Open a note to see related notes');
			return;
		}

		if (this.mode === 'graph') {
			const graphData = await brain.getGraphData({
				type: 'note',
				path: file.path,
			});
			if (graphData.nodes.length === 0) {
				this.renderEmptyState('No related notes found');
				return;
			}
			this.renderGraph(graphData);
			return;
		}

		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cursorLine = activeView?.editor?.getCursor?.()?.line;
		const cursorHeading =
			typeof cursorLine === 'number'
				? this.getActiveHeadingAtCursor(file, cursorLine)
				: undefined;

		const strategy = this.plugin.settings.retrievalStrategy ?? 'maxsim';
		const related = await brain.relatedTo(file.path, {
			strategy,
			cursorLine,
			cursorHeading,
		});

		if (related.length === 0) {
			this.renderEmptyState('No related notes found');
			return;
		}

		this.renderResults(related);
	}

	private renderGraph(data: GraphData): void {
		this.cleanupGraph();
		this.contentEl.empty();
		this.renderHeader();
		const graphContainer = this.contentEl.createDiv({
			cls: 'brain-context-graph-sidebar-container',
		});

		this.graphEngine = new ContextGraphEngine(graphContainer, {
			onNodeClick: (node) => {
				if (node.filePath) {
					void this.plugin.brain
						.getGraphData({ type: 'note', path: node.filePath })
						.then((d) => this.graphEngine?.setData(d));
				}
			},
			onNodeDoubleClick: (node) => {
				if (node.filePath) {
					void this.navigateTo(node.filePath);
				}
			},
		});
		this.graphEngine.setData(data);
	}

	private renderResults(related: RelatedNote[]): void {
		this.cleanupGraph();
		this.contentEl.empty();
		this.renderHeader();
		const listEl = this.contentEl.createDiv({
			cls: 'brain-related-notes',
		});

		const maxNotes = this.plugin.settings.maxRelatedNotes ?? 10;
		const maxChunks = this.plugin.settings.maxChunksPerNote ?? 3;

		for (const note of related.slice(0, maxNotes)) {
			const cardEl = listEl.createDiv({
				cls: 'brain-related-note-card',
			});

			const headerEl = cardEl.createDiv({
				cls: 'brain-related-note-header',
			});
			const iconEl = headerEl.createSpan({
				cls: 'brain-related-note-icon',
			});
			setIcon(iconEl, 'file-text');

			const noteTitle = this.getNoteTitle(note.filePath);
			headerEl.createSpan({
				cls: 'brain-related-note-title',
				text: noteTitle,
			});

			const firstChunkLine = note.chunks?.[0]?.record?.startLine;
			headerEl.addEventListener('click', () => {
				void this.navigateTo(note.filePath, firstChunkLine);
			});

			const sectionsEl = cardEl.createDiv({
				cls: 'brain-related-note-sections',
			});

			const chunks = (note.chunks ?? []).slice(0, maxChunks);
			for (const chunk of chunks) {
				const sectionItemEl = sectionsEl.createDiv({
					cls: 'brain-related-section-item',
				});

				const chevEl = sectionItemEl.createSpan({
					cls: 'brain-related-section-icon',
				});
				setIcon(chevEl, 'chevron-right');

				const { label } = getSectionDisplay(chunk.record);
				sectionItemEl.createSpan({
					cls: 'brain-related-section-text',
					text: label,
				});

				const chunkLine = chunk.record?.startLine;
				sectionItemEl.addEventListener('click', () => {
					void this.navigateTo(note.filePath, chunkLine);
				});
			}
		}
	}

	private getNoteTitle(filePath: string): string {
		const basename = filePath.split('/').pop() ?? filePath;
		return basename.replace(/\.md$/, '');
	}

	private async navigateTo(
		filePath: string,
		line?: number,
	): Promise<void> {
		const inNewTab = this.plugin.settings.openInNewTab;
		await this.app.workspace.openLinkText(
			filePath,
			'',
			inNewTab ? 'tab' : false,
		);

		if (typeof line === 'number') {
			const activeView =
				this.app.workspace.getActiveViewOfType(MarkdownView);
			if (activeView?.editor) {
				activeView.editor.setCursor({ line, ch: 0 });
				if (typeof activeView.editor.scrollIntoView === 'function') {
					activeView.editor.scrollIntoView(
						{ from: { line, ch: 0 }, to: { line, ch: 0 } },
						true,
					);
				}
			}
		}
	}

	private getActiveHeadingAtCursor(
		file: TFile,
		cursorLine: number,
	): string | undefined {
		const cache = this.app.metadataCache.getFileCache(file);
		if (!cache?.headings || cache.headings.length === 0) {
			return undefined;
		}
		let activeHeading: string | undefined;
		for (const h of cache.headings) {
			if (h.position.start.line <= cursorLine) {
				activeHeading = h.heading;
			} else {
				break;
			}
		}
		return activeHeading;
	}
}
