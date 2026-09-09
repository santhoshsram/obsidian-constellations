/**
 * IndexStorage backed by Obsidian's DataAdapter, storing index files in
 * the plugin's own directory inside .obsidian — never among the user's
 * notes.
 */

import type { App } from 'obsidian';
import { normalizePath } from 'obsidian';
import type { IndexStorage } from '../index/persistence';

export class ObsidianIndexStorage implements IndexStorage {
	constructor(
		private app: App,
		private pluginDir: string,
	) {}

	private fullPath(path: string): string {
		return normalizePath(`${this.pluginDir}/${path}`);
	}

	async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
		await this.ensureDir();
		await this.app.vault.adapter.writeBinary(this.fullPath(path), data);
	}

	async writeJson(path: string, data: unknown): Promise<void> {
		await this.ensureDir();
		await this.app.vault.adapter.write(
			this.fullPath(path),
			JSON.stringify(data),
		);
	}

	async readBinary(path: string): Promise<ArrayBuffer | null> {
		if (!(await this.exists(path))) {
			return null;
		}
		return this.app.vault.adapter.readBinary(this.fullPath(path));
	}

	async readJson(path: string): Promise<unknown> {
		if (!(await this.exists(path))) {
			return null;
		}
		const raw = await this.app.vault.adapter.read(this.fullPath(path));
		return JSON.parse(raw) as unknown;
	}

	async exists(path: string): Promise<boolean> {
		return this.app.vault.adapter.exists(this.fullPath(path));
	}

	private async ensureDir(): Promise<void> {
		if (!(await this.app.vault.adapter.exists(this.pluginDir))) {
			await this.app.vault.adapter.mkdir(this.pluginDir);
		}
	}
}
