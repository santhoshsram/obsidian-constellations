/**
 * Embedding model registry. Each entry carries everything the embedding
 * service and chunker need: dimensions, task prefixes, and the chunking
 * token budget for that model.
 */

export interface EmbeddingModelSpec {
	/** Hugging Face model ID. */
	modelId: string;
	/** Clean human-readable name for UI. */
	displayName?: string;
	/** Short hint for UI (e.g. 'Fastest', 'Balanced', 'Best quality'). */
	hint?: string;
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
	/**
	 * Hard sequence-length cap passed to the tokenizer. The ONNX export's
	 * position-embedding table size (NOT the model's advertised context):
	 * exceeding it crashes ONNX with a broadcast error, and community
	 * tokenizer configs often set model_max_length too high for
	 * `truncation: true` alone to protect us.
	 */
	maxLength: number;
	/**
	 * Quantization variants the repo is known to ship (verified against
	 * the HF API), in preferred WebGPU order. transformers.js resolves
	 * these to `onnx/model_<variant>.onnx` (`fp32` = plain `model.onnx`).
	 */
	dtypes: string[];
	/** Pooling strategy: 'mean' (default) or 'last_token' (Qwen3). */
	pooling?: 'mean' | 'last_token' | 'cls';
}

/**
 * all-MiniLM-L6-v2: 384d, 256-token context, very fast and small (~45MB fp16).
 * Classic standard for light local embeddings (120 ch/s).
 * https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2
 */
export const ALL_MINILM_L6_V2: EmbeddingModelSpec = {
	modelId: 'Xenova/all-MiniLM-L6-v2',
	displayName: 'MiniLM L6',
	hint: 'Fastest',
	dimensions: 384,
	documentPrefix: '',
	queryPrefix: '',
	maxTokensPerChunk: 256,
	batchSize: 32,
	dtypes: ['fp16', 'fp32'],
	maxLength: 256,
};

/**
 * Snowflake Arctic Embed XS: 384d, 512-token context, ~22M params.
 * High-efficiency sweet spot: matches MiniLM's ~115 ch/s speed on WebGPU fp16,
 * but with substantially higher retrieval quality (MTEB 62.5 vs 56.3).
 * Query prefix `query:` per Snowflake's convention.
 * https://huggingface.co/Snowflake/snowflake-arctic-embed-xs
 */
export const ARCTIC_EMBED_XS: EmbeddingModelSpec = {
	modelId: 'Snowflake/snowflake-arctic-embed-xs',
	displayName: 'Snowflake Arctic XS',
	hint: 'Balanced',
	dimensions: 384,
	documentPrefix: '',
	queryPrefix: 'query: ',
	maxTokensPerChunk: 512,
	batchSize: 16,
	dtypes: ['fp16', 'fp32'],
	maxLength: 512,
};

/**
 * EmbeddingGemma-300M (ONNX community build): 768d, 2048-token, modern
 * Google embedding model. Top-tier quality (MTEB 68.1) with full 2048-token context.
 * Ships full ONNX variant set. Runs at ~11-12 ch/s.
 * Activations require q8/fp32 (fp16 unsupported on Gemma activations).
 * https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX
 */
export const EMBEDDINGGEMMA_300M: EmbeddingModelSpec = {
	modelId: 'onnx-community/embeddinggemma-300m-ONNX',
	displayName: 'Embedding Gemma 300M',
	hint: 'Best quality',
	dimensions: 768,
	documentPrefix: '',
	queryPrefix: '',
	maxTokensPerChunk: 2048,
	batchSize: 8,
	// Official guidance: activations do NOT support fp16 — use fp32, q8
	// or q4. q4 halves disk vs q8 with minimal quality loss.
	dtypes: ['q4', 'fp32'],
	maxLength: 2048,
};

export const EMBEDDING_MODELS: Record<string, EmbeddingModelSpec> = {
	[EMBEDDINGGEMMA_300M.modelId]: EMBEDDINGGEMMA_300M,
	[ARCTIC_EMBED_XS.modelId]: ARCTIC_EMBED_XS,
	[ALL_MINILM_L6_V2.modelId]: ALL_MINILM_L6_V2,
};

export const DEFAULT_MODEL = EMBEDDINGGEMMA_300M;

/** Models considered by the interactive "Benchmark models" command. */
export const BENCHMARK_MODELS = [
	ALL_MINILM_L6_V2,
	ARCTIC_EMBED_XS,
	EMBEDDINGGEMMA_300M,
];

export interface RerankerModelSpec {
	/** Hugging Face model ID. */
	modelId: string;
	/** Clean human-readable name for UI or logging. */
	displayName?: string;
	/** Short hint or description. */
	hint?: string;
	/** Batch size for cross-encoder inference. */
	batchSize: number;
	/** Max sequence length cap passed to tokenizer. */
	maxLength: number;
	/** Quantization variants preferred in order (e.g. fp16, fp32). */
	dtypes: string[];
}

/**
 * GTE Reranker ModernBERT Base: 150M parameter ModernBERT cross-encoder from Alibaba.
 * Official ONNX export with full sequence classification head.
 * Supports WebGPU fp16, q8, q4 quantization, and WASM.
 * https://huggingface.co/Alibaba-NLP/gte-reranker-modernbert-base
 */
export const GTE_RERANKER_MODERNBERT_BASE: RerankerModelSpec = {
	modelId: 'Alibaba-NLP/gte-reranker-modernbert-base',
	displayName: 'GTE ModernBERT Base',
	hint: 'ModernBERT 150M cross-encoder',
	batchSize: 50,
	maxLength: 512,
	dtypes: ['fp32'],
};

/**
 * MS MARCO MiniLM-L-6-v2: A tiny 22M parameter cross-encoder.
 * The absolute gold standard for extremely fast, lightweight reranking.
 * Ships with official ONNX support from Xenova for transformers.js.
 * https://huggingface.co/Xenova/ms-marco-MiniLM-L-6-v2
 */
export const MS_MARCO_MINILM_L6_V2: RerankerModelSpec = {
	modelId: 'Xenova/ms-marco-MiniLM-L-6-v2',
	displayName: 'MiniLM L6 Reranker',
	hint: 'Extremely fast 22M cross-encoder',
	batchSize: 50,
	maxLength: 512,
	dtypes: ['fp16', 'fp32'],
};

export const RERANKER_MODELS: Record<string, RerankerModelSpec> = {
	[MS_MARCO_MINILM_L6_V2.modelId]: MS_MARCO_MINILM_L6_V2,
};

export const DEFAULT_RERANKER = MS_MARCO_MINILM_L6_V2;
