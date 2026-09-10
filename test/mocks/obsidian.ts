export class PluginSettingTab {
	app: any;
	plugin: any;
	containerEl = {
		empty: () => {},
		createDiv: () => ({
			createDiv: () => ({
				createSpan: () => ({ setText: () => {} }),
				createEl: () => ({}),
			}),
			createSpan: () => ({ setText: () => {} }),
			createEl: () => ({}),
			setText: () => {},
		}),
	};
	constructor(app: any, plugin: any) {
		this.app = app;
		this.plugin = plugin;
	}
}

export class Setting {
	constructor(public containerEl: any) {}
	setName() { return this; }
	setDesc() { return this; }
	addButton() { return this; }
	addToggle() { return this; }
	addDropdown() { return this; }
	addText() { return this; }
}

export class ButtonComponent {}
export class Notice {}
