export class MockElement {
	tagName: string;
	className: string = '';
	textContent: string = '';
	children: MockElement[] = [];
	parentElement: MockElement | null = null;
	attributes: Record<string, string> = {};
	eventListeners: Record<string, Array<(e?: any) => void>> = {};

	constructor(tagName = 'div') {
		this.tagName = tagName;
	}

	empty() {
		this.children = [];
		this.textContent = '';
	}

	setText(text: string) {
		this.textContent = text;
		return this;
	}

	createEl(
		tag: string,
		o?: { cls?: string; text?: string; attr?: Record<string, string> },
	) {
		const el = new MockElement(tag);
		if (o?.cls) el.className = o.cls;
		if (o?.text) el.textContent = o.text;
		if (o?.attr) el.attributes = { ...o.attr };
		el.parentElement = this;
		this.children.push(el);
		return el;
	}

	createDiv(o?: { cls?: string; text?: string }) {
		return this.createEl('div', o);
	}

	createSpan(o?: { cls?: string; text?: string }) {
		return this.createEl('span', o);
	}

	addEventListener(type: string, listener: (e?: any) => void) {
		if (!this.eventListeners[type]) this.eventListeners[type] = [];
		this.eventListeners[type].push(listener);
	}

	click() {
		for (const fn of this.eventListeners['click'] ?? []) {
			fn();
		}
	}

	querySelector(selector: string): MockElement | null {
		for (const child of this.children) {
			if (
				selector.startsWith('.') &&
				child.className.split(' ').includes(selector.slice(1))
			) {
				return child;
			}
			if (child.tagName.toLowerCase() === selector.toLowerCase()) {
				return child;
			}
			const found = child.querySelector(selector);
			if (found) return found;
		}
		return null;
	}

	querySelectorAll(selector: string): MockElement[] {
		const results: MockElement[] = [];
		for (const child of this.children) {
			if (
				selector.startsWith('.') &&
				child.className.split(' ').includes(selector.slice(1))
			) {
				results.push(child);
			} else if (child.tagName.toLowerCase() === selector.toLowerCase()) {
				results.push(child);
			}
			results.push(...child.querySelectorAll(selector));
		}
		return results;
	}
}

export class PluginSettingTab {
	app: any;
	plugin: any;
	containerEl: any;
	constructor(app: any, plugin: any) {
		this.app = app;
		this.plugin = plugin;
		this.containerEl = new MockElement('div');
	}
}

export class Setting {
	constructor(public containerEl: any) {}
	setName() { return this; }
	setDesc() { return this; }
	addButton() { return this; }
	addToggle(cb?: (toggle: any) => void) {
		if (cb) {
			cb({
				setValue: () => ({ onChange: () => {} }),
			});
		}
		return this;
	}
	addDropdown() { return this; }
	addText() { return this; }
	addSlider() { return this; }
}

export class ButtonComponent {}
export class Notice {
	constructor(public message: string, public duration?: number) {}
}

export class ItemView {
	app: any;
	leaf: any;
	contentEl: MockElement;
	containerEl: MockElement;

	constructor(leaf: any) {
		this.leaf = leaf;
		this.app = leaf?.app;
		this.contentEl = new MockElement('div');
		this.containerEl = new MockElement('div');
		this.containerEl.children.push(this.contentEl);
	}

	getViewType(): string {
		return '';
	}
	getDisplayText(): string {
		return '';
	}
	getIcon(): string {
		return '';
	}
	onload(): void {}
	onunload(): void {}
	registerEvent(_eventRef: any): void {}
	async onOpen(): Promise<void> {}
	async onClose(): Promise<void> {}
}

export class WorkspaceLeaf {
	app: any;
	view: any;
	constructor(app?: any) {
		this.app = app;
	}
	openFile() {
		return Promise.resolve();
	}
}

export class MarkdownView {
	editor: any;
	file: any;
}

export class TFile {
	path: string = '';
	basename: string = '';
	extension: string = '';
	constructor(path = '') {
		this.path = path;
		const parts = path.split('/');
		const file = parts[parts.length - 1] ?? '';
		const dot = file.lastIndexOf('.');
		this.basename = dot >= 0 ? file.slice(0, dot) : file;
		this.extension = dot >= 0 ? file.slice(dot + 1) : '';
	}
}

export class Plugin {
	app: any;
	manifest: any;
	constructor(app: any, manifest: any) {
		this.app = app;
		this.manifest = manifest;
	}
	addCommand() {}
	addSettingTab() {}
	addStatusBarItem() {
		return new MockElement('div');
	}
	registerView() {}
	registerEvent() {}
	loadData() {
		return Promise.resolve({});
	}
	saveData() {
		return Promise.resolve();
	}
}

export function setIcon(parent: any, iconId: string) {
	if (parent && typeof parent.createSpan === 'function') {
		parent.createSpan({ cls: `svg-icon lucide-${iconId}` });
	}
}
