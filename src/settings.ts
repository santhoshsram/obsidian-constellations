import { App, ButtonComponent, PluginSettingTab, Setting } from 'obsidian';
import type ObsidianBrainPlugin from './main';
import { EMBEDDING_MODELS, DEFAULT_MODEL } from './embed/models';

export interface ObsidianBrainSettings {
	/** Hugging Face model ID used for embeddings. */
	embeddingModel: string;
	/** Max related notes shown for the active note. */
	maxRelatedNotes: number;
	/** Max matching chunks shown per related note. */
	maxChunksPerNote: number;
	/** Minimum cosine similarity (0–1) for a chunk to count as related. */
	minScore: number;
	/** Emit debug/info index logs to the console (timing, device, …). */
	debugLogging: boolean;
	/** Timestamp (ms) of the last successful indexing run. */
	lastIndexedAt: number | null;
}

export const DEFAULT_SETTINGS: ObsidianBrainSettings = {
	embeddingModel: DEFAULT_MODEL.modelId,
	maxRelatedNotes: 10,
	maxChunksPerNote: 3,
	minScore: 0.45,
	debugLogging: false,
	lastIndexedAt: null,
};

/** Format a millisecond timestamp into human-readable local time or 'Never'. */
export function formatLastIndexed(
	timestamp: number | null | undefined,
): string {
	if (!timestamp) return 'Never';
	const date = new Date(timestamp);
	const isToday = new Date().toDateString() === date.toDateString();
	const timeStr = date.toLocaleTimeString([], {
		hour: 'numeric',
		minute: '2-digit',
		second: '2-digit',
	});
	return isToday
		? `Today at ${timeStr}`
		: date.toLocaleString([], {
				month: 'short',
				day: 'numeric',
				hour: 'numeric',
				minute: '2-digit',
				second: '2-digit',
		  });
}

export class ObsidianBrainSettingTab extends PluginSettingTab {
	plugin: ObsidianBrainPlugin;
	private unsubscribeProgress?: () => void;

	constructor(app: App, plugin: ObsidianBrainPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	hide(): void {
		this.unsubscribeProgress?.();
		this.unsubscribeProgress = undefined;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		let indexButton: ButtonComponent | null = null;

		new Setting(containerEl)
			.setName('Vault indexing')
			.setDesc(
				'Load the embedding model and index the vault. Runs automatically on startup and file changes.',
			)
			.addButton((button) => {
				indexButton = button;
				button.setButtonText(
					this.plugin.brain?.progress.isIndexing
						? 'Indexing…'
						: this.plugin.brain?.isReady
						? 'Reindex vault'
						: 'Start indexing',
				);
				button.setDisabled(this.plugin.brain?.progress.isIndexing ?? false);
				button.onClick(async () => {
					await this.plugin.startBrain();
				});
			});

		// Progress UI: X/Y... [Progress bar] on line 1, Current file on line 2
		const progressContainer = containerEl.createDiv({
			cls: 'brain-indexing-progress',
		});

		const progressRow = progressContainer.createDiv({
			cls: 'brain-progress-row',
		});

		const progressCount = progressRow.createSpan({
			cls: 'brain-progress-count',
		});

		const progressBar = progressRow.createEl('progress', {
			cls: 'brain-progress-bar',
		});

		const currentFileEl = progressContainer.createDiv({
			cls: 'brain-progress-file',
		});

		const lastIndexedEl = progressContainer.createDiv({
			cls: 'brain-progress-last-indexed',
		});
		lastIndexedEl.setText(
			`Last indexed: ${formatLastIndexed(
				this.plugin.settings.lastIndexedAt,
			)}`,
		);

		// Subscribe to real-time progress updates while setting tab is open
		this.unsubscribeProgress?.();
		this.unsubscribeProgress = this.plugin.brain?.onProgress((p) => {
			if (indexButton) {
				indexButton.setDisabled(p.isIndexing);
				indexButton.setButtonText(
					p.isIndexing
						? 'Indexing…'
						: this.plugin.brain.isReady
						? 'Reindex vault'
						: 'Start indexing',
				);
			}
			if (p.total > 0) {
				progressCount.setText(
					`${p.done}/${p.total}${p.isIndexing ? '…' : ''}`,
				);
				progressBar.value = p.done;
				progressBar.max = p.total;
			} else {
				progressCount.setText(p.isIndexing ? 'Starting…' : 'Idle');
				progressBar.value = 0;
				progressBar.max = 1;
			}
			currentFileEl.setText(
				p.currentFile ||
					(p.isIndexing ? 'Indexing...' : 'Index ready'),
			);
			lastIndexedEl.setText(
				`Last indexed: ${formatLastIndexed(
					p.lastIndexedAt ?? this.plugin.settings.lastIndexedAt,
				)}`,
			);
		});

		new Setting(containerEl)
			.setName('Debug logging')
			.setDesc(
				'Log indexing timing, device, and per-file progress to the ' +
					'console (Cmd-Option-I). Leave on while troubleshooting ' +
					'performance.',
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.debugLogging)
					.onChange(async (value) => {
						this.plugin.settings.debugLogging = value;
						await this.plugin.saveSettings();
						this.plugin.refreshLogger();
					}),
			);

		new Setting(containerEl)
			.setName('Embedding model')
			.setDesc(
				'Local model used for semantic search. Changing models triggers a re-index.',
			)
			.addDropdown((dropdown) => {
				for (const [id, spec] of Object.entries(EMBEDDING_MODELS)) {
					const label = spec.displayName
						? spec.hint
							? `${spec.displayName} (${spec.hint})`
							: spec.displayName
						: id;
					dropdown.addOption(id, label);
				}
				const selected =
					EMBEDDING_MODELS[this.plugin.settings.embeddingModel]
						? this.plugin.settings.embeddingModel
						: DEFAULT_MODEL.modelId;
				dropdown
					.setValue(selected)
					.onChange(async (value) => {
						this.plugin.settings.embeddingModel = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName('Related notes')
			.setDesc('Maximum number of related notes to show.')
			.addSlider((slider) =>
				slider
					.setLimits(1, 25, 1)
					.setValue(this.plugin.settings.maxRelatedNotes)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxRelatedNotes = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Sections per note')
			.setDesc(
				'Maximum number of matching sections shown per related note.',
			)
			.addSlider((slider) =>
				slider
					.setLimits(1, 5, 1)
					.setValue(this.plugin.settings.maxChunksPerNote)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.maxChunksPerNote = value;
						await this.plugin.saveSettings();
					}),
			);

		new Setting(containerEl)
			.setName('Minimum similarity')
			.setDesc(
				'Minimum similarity score (0–1) for a section to count as ' +
					'related. Higher means fewer, closer matches.',
			)
			.addSlider((slider) =>
				slider
					.setLimits(0, 1, 0.05)
					.setValue(this.plugin.settings.minScore)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.minScore = value;
						await this.plugin.saveSettings();
					}),
			);
	}
}
