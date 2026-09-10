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
import {
	createEmbeddingPipeline,
	createRerankerPipeline,
	isModelCached,
} from './embed/pipeline';
import {
	EMBEDDING_MODELS,
	DEFAULT_MODEL,
	RERANKER_MODELS,
	DEFAULT_RERANKER,
} from './embed/models';
import { TransformersReranker, type Reranker } from './embed/reranker';
import { HeuristicTokenCounter } from './chunking/tokens';
import {
	candidateChunksWithStrategy,
	type RetrievalStrategy,
} from './search/retrieval';
import { relatedNotes } from './search/related';
import type { RelatedNote } from './search/related';
import { rerankCandidateChunks } from './search/rerank';
import { RETRIEVAL_CONFIG } from './config';
import { debounce } from './utils/debounce';
import { ConsoleLogger } from './utils/logger';
import { BufferedLogFile } from './utils/file-log';
import { sha1Hex } from './index/hasher';
import type { ModelStatus } from './settings';

const REINDEX_DEBOUNCE_MS = 2000;
const SAVE_DEBOUNCE_MS = 5000;
const LOG_FLUSH_MS = 2000;

export interface BrainProgress {
	isIndexing: boolean;
	done: number;
	total: number;
	currentFile: string;
	lastIndexedAt: number | null;
	embeddingStatus?: ModelStatus;
	rerankerStatus?: ModelStatus;
}

export class Brain {
	private index: ChunkIndex | null = null;
	private service: IndexingService | null = null;
	private embedder: Embedder | null = null;
	private reranker: Reranker | null = null;
	private storage: ObsidianIndexStorage | null = null;
	private ready = false;
	private logger = new ConsoleLogger('obsidian-brain', {
		enabled: this.plugin.settings?.debugLogging ?? false,
	});
	private logFile: BufferedLogFile | null = null;

	embeddingStatus: ModelStatus = { state: 'idle' };
	rerankerStatus: ModelStatus = { state: 'idle' };

	progress: BrainProgress = {
		isIndexing: false,
		done: 0,
		total: 0,
		currentFile: '',
		lastIndexedAt: this.plugin.settings?.lastIndexedAt ?? null,
	};
	private onProgressListeners: Array<(progress: BrainProgress) => void> = [];

	constructor(private plugin: ObsidianBrainPlugin) {}

	setEmbeddingStatus(status: ModelStatus): void {
		this.embeddingStatus = status;
		this.updateProgress({ embeddingStatus: status });
	}

	setRerankerStatus(status: ModelStatus): void {
		this.rerankerStatus = status;
		this.updateProgress({ rerankerStatus: status });
	}

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

	/** Set or swap the reranker instance (useful for testing or dynamic model loading). */
	setReranker(reranker: Reranker | null): void {
		this.reranker = reranker;
	}

	/**
	 * Reset all pipeline state so a fresh init() picks up the new model.
	 * Call this whenever embeddingModel changes in settings.
	 */
	resetForModelChange(): void {
		this.initStarted = false;
		this.ready = false;
		this.embedder = null;
		this.reranker = null;
		this.index = null;
		this.service = null;
		this.embeddingStatus = { state: 'idle' };
		this.rerankerStatus = { state: 'idle' };
		this.updateProgress({
			isIndexing: false,
			done: 0,
			total: 0,
			currentFile: '',
			embeddingStatus: { state: 'idle' },
			rerankerStatus: { state: 'idle' },
		});
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
			const embeddingCached = await isModelCached(model.modelId);
			this.setEmbeddingStatus({ state: 'loading' });
			this.plugin.setStatus('Brain: loading embedding model…');
			const created = await createEmbeddingPipeline(model, (p) => {
				if (!embeddingCached && p.status === 'progress' && p.file) {
					const pct = Math.round(p.progress ?? 0);
					this.plugin.setStatus(`Brain: downloading embedding model ${pct}%`);
					this.setEmbeddingStatus({ state: 'downloading', progress: pct });
				}
			});
			pipe = created.pipe;
			this.logger.info(
				`embedding pipeline ready on device=${created.device}`,
			);
			this.setEmbeddingStatus({ state: 'ready', device: created.device });
			this.plugin.setStatus('Brain: loading embedding model…');
		} catch (e) {
			this.setEmbeddingStatus({ state: 'error', error: String(e) });
			this.plugin.setStatus('Brain: model failed to load');
			new Notice(
				'Obsidian brain: embedding model failed to load. Check the console (Cmd-Option-I) for details.',
				0,
			);
			console.error('Obsidian brain: model load failed', e);
			return;
		}
		this.embedder = new TransformersEmbedder(pipe, model);

