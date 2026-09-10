import { Notice, Plugin } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	ObsidianBrainSettings,
	ObsidianBrainSettingTab,
} from './settings';
import { Brain } from './brain';

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
			id: 'reindex-vault',
			name: 'Reindex vault',
			callback: () => {
				void this.startBrain();
			},
		});

		this.addCommand({
			id: 'find-related-notes',
			name: 'Find notes related to the current note',
			callback: () => this.showRelatedNotes(),
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

	private showRelatedNotes() {
		if (!this.brain.isReady) {
			new Notice('Obsidian brain is still indexing — try again shortly.');
			return;
		}
		const file = this.app.workspace.getActiveFile();
		if (!file) {
			new Notice('No active note.');
			return;
		}
		const related = this.brain.relatedTo(file.path);
		if (related.length === 0) {
			new Notice('No related notes found.');
			return;
		}
		// Headless validation for Phase 1: top results in a Notice.
		// (The Phase 2 sidebar UI replaces this.)
		const lines = related
			.slice(0, 5)
			.map((n) => `${n.bestScore.toFixed(2)}  ${n.filePath}`)
			.join('\n');
		new Notice(`Obsidian brain — related notes:\n${lines}`, 15000);
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
