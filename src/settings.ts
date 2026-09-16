import { App, ButtonComponent, PluginSettingTab, Setting } from 'obsidian';
import type ConstellationsPlugin from './main';
import type { BrainProgress } from './brain';
import {
	EMBEDDING_MODELS,
	DEFAULT_MODEL,
	RERANKER_MODELS,
	DEFAULT_RERANKER,
} from './embed/models';
import type { RetrievalStrategy } from './search/retrieval';

export interface ConstellationsSettings {
	/** Hugging Face model ID used for embeddings. */
	embeddingModel: string;
	/** Hugging Face model ID used for reranking. */
	rerankerModel: string;
	/** Whether cross-encoder reranking is enabled. */
	rerankerEnabled: boolean;

	/** Whether to open related notes in a new tab or the current tab. */
	openInNewTab: boolean;
	/** Default retrieval strategy for related notes. */
	retrievalStrategy: RetrievalStrategy;
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

	/** Preferred companion view mode in sidebar (list or graph). */
	sidebarViewMode: 'list' | 'graph';
}

export const DEFAULT_SETTINGS: ConstellationsSettings = {
	embeddingModel: DEFAULT_MODEL.modelId,
	rerankerModel: DEFAULT_RERANKER.modelId,
	rerankerEnabled: true,

	openInNewTab: true,
	retrievalStrategy: 'maxsim',
	maxRelatedNotes: 10,
	maxChunksPerNote: 3,
	minScore: 0.45,
	debugLogging: false,
	lastIndexedAt: null,

	sidebarViewMode: 'list',
};

export interface ModelStatus {
	state: 'idle' | 'downloading' | 'loading' | 'ready' | 'error';
	progress?: number;
	device?: string;
	error?: string;
}

export function formatModelStatus(status?: ModelStatus): string {
	if (!status || status.state === 'idle') {
		return 'Not loaded';
	}
	if (status.state === 'downloading') {
		return `Downloading (${status.progress ?? 0}%)`;
	}
	if (status.state === 'loading') {
		return 'Loading…';
	}
	if (status.state === 'ready') {
		return status.device ? `Ready (${status.device.toUpperCase()})` : 'Ready';
	}
	if (status.state === 'error') {
		return 'Failed to load';
	}
	return 'Unknown';
}

/** Render formatted status into container with color classes (ready=green, downloading=normal). */
export function renderModelStatus(
	containerEl: HTMLElement,
	status?: ModelStatus,
): void {
	containerEl.empty();
	containerEl.createSpan({
		cls: 'constellations-model-status-label',
		text: 'Status: ',
	});
	const formatted = formatModelStatus(status);
	const isReady = status?.state === 'ready';
	const isDownloading = status?.state === 'downloading';
	const cls = [
		'constellations-model-status-value',
		isReady ? 'is-ready' : '',
		isDownloading ? 'is-downloading' : '',
	]
		.filter(Boolean)
		.join(' ');
	containerEl.createSpan({ cls, text: formatted });
}

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

export class ConstellationsSettingTab extends PluginSettingTab {
	plugin: ConstellationsPlugin;
	private unsubscribeProgress?: () => void;

	constructor(app: App, plugin: ConstellationsPlugin) {
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

		const vaultCard = this.renderVaultIndexingCard(containerEl);
		this.renderDebugLoggingSetting(containerEl);
		const embeddingCard = this.renderEmbeddingModelCard(containerEl);
		const rerankerCard = this.renderRerankerModelCard(containerEl);
		this.renderRetrievalSettings(containerEl);
		this.renderDisplaySettings(containerEl);

		this.unsubscribeProgress?.();
		this.unsubscribeProgress = this.plugin.brain?.onProgress(
			this.updateUI(vaultCard, embeddingCard, rerankerCard),
		);
	}

