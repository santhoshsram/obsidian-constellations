/**
 * Single source for the plugin display name.
 * All user-facing strings reference this so a rename only touches manifest.json.
 */
let _name = 'Obsidian Brain'; // fallback

export function setPluginName(name: string): void {
	_name = name;
}

export function pluginName(): string {
	return _name;
}
