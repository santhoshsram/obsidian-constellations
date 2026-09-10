/**
 * Internal configuration constants for Obsidian Brain.
 *
 * Tunable knobs kept out of the general user settings UI to keep the interface
 * clean, but easily configurable here or via `<Vault>/.obsidian/plugins/obsidian-brain/data.json`.
 */

export const RETRIEVAL_CONFIG = {
	/**
	 * Number of candidate chunks funneled from Stage 1 (dense vector search)
	 * into Stage 2 (cross-encoder reranking).
	 *
	 * - Higher values (e.g. 75–100): wider recall net, slightly longer rerank time.
	 * - Lower values (e.g. 20–30): faster inference, narrower candidate pool.
	 */
	stage1CandidatePoolSize: 50,
} as const;
