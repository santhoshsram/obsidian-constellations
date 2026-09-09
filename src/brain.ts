/**
 * Brain: owns the index lifecycle inside Obsidian — model loading,
 * initial sync, file-event-driven incremental updates, persistence —
 * so main.ts stays limited to plugin lifecycle and command registration.
 */

import { Notice } from 'obsidian';
import type ObsidianBrainPlugin from './main';
import { ChunkIndex } from './index/chunk-index';
import { BruteForceVectorStore } from './index/vector-store';
import { IndexingService } from './index/indexing-service';
import { loadIndex, saveIndex } from './index/persistence';
import { ObsidianIndexStorage } from './obsidian/storage';
import { ObsidianVaultSource } from './obsidian/vault-source';
import { TransformersEmbedder } from './embed/embedder';
import type { Embedder } from './embed/embedder';
import { createEmbeddingPipeline } from './embed/pipeline';
import { EMBEDDING_MODELS, DEFAULT_MODEL } from './embed/models';
import { HeuristicTokenCounter } from './chunking/tokens';
import { relatedToNote } from './search/retrieval';
import type { RelatedNote } from './search/related';
import { debounce } from './utils/debounce';

const REINDEX_DEBOUNCE_MS = 2000;
const SAVE_DEBOUNCE_MS = 5000;

export class Brain {
	private index: ChunkIndex | null = null;
	private service: IndexingService | null = null;
	private embedder: Embedder | null = null;
	private storage: ObsidianIndexStorage | null = null;
	private ready = false;

	constructor(private plugin: ObsidianBrainPlugin) {}

	/** True once the model is loaded and the initial sync has completed. */
	get isReady(): boolean {
		return this.ready;
	}

	/** Load the model and index, then sync the vault. */
	async init(): Promise<void> {
		const model = this.currentModel();
		const pluginDir =
			this.plugin.manifest.dir ??
			`${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
		this.storage = new ObsidianIndexStorage(this.plugin.app, pluginDir);
		const vault = new ObsidianVaultSource(this.plugin.app);

		// Load a persisted index; a model switch forces a full rebuild.
		let state = null;
		try {
			const loaded = await loadIndex(this.storage, model.dimensions);
			if (loaded && loaded.state.modelId === model.modelId) {
				this.index = loaded.index;
				state = loaded.state;
			}
		} catch (e) {
			console.warn('Obsidian Brain: failed to load index, rebuilding', e);
		}
		if (!this.index) {
			this.index = new ChunkIndex(
				new BruteForceVectorStore(model.dimensions),
			);
		}

		new Notice(
			'Obsidian brain: loading embedding model (downloaded once, then cached locally)…',
		);
		const pipe = await createEmbeddingPipeline(model.modelId, (p) => {
			if (p.status === 'progress' && p.file) {
				this.plugin.setStatus(
					`Brain: downloading model ${Math.round(p.progress ?? 0)}%`,
				);
			}
		});
		this.embedder = new TransformersEmbedder(pipe, model);

		this.service = new IndexingService(
			this.index,
			this.embedder,
			new HeuristicTokenCounter(),
			model,
		);
		if (state) {
			this.service.setState(state);
		}

		const result = await this.service.syncVault(vault, (done, total) => {
			this.plugin.setStatus(`Brain: indexing ${done}/${total}`);
		});
		await this.persist();
		this.ready = true;
		this.plugin.setStatus(
			`Brain: ${this.index.size} chunks indexed (${result.indexed} new, ${result.skipped} unchanged)`,
		);

		this.registerFileEvents(vault);
	}

	/** Full rebuild: drop the index and re-embed everything. */
	async reindex(): Promise<void> {
		if (!this.embedder) {
			return;
		}
		const model = this.currentModel();
		this.index = new ChunkIndex(
			new BruteForceVectorStore(model.dimensions),
		);
		this.service = new IndexingService(
			this.index,
			this.embedder,
			new HeuristicTokenCounter(),
			model,
		);
		new Notice('Obsidian brain: re-indexing vault…');
		const vault = new ObsidianVaultSource(this.plugin.app);
		await this.service.syncVault(vault, (done, total) => {
			this.plugin.setStatus(`Brain: indexing ${done}/${total}`);
		});
		await this.persist();
		this.plugin.setStatus(`Brain: ${this.index.size} chunks indexed`);
	}

	/** Notes related to the given (usually active) note. */
	relatedTo(filePath: string): RelatedNote[] {
		if (!this.ready || !this.index) {
			return [];
		}
		return relatedToNote(this.index, filePath, {
			maxNotes: this.plugin.settings.maxRelatedNotes,
			maxChunksPerNote: this.plugin.settings.maxChunksPerNote,
			minScore: this.plugin.settings.minScore,
		});
	}

	/** Persist on unload (best effort). */
	async shutdown(): Promise<void> {
		await this.persist();
	}

	private currentModel() {
		return (
			EMBEDDING_MODELS[this.plugin.settings.embeddingModel] ??
			DEFAULT_MODEL
		);
	}

	private registerFileEvents(vault: ObsidianVaultSource): void {
		const scheduleSave = debounce(() => {
			void this.persist();
		}, SAVE_DEBOUNCE_MS);

		const reindexFile = debounce((path: string) => {
			void this.indexOne(vault, path).then(scheduleSave);
		}, REINDEX_DEBOUNCE_MS);

		this.plugin.registerEvent(
			this.plugin.app.vault.on('modify', (file) =>
				reindexFile(file.path),
			),
		);
		this.plugin.registerEvent(
			this.plugin.app.vault.on('create', (file) =>
				reindexFile(file.path),
			),
		);
		this.plugin.registerEvent(
			this.plugin.app.vault.on('delete', (file) => {
				this.service?.removeFile(file.path);
				scheduleSave();
			}),
		);
		this.plugin.registerEvent(
			this.plugin.app.vault.on('rename', (file, oldPath) => {
				this.service?.removeFile(oldPath);
				reindexFile(file.path);
			}),
		);
	}

	private async indexOne(
		vault: ObsidianVaultSource,
		path: string,
	): Promise<void> {
		if (!this.service) {
			return;
		}
		try {
			await this.service.indexFile(path, await vault.read(path));
		} catch (e) {
			console.warn(`Obsidian brain: failed to index ${path}`, e);
		}
	}

	private async persist(): Promise<void> {
		if (!this.index || !this.service || !this.storage) {
			return;
		}
		await saveIndex(this.storage, this.index, this.service.getState());
	}
}
