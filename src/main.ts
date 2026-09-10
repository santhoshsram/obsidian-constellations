import { MarkdownView, Notice, Plugin, TFile } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	ObsidianBrainSettings,
	ObsidianBrainSettingTab,
} from './settings';
import { Brain } from './brain';
import type { RetrievalStrategy } from './search/retrieval';

function getActiveHeadingAtCursor(
	plugin: ObsidianBrainPlugin,
	file: TFile,
	cursorLine: number,
): string | undefined {
	const cache = plugin.app.metadataCache.getFileCache(file);
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

export default class ObsidianBrainPlugin extends Plugin {
	settings!: ObsidianBrainSettings;
	brain!: Brain;
	private statusBarEl!: HTMLElement;

	async onload() {
		await this.loadSettings();

		this.brain = new Brain(this);
		this.statusBarEl = this.addStatusBarItem();
		this.setStatus('');

		this.addSettingTab(new ObsidianBrainSettingTab(this.app, this));

		this.addCommand({
			id: 'reindex-notes',
			name: 'Reindex notes',
			callback: () => {
				void this.startBrain();
			},
		});

		this.addCommand({
			id: 'find-related-notes',
			name: 'Find notes related to the current note',
			callback: () => this.showRelatedNotes(),
		});

		this.addCommand({
			id: 'find-related-notes-maxsim',
			name: 'Find related notes (detailed)',
			callback: () => this.showRelatedNotes('maxsim'),
		});

		this.addCommand({
			id: 'find-related-notes-cursor',
			name: 'Find related notes (focused)',
			callback: () => this.showRelatedNotes('cursor'),
		});

		this.addCommand({
			id: 'find-related-notes-mean',
			name: 'Find related notes (broad)',
			callback: () => this.showRelatedNotes('mean'),
		});

		// Defer model loading and indexing until the workspace is ready.
		this.app.workspace.onLayoutReady(() => {
			void this.startBrain();
		});
	}

	/** Start model load + sync or reindex if already running. */
	async startBrain(): Promise<void> {
		if (!this.brain.started) {
			await this.brain.init();
		} else if (!this.brain.progress.isIndexing) {
			await this.brain.reindex();
		}
	}

	onunload() {
		void this.brain?.shutdown();
	}

	setStatus(text: string) {
		this.statusBarEl?.setText(text);
	}

	/** Recreate the console logger when the debug-logging setting changes. */
	refreshLogger() {
		this.brain.refreshLogger();
	}

	private async showRelatedNotes(strategyOverride?: RetrievalStrategy): Promise<void> {
		if (!this.brain.isReady) {
			new Notice('Obsidian brain is still indexing — try again shortly.');
			return;
		}
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice('No active note.');
			return;
		}

		const strategy = strategyOverride ?? this.settings.retrievalStrategy;
		const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
		const cursorLine = activeView?.editor?.getCursor()?.line;
		const cursorHeading =
			typeof cursorLine === 'number'
				? getActiveHeadingAtCursor(this, file, cursorLine)
				: undefined;

		const related = await this.brain.relatedTo(file.path, {
			strategy,
			cursorLine,
			cursorHeading,
		});

		if (related.length === 0) {
			new Notice('No related notes found.');
			return;
		}

		const strategyLabels: Record<RetrievalStrategy, string> = {
			maxsim: 'Detailed',
			cursor: 'Focused',
			mean: 'Broad',
		};
		const label = strategyLabels[strategy] ?? strategy;

		// Headless validation for Phase 1: top results in a persistent Notice.
		// (The Phase 2 sidebar UI replaces this.)
		const lines = related
			.slice(0, 5)
			.map((n, i) => {
				const score = n.bestScore.toFixed(2);
				const sourceHeading = n.matchedSourceHeading
					? ` [matched: ${n.matchedSourceHeading}]`
					: '';
				const topChunk = n.chunks[0];
				const targetHeading =
					topChunk && topChunk.record.headingPath.length > 1
						? `\n   ↳ section: "${topChunk.record.headingPath[topChunk.record.headingPath.length - 1]}"`
						: '';
				return `${i + 1}. ${score}  ${n.filePath}${sourceHeading}${targetHeading}`;
			})
			.join('\n');
		new Notice(
			`Obsidian brain — related notes (${label}):\n${lines}\n\n(Click to dismiss)`,
			0,
		);
	}

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			(await this.loadData()) as Partial<ObsidianBrainSettings>,
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