	private renderVaultIndexingCard(containerEl: HTMLElement): VaultIndexingCard {
		let indexButton: ButtonComponent;
		const vaultSetting = new Setting(containerEl)
			.setClass('constellations-vault-setting')
			.setName('Vault indexing')
			.setDesc(
				'Load the embedding model and index the vault. Runs automatically on startup and file changes.',
			)
			.addButton((button) => {
				indexButton = button;
				button.onClick(() => {
					void this.plugin.startBrain();
				});
			});

		const progressContainer = vaultSetting.descEl.createDiv({
			cls: 'constellations-indexing-progress',
		});

		const progressRow = progressContainer.createDiv({ cls: 'constellations-progress-row' });
		const progressCount = progressRow.createSpan({ cls: 'constellations-progress-count' });
		const progressBar = progressRow.createEl('progress', { cls: 'constellations-progress-bar' });
		const statsEl = progressContainer.createDiv({ cls: 'constellations-progress-file' });
		const lastIndexedEl = progressContainer.createDiv({ cls: 'constellations-progress-last-indexed' });

		return { indexButton: indexButton!, progressRow, progressCount, progressBar, statsEl, lastIndexedEl };
	}

	private renderDebugLoggingSetting(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('Debug logging')
			.setDesc(
				'Log indexing timing, device, and per-file progress to the ' +
					'developer console (Cmd+Option+I on Mac, Ctrl+Shift+I on ' +
					'Windows/Linux). Leave on while troubleshooting performance.',
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
	}

	private renderEmbeddingModelCard(containerEl: HTMLElement): ModelCard {
		let embeddingDropdown: HTMLSelectElement;
		const embeddingSetting = new Setting(containerEl)
			.setClass('constellations-model-setting')
			.setName('Embedding model')
			.setDesc(
				'Local model used for semantic search. Changing models triggers a re-index. ' +
					'Models are downloaded once from Hugging Face on first use and cached locally.',
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
				dropdown.setValue(selected);
				embeddingDropdown = dropdown.selectEl;
				dropdown.onChange(async (value) => {
					this.plugin.settings.embeddingModel = value;
					await this.plugin.saveSettings();
					this.plugin.brain?.resetForModelChange();
					void this.plugin.startBrain();
				});
			});

		return { dropdown: embeddingDropdown!, ...this.renderModelStatusRow(embeddingSetting) };
	}

	private renderRerankerModelCard(containerEl: HTMLElement): ModelCard {
		let rerankerDropdown: HTMLSelectElement;
		const rerankerSetting = new Setting(containerEl)
			.setClass('constellations-model-setting')
			.setName('Reranking model')
			.addDropdown((dropdown) => {
				for (const [id, spec] of Object.entries(RERANKER_MODELS)) {
					const label = spec.displayName || id;
					dropdown.addOption(id, label);
				}
				const selected =
					RERANKER_MODELS[this.plugin.settings.rerankerModel]
						? this.plugin.settings.rerankerModel
						: DEFAULT_RERANKER.modelId;
				dropdown.setValue(selected).setDisabled(true);
				rerankerDropdown = dropdown.selectEl;
			});

		return { dropdown: rerankerDropdown!, ...this.renderModelStatusRow(rerankerSetting) };
	}

	/** Shared status/progress row under a model dropdown's description. */
	private renderModelStatusRow(setting: Setting): Omit<ModelCard, 'dropdown'> {
		const statusContainer = setting.descEl.createDiv({
			cls: 'constellations-model-status-container',
		});
		const statusEl = statusContainer.createDiv({ cls: 'constellations-model-status' });
		const progressRow = statusContainer.createDiv({ cls: 'constellations-model-progress-row' });
		const progressBar = progressRow.createEl('progress', { cls: 'constellations-model-progress-bar' });
		progressBar.max = 100;
		const progressPct = progressRow.createSpan({ cls: 'constellations-model-progress-pct' });

		return { statusEl, progressRow, progressBar, progressPct };
	}

