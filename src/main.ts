import { Plugin, type WorkspaceLeaf } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	ObsidianBrainSettings,
	ObsidianBrainSettingTab,
} from './settings';
import { Brain } from './brain';
import { setPluginName } from './plugin-name';
import {
	RelatedNotesView,
	VIEW_TYPE_RELATED,
} from './ui/related-notes-view';

export default class ObsidianBrainPlugin extends Plugin {
	settings!: ObsidianBrainSettings;
	brain!: Brain;
	private statusBarEl!: HTMLElement;

	async onload() {
		setPluginName(this.manifest.name);
		await this.loadSettings();

		this.brain = new Brain(this);
		this.statusBarEl = this.addStatusBarItem();
		this.setStatus('');

		this.addSettingTab(new ObsidianBrainSettingTab(this.app, this));

		this.registerView(
			VIEW_TYPE_RELATED,
			(leaf) => new RelatedNotesView(leaf, this),
		);

		this.addCommand({
			id: 'reindex-notes',
			name: 'Reindex notes',
			callback: () => {
				void this.startBrain();
			},
		});

		this.addCommand({
			id: 'show-related-notes',
			name: 'Show related notes',
			callback: () => this.showRelatedNotesView(),
		});

		// Defer model loading, indexing, and sidebar view initialization until workspace is ready.
		this.app.workspace.onLayoutReady(() => {
			void this.startBrain();
			void this.initSidebarLeaf();
		});
	}

	/** Ensure a sidebar leaf exists for the related notes view. */
	async ensureSidebarLeaf(): Promise<WorkspaceLeaf | null> {
		const existing =
			this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATED)[0];
		if (existing) {
			return existing;
		}
		const rightLeaf = this.app.workspace.getRightLeaf(false);
		if (rightLeaf) {
			await rightLeaf.setViewState({
				type: VIEW_TYPE_RELATED,
				active: true,
			});
			return rightLeaf;
		}
		return null;
	}

	/** Reveal or create the related notes view leaf. */
	async showRelatedNotesView(): Promise<void> {
		const leaf = await this.ensureSidebarLeaf();
		if (leaf) {
			await this.app.workspace.revealLeaf(leaf);
		}
	}

	/** Initialize the sidebar leaf in the background if not already present. */
	private async initSidebarLeaf(): Promise<void> {
		const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_RELATED);
		if (leaves.length === 0) {
			const rightLeaf = this.app.workspace.getRightLeaf(false);
			if (rightLeaf) {
				await rightLeaf.setViewState({
					type: VIEW_TYPE_RELATED,
					active: false,
				});
			}
		}
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
