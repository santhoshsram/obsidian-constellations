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
import {
	relatedToNoteWithStrategy,
	type RetrievalStrategy,
} from './search/retrieval';
import type { RelatedNote } from './search/related';
import { debounce } from './utils/debounce';
import { ConsoleLogger } from './utils/logger';
import { BufferedLogFile } from './utils/file-log';
import { sha1Hex } from './index/hasher';

const REINDEX_DEBOUNCE_MS = 2000;
const SAVE_DEBOUNCE_MS = 5000;
const LOG_FLUSH_MS = 2000;

export interface BrainProgress {
	isIndexing: boolean;
	done: number;
	total: number;
	currentFile: string;
	lastIndexedAt: number | null;
}

export class Brain {
	private index: ChunkIndex | null = null;
	private service: IndexingService | null = null;
	private embedder: Embedder | null = null;
	private storage: ObsidianIndexStorage | null = null;
	private ready = false;
	private logger = new ConsoleLogger('obsidian-brain', {
		enabled: this.plugin.settings?.debugLogging ?? false,
	});
	private logFile: BufferedLogFile | null = null;

	progress: BrainProgress = {
		isIndexing: false,
		done: 0,
		total: 0,
		currentFile: '',
		lastIndexedAt: this.plugin.settings?.lastIndexedAt ?? null,
	};
	private onProgressListeners: Array<(progress: BrainProgress) => void> = [];

	constructor(private plugin: ObsidianBrainPlugin) {}

	/** Subscribe to live indexing progress updates. Returns unsubscribe function. */
	onProgress(listener: (progress: BrainProgress) => void): () => void {
		this.onProgressListeners.push(listener);
		listener(this.progress);
		return () => {
			this.onProgressListeners = this.onProgressListeners.filter(
				(l) => l !== listener,
			);
		};
	}

	private updateProgress(p: Partial<BrainProgress>): void {
		this.progress = { ...this.progress, ...p };
		for (const listener of this.onProgressListeners) {
			listener(this.progress);
		}
	}

	/** Recreate the logger when the debug-logging setting changes. */
	refreshLogger(): void {
		this.logger.enabled = this.plugin.settings.debugLogging;
	}

	/** True once the model is loaded and the initial sync has completed. */
	get isReady(): boolean {
		return this.ready;
	}

	/** Load the model and index, then sync the vault. */
	/** True once init() has been started (prevents double-starts). */
	get started(): boolean {
		return this.initStarted;
	}
	private initStarted = false;

	async init(): Promise<void> {
		if (this.initStarted) {
			return;
		}
		this.initStarted = true;
		this.updateProgress({ isIndexing: true, currentFile: 'Initializing...' });
		const pluginDir = await this.ensureLogFile();
		const model = this.currentModel();
		this.storage = new ObsidianIndexStorage(this.plugin.app, pluginDir);
		this.logger.info(`using model ${model.modelId}`);
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
			this.logger.warn('failed to load index, rebuilding', { kind: 'load' }, e);
		}
		if (!this.index) {
			this.index = new ChunkIndex(
				new BruteForceVectorStore(model.dimensions),
			);
		}

		let pipe;
		try {
			this.logger.info(`creating pipeline for model ${model.modelId}`);
			const created = await createEmbeddingPipeline(model, (p) => {
				if (p.status === 'progress' && p.file) {
					const pct = Math.round(p.progress ?? 0);
					this.plugin.setStatus(`Brain: downloading model ${pct}%`);
					this.updateProgress({
						isIndexing: true,
						done: pct,
						total: 100,
						currentFile: `Downloading ${p.file} (${pct}%)`,
					});
				}
			});
			pipe = created.pipe;
			this.logger.info(
				`embedding pipeline ready on device=${created.device}`,
			);
		} catch (e) {
			this.updateProgress({
				isIndexing: false,
				currentFile: 'Model load failed',
			});
			this.plugin.setStatus('Brain: model failed to load');
			new Notice(
				'Obsidian brain: embedding model failed to load. Check the console (Cmd-Option-I) for details.',
				0,
			);
			console.error('Obsidian brain: model load failed', e);
			return;
		}
		this.embedder = new TransformersEmbedder(pipe, model);

