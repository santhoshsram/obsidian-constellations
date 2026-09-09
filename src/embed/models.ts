/**
 * Embedding model registry. Each entry carries everything the embedding
 * service and chunker need: dimensions, task prefixes, and the chunking
 * token budget for that model.
 */

export interface EmbeddingModelSpec {
	/** Hugging Face model ID. */
	modelId: string;
	/** Embedding dimensions. */
	dimensions: number;
	/** Prepended to vault chunks before embedding (nomic task prefix). */
	documentPrefix: string;
	/** Prepended to queries / active-note text before embedding. */
	queryPrefix: string;
	/**
	 * Chunking token budget. Conservative vs. the model's context limit;
	 * matches the accio.ai default for nomic.
	 */
	maxTokensPerChunk: number;
	/** Embedding batch size. */
	batchSize: number;
}

/**
 * nomic-embed-text-v1.5: 768d, 8192-token context, Matryoshka-resizable,
 * first-class transformers.js support. Default model.
 * https://huggingface.co/nomic-ai/nomic-embed-text-v1.5
 */
export const NOMIC_EMBED_TEXT_V1_5: EmbeddingModelSpec = {
	modelId: 'nomic-ai/nomic-embed-text-v1.5',
	dimensions: 768,
	documentPrefix: 'search_document: ',
	queryPrefix: 'search_query: ',
	maxTokensPerChunk: 2048,
	batchSize: 16,
};

export const EMBEDDING_MODELS: Record<string, EmbeddingModelSpec> = {
	[NOMIC_EMBED_TEXT_V1_5.modelId]: NOMIC_EMBED_TEXT_V1_5,
};

export const DEFAULT_MODEL = NOMIC_EMBED_TEXT_V1_5;
