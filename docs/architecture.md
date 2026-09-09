# Obsidian Brain — Technical Design

A local-first "second brain" plugin for Obsidian: it indexes the vault into
semantic chunks, embeds them fully on-device, and surfaces related notes
(with the exact matching sections) for whatever note you're viewing.
Semantic graph and chat follow in later phases.

## Goals & principles

- **Local-first.** Embeddings run in-plugin via transformers.js
  (ONNX/WASM, WebGPU when available). The only network call in v1 is the
  one-time model download from Hugging Face — disclosed in README and
  settings.
- **Simple over clever.** No native dependencies, no ANN library until
  profiling says otherwise, no external servers for embeddings.
- **Actively evolving memory.** The index stays fresh via file events,
  not scheduled re-indexing.
- **Desktop only for now** (`isDesktopOnly: true`); mobile later.

## Stack

| Concern | Choice |
| --- | --- |
| Language / build | TypeScript (strict), npm, esbuild → `main.js` |
| Embedding runtime | `@huggingface/transformers` (transformers.js, ONNX) |
| Embedding model | `nomic-ai/nomic-embed-text-v1.5` (768d, 8192 ctx, q8 ~140MB) |
| Vector search | Brute-force cosine over `Float32Array`, behind a `VectorStore` interface |
| Persistence | Plugin dir: `vectors.bin`, `chunks.json`, `state.json` |
| Tests | vitest; parser verified against Python reference outputs |
| Chat (Phase 4) | Ollama / LM Studio via OpenAI-compatible API |

### Why nomic-embed-text-v1.5

- 8192-token context → keeps the accio.ai `MAX_TOKENS = 2048` chunking
  intact (bge-small's 512 ctx would force much smaller chunks).
- First-class transformers.js support (official ONNX weights).
- Matryoshka embeddings: 768d truncatable to 256d for a ~3× smaller
  index with negligible quality loss, if ever needed.
- Task prefixes: `search_document:` for vault chunks, `search_query:`
  for queries/active notes. Baked into the embedding service.

Alternatives (settings, later): `bge-small-en-v1.5` (fast/light),
`bge-base-en-v1.5` (quality). `embeddinggemma-300m` is gated on HF;
`Qwen3-Embedding-0.6B` has no official transformers.js path. Deferred.

## Chunking pipeline (port of `accio.ai/md-parsers.py`)

Faithful TypeScript port of the hand-rolled regex pipeline, extended
from 3 to **4 heading levels**:

1. `splitBySections(text, level=1)` — recursive regex split on
   `#`…`####`, returning `(headingBreadcrumb, content)` tuples. Sections
   shorter than `MIN_SECTION_LEN = 50` chars are dropped.
2. Filename is prepended to the breadcrumb unless the first heading
   already matches the filename. Empty breadcrumb entries (levels with
   no heading) are filtered out when building the title context.
3. `mdCleanup(text)` — `flattenTable` (pipe tables → space-joined
   rows) → `stripMdMarkups` (headings, bold/italic, highlights, quotes,
   bullets, links) → `stripSpaces` → `removeEmptyLines` → lowercase.
4. `splitByMaxTokens(titles, text, tokenizer, MAX_TOKENS=2048)` —
   recursive halving via `halvedByDelimiter` on `"\n\n"` → `"\n"` →
   `". "`, balancing token counts; truncate after 5 recursions.

Token counting uses the model's own tokenizer (transformers.js). A
`TokenCounter` interface allows a heuristic fallback (~4 chars/token)
for tests and pre-model-load paths.

## Index & storage

All under `<Vault>/.obsidian/plugins/obsidian-brain/` via
`app.vault.adapter` — never inside the user's notes.

- **`vectors.bin`** — one contiguous `Float32Array` (n_chunks × dims),
  row = chunk. Written with `writeBinary`.
- **`chunks.json`** — chunk metadata (see below). Offsets, not text
  copies: no duplication of vault content.
- **`state.json`** — per-file content hashes, model ID, index stats.
  Used for catch-up scans and to trigger full rebuilds on model change.

### Chunk ↔ vector referencing

Chunk identity is **content-addressed**, not position-based:

```ts
interface ChunkRecord {
  id: string;            // sha1 of cleanText — stable across edits/renames
  filePath: string;
  headingPath: string[]; // ["Note title", "Section", "Subsection"]
  startLine: number;     // click-through navigation
  endLine: number;
  vectorRow: number;     // row into vectors.bin
}
```

- **Chunk → vector:** `vectorRow` indexes the matrix (row-major).
- **Vector → chunk:** search returns rows → `chunks[row]`; tombstones on
  delete, compacted on save.
- **Edit efficiency:** re-chunk a changed file, hash each chunk, reuse
  embeddings for unchanged chunks — editing a paragraph costs one
  embedding call.
- **Chunk → note:** `filePath` + `startLine` (or `#heading` subpath)
  for navigation.

### Why no ANN library (yet)

At <500 notes (~2–5k chunks × 768d), brute-force cosine is
sub-millisecond. The `VectorStore` interface (`add` / `remove` /
`search`) allows swapping in `vectra` (pure TS) or `usearch` (WASM)
later. `hnswlib-node` is rejected (native bindings, Electron ABI pain).

## Indexing lifecycle

Event-driven, never scheduled:

- **File events** (`create`/`modify`/`delete`/`rename`, via
  `registerEvent`) → debounce ~2–3s → re-chunk that file → embed only
  new/changed chunks.
- **Plugin load:** catch-up scan comparing stored vs. current file
  hashes.
- **On demand:** "Reindex vault" command; automatic full rebuild when
  the configured model differs from the indexed model.

## Retrieval

1. Embed the query (or active note's chunks) with the `search_query:`
   prefix.
2. Cosine similarity vs. all chunk vectors (brute force).
3. Exclude the active note itself; apply score threshold.
4. Group by file, keep top 2–3 chunks per note, rank notes by best
   chunk score.

## UI (Phase 2, mocked in HTML first)

- Right-sidebar `ItemView`: "Related notes" for the active note,
  expandable to show the top matching chunks, click-through to
  note/heading.
- Status bar: indexing progress / index freshness.
- Settings tab: model choice, result counts, score threshold, re-index.
- Phase 3: semantic graph view (custom canvas or `d3-force`).
- Phase 4: chat view (RAG over the same retrieval; Ollama/LM Studio).

## Security & privacy

- Fully offline after the one-time model download (disclosed).
- No telemetry. Index files live in the plugin dir, outside notes.
- All listeners/intervals registered via `register*` helpers for clean
  unload.