		this.service = new IndexingService(
			this.index,
			this.embedder,
			new HeuristicTokenCounter(),
			model,
			this.logger,
		);
		if (state) {
			this.service.setState(state);
		}

		let result;
		try {
			result = await this.service.syncVault(vault, (done, total, path) => {
				this.plugin.setStatus(`Brain: indexing (${done}/${total})…`);
				this.updateProgress({
					isIndexing: true,
					done,
					total,
					currentFile: path,
				});
			});
			await this.persist();
		} catch (e) {
			this.updateProgress({
				isIndexing: false,
				currentFile: 'Indexing failed',
			});
			this.plugin.setStatus('Brain: indexing failed');
			new Notice(
				'Obsidian brain: indexing failed. Check the console (Cmd-Option-I) for details.',
				0,
			);
			console.error('Obsidian brain: indexing failed', e);
			return;
		}
		this.ready = true;
		const hasChanges = result.indexed > 0 || result.removed > 0;
		if (hasChanges || !this.plugin.settings.lastIndexedAt) {
			this.recordIndexCompletion(
				`${result.total} files indexed (${this.index.size} sections)`,
				result.total,
				result.total,
			);
		} else {
			this.updateProgress({
				isIndexing: false,
				done: result.total,
				total: result.total,
				currentFile: `${result.total} files indexed (${this.index.size} sections)`,
			});
		}
		this.plugin.setStatus('');

