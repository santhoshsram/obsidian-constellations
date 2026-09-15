import { App, ButtonComponent, PluginSettingTab, Setting } from 'obsidian';
import type ObsidianBrainPlugin from './main';
import type { BrainProgress } from './brain';
import {
	EMBEDDING_MODELS,
	DEFAULT_MODEL,
	RERANKER_MODELS,
	DEFAULT_RERANKER,
} from './embed/models';
import type { RetrievalStrategy } from './search/retrieval';

export interface ObsidianBrainSettings {
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

export const DEFAULT_SETTINGS: ObsidianBrainSettings = {
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
		cls: 'brain-model-status-label',
		text: 'Status: ',
	});
	const formatted = formatModelStatus(status);
	const isReady = status?.state === 'ready';
	const isDownloading = status?.state === 'downloading';
	const cls = [
		'brain-model-status-value',
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

		// -- Elements --
		let indexButton: ButtonComponent;
		let progressRow: HTMLElement;
		let progressCount: HTMLElement;
		let progressBar: HTMLProgressElement;
		let statsEl: HTMLElement;
		let lastIndexedEl: HTMLElement;

		let embeddingDropdown: HTMLSelectElement;
		let embeddingStatusEl: HTMLElement;
		let embeddingProgressRow: HTMLElement;
		let embeddingProgressBar: HTMLProgressElement;
		let embeddingProgressPct: HTMLElement;

		let rerankerStatusEl: HTMLElement;
		let rerankerProgressRow: HTMLElement;
		let rerankerProgressBar: HTMLProgressElement;
		let rerankerProgressPct: HTMLElement;

		// -- DOM Construction --
		const vaultSetting = new Setting(containerEl)
			.setClass('brain-vault-setting')
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
			cls: 'brain-indexing-progress',
		});

		progressRow = progressContainer.createDiv({ cls: 'brain-progress-row' });
		progressCount = progressRow.createSpan({ cls: 'brain-progress-count' });
		progressBar = progressRow.createEl('progress', { cls: 'brain-progress-bar' });
		statsEl = progressContainer.createDiv({ cls: 'brain-progress-file' });
		lastIndexedEl = progressContainer.createDiv({ cls: 'brain-progress-last-indexed' });

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

		const embeddingSetting = new Setting(containerEl)
			.setClass('brain-model-setting')
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
		const embeddingStatusContainer = embeddingSetting.descEl.createDiv({
			cls: 'brain-model-status-container',
		});
		embeddingStatusEl = embeddingStatusContainer.createDiv({
			cls: 'brain-model-status',
		});
		embeddingProgressRow = embeddingStatusContainer.createDiv({
			cls: 'brain-model-progress-row',
		});
		embeddingProgressBar = embeddingProgressRow.createEl('progress', {
			cls: 'brain-model-progress-bar',
		});
		embeddingProgressBar.max = 100;
		embeddingProgressPct = embeddingProgressRow.createSpan({
			cls: 'brain-model-progress-pct',
		});

		const rerankerSetting = new Setting(containerEl)
			.setClass('brain-model-setting')
			.setName('Reranking model')
			.addDropdown((dropdown) => {
				for (const [id, spec] of Object.entries(RERANKER_MODELS)) {
					const label = spec.displayName || id;
					dropdown.addOption(id, label);
				}
				let selected =
					RERANKER_MODELS[this.plugin.settings.rerankerModel]
						? this.plugin.settings.rerankerModel
						: DEFAULT_RERANKER.modelId;
				if (selected === 'cross-encoder/ettin-reranker-150m-v1') {
					selected = DEFAULT_RERANKER.modelId;
				}
				dropdown.setValue(selected).setDisabled(true);
			});
		const rerankerStatusContainer = rerankerSetting.descEl.createDiv({
			cls: 'brain-model-status-container',
		});
		rerankerStatusEl = rerankerStatusContainer.createDiv({
			cls: 'brain-model-status',
		});
		rerankerProgressRow = rerankerStatusContainer.createDiv({
			cls: 'brain-model-progress-row',
		});
		rerankerProgressBar = rerankerProgressRow.createEl('progress', {
			cls: 'brain-model-progress-bar',
		});
		rerankerProgressBar.max = 100;
		rerankerProgressPct = rerankerProgressRow.createSpan({
			cls: 'brain-model-progress-pct',
		});

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
			.setClass('brain-matching-setting')
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

		// -- Reactive UI Update --
		const updateUI = (p: BrainProgress) => {
			const isModelBusy = !this.plugin.brain?.isReady && (this.plugin.brain?.started ?? false);
			const isIndexing = p.isIndexing;

			// 1. Vault Indexing Card
			indexButton.setDisabled(isIndexing || isModelBusy);
			indexButton.setButtonText(isIndexing ? 'Indexing…' : 'Reindex vault');

			progressRow.toggleClass('is-invisible', !isIndexing);
			
			// Always update the stats element with the current file/status
			statsEl.setText(p.currentFile || (isIndexing ? 'Scanning vault…' : 'Not indexed yet'));

			const lastIndexed = p.lastIndexedAt ?? this.plugin.settings.lastIndexedAt;
			lastIndexedEl.toggleClass('is-invisible', !lastIndexed);

			if (isIndexing) {
				if (p.total > 0) {
					progressCount.setText(`${p.done}/${p.total} files…`);
					progressBar.value = p.done;
					progressBar.max = p.total;
				} else {
					progressCount.setText('Starting…');
					progressBar.value = 0;
					progressBar.max = 1;
				}
			} else {
				if (lastIndexed) {
					lastIndexedEl.setText(`Last indexed: ${formatLastIndexed(lastIndexed)}`);
				}
			}

			// 2. Embedding Model Card
			embeddingDropdown.disabled = isIndexing;

			const embStatus = p.embeddingStatus ?? this.plugin.brain?.embeddingStatus;
			renderModelStatus(embeddingStatusEl, embStatus);

			const isEmbDownloading = embStatus?.state === 'downloading';
			embeddingProgressRow.toggleClass('is-invisible', !isEmbDownloading);
			if (isEmbDownloading) {
				const pct = embStatus?.progress ?? 0;
				embeddingProgressBar.value = pct;
				embeddingProgressPct.setText(`${pct}%`);
			}

			// 3. Reranking Model Card
			const rrStatus = p.rerankerStatus ?? this.plugin.brain?.rerankerStatus;
			renderModelStatus(rerankerStatusEl, rrStatus);

			const isRrDownloading = rrStatus?.state === 'downloading';
			rerankerProgressRow.toggleClass('is-invisible', !isRrDownloading);
			if (isRrDownloading) {
				const pct = rrStatus?.progress ?? 0;
				rerankerProgressBar.value = pct;
				rerankerProgressPct.setText(`${pct}%`);
			}
		};

		this.unsubscribeProgress?.();
		this.unsubscribeProgress = this.plugin.brain?.onProgress(updateUI);
	}
}