		if (this.plugin.settings.rerankerEnabled !== false) {
			try {
				const rerankerModel = this.currentRerankerModel();
				const rerankerCached = await isModelCached(rerankerModel.modelId);
				this.logger.info(`creating reranker pipeline for model ${rerankerModel.modelId}`);
				this.setRerankerStatus({ state: 'loading' });
				this.plugin.setStatus('Brain: loading reranking model…');
				const createdReranker = await createRerankerPipeline(rerankerModel, (p) => {
					if (!rerankerCached && p.status === 'progress' && p.file) {
						const pct = Math.round(p.progress ?? 0);
						this.plugin.setStatus(`Brain: downloading reranking model ${pct}%`);
						this.setRerankerStatus({ state: 'downloading', progress: pct });
					}
				});
				this.reranker = new TransformersReranker(
					createdReranker.rerankPairs,
					rerankerModel,
					createdReranker.device,
				);
				this.setRerankerStatus({ state: 'ready', device: createdReranker.device });
				this.logger.info(
					`reranker pipeline ready on device=${createdReranker.device}`,
				);
			} catch (e) {
				this.setRerankerStatus({ state: 'error', error: String(e) });
				this.logger.warn(
					'reranker model failed to load, retrieval will continue with vector scores',
					{ kind: 'rerank' },
					e,
				);
				console.warn('Obsidian brain: reranker model failed to load', e);
			}
		}

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
			this.plugin.setStatus('Brain: checking for changes…');
			this.updateProgress({
				isIndexing: true,
				done: 0,
				total: 0,
				currentFile: 'Checking vault for changes…',
			});
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
				`${result.total} files / ${this.index.size} sections indexed`,
				result.total,
				result.total,
			);
		} else {
			this.updateProgress({
				isIndexing: false,
				done: result.total,
				total: result.total,
				currentFile: `${result.total} files / ${this.index.size} sections indexed`,
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
			this.plugin.setStatus('Brain: checking for changes…');
			this.updateProgress({
				isIndexing: true,
				done: 0,
				total: 0,
				currentFile: 'Checking vault for changes…',
			});
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
				`${result.total} files / ${this.index.size} sections indexed`,
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
	async relatedTo(
		filePath: string,
		options?: {
			strategy?: RetrievalStrategy;
			cursorLine?: number;
			cursorHeading?: string;
			chunkIndex?: number;
		},
	): Promise<RelatedNote[]> {
		if (!this.ready || !this.index) {
			return [];
		}

		const strategy =
			options?.strategy ?? this.plugin.settings.retrievalStrategy;
		const retrievalOptions = {
			strategy,
			cursorLine: options?.cursorLine,
			cursorHeading: options?.cursorHeading,
			chunkIndex: options?.chunkIndex,
			maxNotes: this.plugin.settings.maxRelatedNotes,
			maxChunksPerNote: this.plugin.settings.maxChunksPerNote,
			minScore: this.plugin.settings.minScore,
		};

		const tTotalStart = performance.now();
		this.logger.info(
			`[retrieval] Query start for "${filePath}" (strategy=${strategy})`,
		);

		// 1. Stage 1: Dense vector retrieval
		const tStage1Start = performance.now();
		const candidates = candidateChunksWithStrategy(
			this.index,
			filePath,
			retrievalOptions,
		);
		const stage1Ms = performance.now() - tStage1Start;
		const sourceChunks = this.index.chunksForFile(filePath);
		this.logger.info(
			`[retrieval] Stage 1 (cosine similarity): ${stage1Ms.toFixed(1)}ms | ` +
				`sourceChunks=${sourceChunks.length} -> candidateChunks=${candidates.length}`,
		);

		if (candidates.length === 0) {
			this.logger.info(
				`[retrieval] No candidates found in stage 1 for "${filePath}" (${stage1Ms.toFixed(1)}ms)`,
			);
			await this.flushLog();
			return [];
		}

		// 2. Stage 2: Cross-encoder reranking (if enabled and loaded)
		if (this.reranker && this.plugin.settings.rerankerEnabled !== false) {
			const vault = new ObsidianVaultSource(this.plugin.app);
			const topK =
				this.plugin.settings.rerankCandidatePoolSize ??
				RETRIEVAL_CONFIG.stage1CandidatePoolSize;
			const tStage2Start = performance.now();
			const reranked = await rerankCandidateChunks({
				candidates,
				fileReader: vault,
				reranker: this.reranker,
				topK,
				logger: this.logger,
			});
			const stage2Ms = performance.now() - tStage2Start;

			const tAssembleStart = performance.now();
			const notes = relatedNotes(reranked, {
				excludeFile: filePath,
				maxNotes: this.plugin.settings.maxRelatedNotes,
				maxChunksPerNote: this.plugin.settings.maxChunksPerNote,
			});
			const assembleMs = performance.now() - tAssembleStart;
			const totalMs = performance.now() - tTotalStart;

			this.logger.info(
				`[retrieval] Finished in ${totalMs.toFixed(1)}ms | ` +
					`stage1=${stage1Ms.toFixed(1)}ms stage2=${stage2Ms.toFixed(1)}ms assemble=${assembleMs.toFixed(1)}ms -> returned ${notes.length} related notes`,
			);
			await this.flushLog();
			return notes;
		}

		const tAssembleStart = performance.now();
		const notes = relatedNotes(candidates, {
			excludeFile: filePath,
			maxNotes: this.plugin.settings.maxRelatedNotes,
			maxChunksPerNote: this.plugin.settings.maxChunksPerNote,
		});
		const assembleMs = performance.now() - tAssembleStart;
		const totalMs = performance.now() - tTotalStart;

		this.logger.info(
			`[retrieval] Finished (vector-only) in ${totalMs.toFixed(1)}ms | ` +
				`stage1=${stage1Ms.toFixed(1)}ms assemble=${assembleMs.toFixed(1)}ms -> returned ${notes.length} related notes`,
		);
		await this.flushLog();
		return notes;
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

	private currentRerankerModel() {
		const configured = this.plugin.settings.rerankerModel;
		if (!configured || configured === 'cross-encoder/ettin-reranker-150m-v1') {
			return DEFAULT_RERANKER;
		}
		return (
			RERANKER_MODELS[configured] ??
			DEFAULT_RERANKER
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