		this.registerFileEvents(vault);
	}

	/** Full rebuild: drop the index and re-embed everything. */
	async reindex(): Promise<void> {
		if (!this.embedder || this.progress.isIndexing) {
			return;
		}
		this.updateProgress({
			isIndexing: true,
			done: 0,
			total: 0,
			currentFile: 'Starting reindex...',
		});
		const model = this.currentModel();
		this.index = new ChunkIndex(
			new BruteForceVectorStore(model.dimensions),
		);
		this.service = new IndexingService(
			this.index,
			this.embedder,
			new HeuristicTokenCounter(),
			model,
			this.logger,
		);
		const vault = new ObsidianVaultSource(this.plugin.app);
		try {
			const result = await this.service.syncVault(vault, (done, total, path) => {
				this.plugin.setStatus(`Brain: indexing (${done}/${total})…`);
				this.updateProgress({
					isIndexing: true,
					done,
					total,
					currentFile: path,
				});
			});
			await this.persist();
			this.ready = true;
			this.recordIndexCompletion(
				`${result.total} files indexed (${this.index.size} sections)`,
				result.total,
				result.total,
			);
			this.plugin.setStatus('');
		} catch (e) {
			this.updateProgress({
				isIndexing: false,
				currentFile: 'Reindexing failed',
			});
			this.plugin.setStatus('Brain: reindexing failed');
			console.error('Obsidian brain: reindex failed', e);
		}
	}

	/** Notes related to the given (usually active) note. */
	relatedTo(
		filePath: string,
		options?: {
			strategy?: RetrievalStrategy;
			cursorLine?: number;
			cursorHeading?: string;
			chunkIndex?: number;
		},
	): RelatedNote[] {
		if (!this.ready || !this.index) {
			return [];
		}
		return relatedToNoteWithStrategy(this.index, filePath, {
			strategy: options?.strategy ?? this.plugin.settings.retrievalStrategy,
			cursorLine: options?.cursorLine,
			cursorHeading: options?.cursorHeading,
			chunkIndex: options?.chunkIndex,
			maxNotes: this.plugin.settings.maxRelatedNotes,
			maxChunksPerNote: this.plugin.settings.maxChunksPerNote,
			minScore: this.plugin.settings.minScore,
		});
	}

	/** Persist on unload (best effort). */
	async shutdown(): Promise<void> {
		await this.flushLog();
		await this.persist();
	}

	/**
	 * Point the logger at `brain.log` in the plugin dir so log lines are
	 * written to disk for greppability, in addition to the console.
	 * Awaits loading existing lines before attaching the sink so ordering
	 * is preserved (existing lines, then new log lines).
	 */
	private async initLogFile(pluginDir: string): Promise<void> {
		try {
			const adapter = this.plugin.app.vault.adapter;
			const path = `${pluginDir}/brain.log`;
			const logFile = new BufferedLogFile(
				{
					read: async () =>
						(await adapter.exists(path)) ? adapter.read(path) : null,
					write: async (content: string) => {
						if (!(await adapter.exists(pluginDir))) {
							await adapter.mkdir(pluginDir);
						}
						await adapter.write(path, content);
					},
				},
				LOG_FLUSH_MS,
			);
			this.logFile = logFile;
			await logFile.init();
			this.logger.setSink((line) => logFile.append(line));
			this.logFile = logFile;
			this.logger.info('log file sink attached at ' + path);
		} catch (e) {
			// File logging is best-effort; console logging still works.
			this.logger.info('log file sink failed to attach');
			console.warn('Obsidian brain: brain.log unavailable', e);
		}
	}

	/**
	 * Idempotent: resolves the plugin dir, attaches the log file sink if
	 * not already attached, and returns pluginDir for callers that need it
	 * (e.g. to set up storage). Safe to call from benchmark or init.
	 */
	private async ensureLogFile(): Promise<string> {
		const pluginDir =
			this.plugin.manifest.dir ??
			`${this.plugin.app.vault.configDir}/plugins/${this.plugin.manifest.id}`;
		if (!this.logFile) {
			await this.initLogFile(pluginDir);
		}
		return pluginDir;
	}

	private async flushLog(): Promise<void> {
		if (this.logFile) {
			await this.logFile.flush();
		}
	}

	private currentModel() {
		return (
			EMBEDDING_MODELS[this.plugin.settings.embeddingModel] ??
			DEFAULT_MODEL
		);
	}

	private recordIndexCompletion(
		currentFile: string,
		done?: number,
		total?: number,
	): void {
		const now = Date.now();
		this.plugin.settings.lastIndexedAt = now;
		void this.plugin.saveSettings();
		this.updateProgress({
			isIndexing: false,
			lastIndexedAt: now,
			currentFile,
			...(done !== undefined ? { done } : {}),
			...(total !== undefined ? { total } : {}),
		});
	}

	private registerFileEvents(vault: ObsidianVaultSource): void {
		const scheduleSave = debounce(() => {
			void this.persist();
		}, SAVE_DEBOUNCE_MS);

		const reindexFile = debounce((path: string) => {
			void this.indexOne(vault, path).then(scheduleSave);
		}, REINDEX_DEBOUNCE_MS);

		this.plugin.registerEvent(
			this.plugin.app.vault.on('modify', (file) => {
				if (file.path.endsWith('.md')) {
					reindexFile(file.path);
				}
			}),
		);
		this.plugin.registerEvent(
			this.plugin.app.vault.on('create', (file) => {
				if (file.path.endsWith('.md')) {
					reindexFile(file.path);
				}
			}),
		);
		this.plugin.registerEvent(
			this.plugin.app.vault.on('delete', (file) => {
				if (file.path.endsWith('.md')) {
					this.service?.removeFile(file.path);
					this.recordIndexCompletion(`Removed ${file.path}`);
					scheduleSave();
				}
			}),
		);
		this.plugin.registerEvent(
			this.plugin.app.vault.on('rename', (file, oldPath) => {
				if (oldPath.endsWith('.md')) {
					this.service?.removeFile(oldPath);
				}
				if (file.path.endsWith('.md')) {
					reindexFile(file.path);
				}
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
			const content = await vault.read(path);
			const hash = await sha1Hex(content);
			if (this.service.getState().fileHashes[path] === hash) {
				return;
			}
			this.updateProgress({
				isIndexing: true,
				currentFile: `Indexing ${path}…`,
			});
			this.plugin.setStatus('Brain: indexing…');
			await this.service.indexFile(path, content);
			this.recordIndexCompletion(`Updated ${path}`);
			this.plugin.setStatus('');
		} catch (e) {
			this.updateProgress({
				isIndexing: false,
				currentFile: `Failed to index ${path}`,
			});
			this.plugin.setStatus('');
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
