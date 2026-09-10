# Learnings

Dated notes from debugging and competitor analysis. Newest first.

## 2026-09-10 — Model benchmark results and registry pruning

Empirical 9-model benchmark on Apple Silicon WebGPU revealed key findings:
1. **FP16 vs INT8 on WebGPU:** Models shipping native `fp16` ONNX graphs (`all-MiniLM`, `arctic-xs`, `bge-small`) run 4–13× faster than INT8 `q8` models (`bge-micro`). WebGPU shaders execute half-precision floating point on Apple GPU ALUs with zero unpacking overhead, whereas INT8 dequantization requires per-element runtime unpacking. This explains why `bge-small` (33M params) ran at 40 ch/s while `bge-micro` (17M params) crawled at 8 ch/s.
2. **Registry pruned to 3 models:**
   - **`onnx-community/embeddinggemma-300m-ONNX` (New Default):** 768d, 2048-token context, MTEB 68.1. Runs at ~11-12 ch/s. Completely replaces Nomic v1.5 (same speed, +6 points higher quality).
   - **`Snowflake/snowflake-arctic-embed-xs` (Fast Pick):** 384d, 512-token context, 115 ch/s. Matches MiniLM speed, but +8.6 points higher retrieval quality (MTEB 62.5 vs 56.3).
   - **`Xenova/all-MiniLM-L6-v2` (Classic Standard):** 384d, 256-token context, 120 ch/s, 45MB download.
   - Dropped: Nomic (redundant with Gemma), Qwen3-0.6B (1.2GB, 4 ch/s), Multilingual-E5 (deferred), BGE-Micro (no fp16, 8 ch/s), BGE-Small (superseded by Arctic-XS), Arctic-S (redundant with XS).

## 2026-09-10 — Smart Connections adapter read-through

Read the current `smart-embed-model/adapters/transformers.js` source
(web search + raw GitHub). Four takeaways for our embedding stack:

### 1. Model size is the dominant speed factor

Smart Connections defaults to **TaylorAI/bge-micro-v2**: ~17M params,
384 dims. Ours defaulted to nomic-embed-text-v1.5 (~137M, 768d).
Transformer inference cost scales with params and output dim, so this
one choice likely explains most of the speed gap — same stack
(transformers.js → WebGPU/WASM fallbacks, same
`{pooling: 'mean', normalize: true}` call shape), wildly different
throughput. Our nomic run measured ~1s/chunk on M5 WebGPU.
Action: registry now includes `TaylorAI/bge-micro-v2` alongside
arctic-xs/s, multilingual-e5-small, MiniLM, bge-small; model dropdown
in settings lets us match their default exactly.

### 2. Batch size is not the lever (memory was stale)

Remembered "Smart Connections batches 64"; current code says
`batch_size` = 1 on GPU, 8 on WASM. Our batch-16 on nomic costs
~15s/batch on this machine — batching cannot fix a per-chunk
throughput that slow. Match their batch-1 semantics for tiny models
before assuming bigger batches help.

### 3. Dtype order is a secondary lever we didn't pull

Their fallback chain starts `webgpu_fp16` (full precision first!),
then fp32, then q8/q4 — ours goes straight to q8 on the assumption
quantized is faster. transformers.js q8 ONNX graphs aren't always the
fastest path; fp16 on Apple GPU is frequently quicker than expected.
If bge-micro still crawls under our q8-first chain, try `fp16` first.
They also hit `q4f16`/`bnb4` tiers we could adopt.

**Model-specific caveat (2026-09-10):** EmbeddingGemma-300M's
activations do NOT support fp16 or its derivatives (per Google's
model card). Use fp32, q8, or q4 — q4 halves disk vs q8 with minimal
MTEB loss (67.91 vs 68.13 en-v2). Registry stores
`dtypes: ['q8', 'q4', 'fp32']` for it, skipping fp16 entirely.

**Qwen3-Embedding-0.6B (2026-09-10):** Unlike Gemma, Qwen3 does NOT suffer
from fp16 activation overflow. Alibaba officially trains and recommends
`torch.float16`, and WebGPU fp16 runs natively and quickly on Apple GPU.
Registry stores `dtypes: ['fp16', 'q8', 'q4', 'fp32']` under HuggingFace repo
`onnx-community/Qwen3-Embedding-0.6B-ONNX`. Unlike mean-pooling models, Qwen3
uses `last_token` pooling (EOS token hidden state). Furthermore, Qwen3
is instruction-aware: query embeddings take an instruction prefix
(`Instruct: Given a search query, retrieve relevant notes\nQuery: `) while
vault chunks are embedded plain.

### 4. Defensive habits worth copying (robustness, not speed)

- They truncate inputs to `max_tokens` via the tokenizer before
  embedding (we rely on chunker token budgets instead — fine, but
  their way is belt-and-braces at inference time).
- On batch failure they retry items individually, then reset the
  pipeline to the WASM fallback. We throw. That's why their indexing
  "just works" while ours stalls on odd files.
