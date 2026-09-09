/**
 * VaultSource backed by Obsidian's vault API: all markdown files,
 * read as text.
 */

import type { App } from 'obsidian';
import type { VaultSource } from '../index/indexing-service';

export class ObsidianVaultSource implements VaultSource {
	constructor(private app: App) {}

	async listMarkdown(): Promise<string[]> {
		return this.app.vault.getMarkdownFiles().map((f) => f.path);
	}

	async read(path: string): Promise<string> {
		const file = this.app.vault.getFileByPath(path);
		if (!file) {
			throw new Error(`no such file: ${path}`);
		}
		return this.app.vault.cachedRead(file);
	}
}