	private renderRetrievalSettings(containerEl: HTMLElement): void {
		const strategyDesc = createFragment((el) => {
			el.createDiv({
				text: 'Choose how Constellations finds related notes:',
			});
			const list = el.createEl('ul');
			const li1 = list.createEl('li');
			li1.createEl('strong', { text: 'Detailed: ' });
			li1.appendText(
				'Retrieves best matches for each section in the note and then picks the top matches across these.',
			);
			const li2 = list.createEl('li');
			li2.createEl('strong', { text: 'Focused: ' });
			li2.appendText(
				'Retrieves the best matches for the section or paragraph under your cursor.',
			);
			const li3 = list.createEl('li');
			li3.createEl('strong', { text: 'Broad: ' });
			li3.appendText(
				'Retrieves the best matches using an overall summary of the full note.',
			);
		});

		new Setting(containerEl)
			.setClass('constellations-matching-setting')
			.setName('Matching mode')
			.setDesc(strategyDesc)
			.addDropdown((dropdown) => {
				dropdown
					.addOption('maxsim', 'Detailed (recommended)')
					.addOption('cursor', 'Focused')
					.addOption('mean', 'Broad')
					.setValue(this.plugin.settings.retrievalStrategy ?? 'maxsim')
					.onChange(async (value) => {
						this.plugin.settings.retrievalStrategy = value as RetrievalStrategy;
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

	private renderDisplaySettings(containerEl: HTMLElement): void {
		new Setting(containerEl)
			.setName('Open related notes in new tab')
			.setDesc('Open related notes in a new tab instead of the current tab.')
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.openInNewTab)
					.onChange(async (value) => {
						this.plugin.settings.openInNewTab = value;
						await this.plugin.saveSettings();
					}),
			);
	}

	private updateUI(
		vault: VaultIndexingCard,
		embedding: ModelCard,
		reranker: ModelCard,
	): (p: BrainProgress) => void {
		return (p: BrainProgress) => {
			const isModelBusy = !this.plugin.brain?.isReady && (this.plugin.brain?.started ?? false);
			const isIndexing = p.isIndexing;

			vault.indexButton.setDisabled(isIndexing || isModelBusy);
			vault.indexButton.setButtonText(isIndexing ? 'Indexing…' : 'Reindex vault');
			vault.progressRow.toggleClass('is-invisible', !isIndexing);
			vault.statsEl.setText(p.currentFile || (isIndexing ? 'Scanning vault…' : 'Not indexed yet'));

			const lastIndexed = p.lastIndexedAt ?? this.plugin.settings.lastIndexedAt;
			vault.lastIndexedEl.toggleClass('is-invisible', !lastIndexed);

			if (isIndexing) {
				if (p.total > 0) {
					vault.progressCount.setText(`${p.done}/${p.total} files…`);
					vault.progressBar.value = p.done;
					vault.progressBar.max = p.total;
				} else {
					vault.progressCount.setText('Starting…');
					vault.progressBar.value = 0;
					vault.progressBar.max = 1;
				}
			} else if (lastIndexed) {
				vault.lastIndexedEl.setText(`Last indexed: ${formatLastIndexed(lastIndexed)}`);
			}

			embedding.dropdown.disabled = isIndexing;
			this.updateModelCard(embedding, p.embeddingStatus ?? this.plugin.brain?.embeddingStatus);
			this.updateModelCard(reranker, p.rerankerStatus ?? this.plugin.brain?.rerankerStatus);
		};
	}

	private updateModelCard(card: ModelCard, status: ModelStatus | undefined): void {
		renderModelStatus(card.statusEl, status);
		const isDownloading = status?.state === 'downloading';
		card.progressRow.toggleClass('is-invisible', !isDownloading);
		if (isDownloading) {
			const pct = status?.progress ?? 0;
			card.progressBar.value = pct;
			card.progressPct.setText(`${pct}%`);
		}
	}
}

interface VaultIndexingCard {
	indexButton: ButtonComponent;
	progressRow: HTMLElement;
	progressCount: HTMLElement;
	progressBar: HTMLProgressElement;
	statsEl: HTMLElement;
	lastIndexedEl: HTMLElement;
}

interface ModelCard {
	dropdown: HTMLSelectElement;
	statusEl: HTMLElement;
	progressRow: HTMLElement;
	progressBar: HTMLProgressElement;
	progressPct: HTMLElement;
}
