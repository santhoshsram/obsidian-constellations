import { App, PluginSettingTab, Setting } from 'obsidian';
import type ObsidianBrainPlugin from './main';

export interface ObsidianBrainSettings {
	/** Hugging Face model ID used for embeddings. */
	embeddingModel: string;
	/** Max related notes shown for the active note. */
	maxRelatedNotes: number;
	/** Max matching chunks shown per related note. */
	maxChunksPerNote: number;
	/** Minimum cosine similarity (0–1) for a chunk to count as related. */
	minScore: number;
}

export const DEFAULT_SETTINGS: ObsidianBrainSettings = {
	embeddingModel: 'nomic-ai/nomic-embed-text-v1.5',
	maxRelatedNotes: 10,
	maxChunksPerNote: 3,
	minScore: 0.45,
};

export class ObsidianBrainSettingTab extends PluginSettingTab {
	plugin: ObsidianBrainPlugin;

	constructor(app: App, plugin: ObsidianBrainPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Embedding model')
			.setDesc(
				'Hugging Face model used for embeddings. Runs locally via ' +
					'transformers.js; downloaded once on first use. Changing ' +
					'this triggers a full re-index.',
			)
			.addText((text) =>
				text
					.setPlaceholder('nomic-ai/nomic-embed-text-v1.5')
					.setValue(this.plugin.settings.embeddingModel)
					.onChange(async (value) => {
						this.plugin.settings.embeddingModel = value.trim();
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
			.setName('Chunks per note')
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
