import { Plugin } from 'obsidian';
import {
	DEFAULT_SETTINGS,
	ObsidianBrainSettings,
	ObsidianBrainSettingTab,
} from './settings';

export default class ObsidianBrainPlugin extends Plugin {
	settings!: ObsidianBrainSettings;

	async onload() {
		await this.loadSettings();

		this.addSettingTab(new ObsidianBrainSettingTab(this.app, this));
	}

	onunload() {}

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
