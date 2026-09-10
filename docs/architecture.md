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

### Default Model: embeddinggemma-300m-ONNX

- 2048-token context → keeps the accio.ai `MAX_TOKENS = 2048` chunking intact.
- Modern Google embedding architecture with top-tier retrieval quality (MTEB 68.1).
- Ships full ONNX variant set (`q8`, `q4`, `fp32`). Runs on WebGPU at ~11-12 ch/s.
- Clean document and query embeddings (no awkward task prefixes required).

Alternatives in registry:
- `Snowflake/snowflake-arctic-embed-xs` (384d, 512-token, 115 ch/s, MTEB 62.5 — fast/lightweight pick)
- `Xenova/all-MiniLM-L6-v2` (384d, 256-token, 120 ch/s — classic standard)

## Chunking pipeline

The chunking pipeline combines heading hierarchy with fine-grained semantic block parsing:

1. **Heading splitting (`splitBySections`)**: Recursive regex split on
   `#`…`####` (extended from accio.ai's 3 levels to 4), returning
   `(headingBreadcrumb, content)` tuples.
2. **Contextual breadcrumb**: The source filename is prepended to the
   breadcrumb unless the first heading already matches it.
3. **Block & paragraph parsing (`extractBlocks`)**:
   Within each heading section (or across heading-less notes), text is
   decomposed into discrete semantic blocks:
   - **List item trees**: Top-level bullets (`- `, `* `, `\d+\. `) and
     all their indented child items remain bound together as a unit of thought.
   - **Pseudo-headings**: Standalone bold lines (`**Title**` on its own line)
     are recognized as section boundaries and appended to the heading breadcrumb.
     Inline bold labels (`**Note:** text...`) remain paragraph prose.
   - **Prose paragraphs**: Split on blank lines (`\n\s*\n+`).
   - **Line coordinates**: Every block tracks exact `startLine` and `endLine`
     (0-indexed) relative to the source note for precise cursor matching and navigation.
4. **Token grouping (`groupBlocks`)**: Small adjacent blocks (< 80 tokens)
   are merged up to a target size of ~250 tokens so embeddings retain sufficient
   context, while substantial blocks ($\ge 80$ tokens) remain standalone.
5. **Text cleanup (`mdCleanup`)**: Pipe tables flattened, markdown markup
   stripped, whitespace normalized, and text lowercased.
6. **Token bounding (`splitByMaxTokens`)**: Oversized blocks (> 2,048 tokens)
   are halved recursively on natural delimiters (`\n\n` → `\n` → `. ` → ` `).

## Index & storage

All under `<Vault>/.obsidian/plugins/obsidian-brain/` via
`app.vault.adapter` — never inside the user's notes.

- **`vectors.bin`** — one contiguous `Float32Array` (n_chunks × dims),
  row = chunk. Written with `writeBinary`.
- **`chunks.json`** — chunk metadata (offsets, not text copies; see below).
- **`state.json`** — per-file content hashes, model ID, index stats.
  Used for catch-up scans and to trigger full rebuilds on model change.

### Space Optimization: Zero Text Duplication Policy

**Never store text copies in `chunks.json`.**
Storing raw or cleaned text strings in `chunks.json` causes a 2× vault storage footprint penalty (duplicating the vault's entire content on disk). The note content already lives in the user's markdown files.

- `chunks.json` only stores structural metadata and line coordinates:
  - `filePath`, `headingPath`, `startLine`, `endLine`, `id` (sha1), `vectorRow`.
- **UI Snippets on Demand:** When the related-notes sidebar or search view needs to display a text preview for a chunk, it reads the note from disk via `app.vault.read(file)` and slices lines `[startLine..endLine]`.
- **In-memory during active indexing:** Text is held in memory only while passing through chunking and embedding, then discarded from persistent storage.

### Chunk ↔ vector referencing & Granular Navigation

Chunk identity is **content-addressed**, not position-based:

```ts
interface ChunkRecord {
  id: string;            // sha1 of cleanText — stable across edits/renames
  filePath: string;
  headingPath: string[]; // ["Note title", "Section", "Subsection"]
  startLine?: number;    // 0-indexed start line in source file
  endLine?: number;      // 0-indexed end line in source file
  vectorRow: number;     // row into vectors.bin
}
```

- **Chunk → vector:** `vectorRow` indexes the matrix (row-major).
- **Vector → chunk:** search returns rows → `chunks[row]`; tombstones on
  delete, compacted on save.
- **Edit efficiency:** re-chunk a changed file, hash each chunk, reuse
  embeddings for unchanged chunks — editing a paragraph costs one
  embedding call.
- **Granular Navigation (Phase 2):**
  - **Heading navigation:** `app.workspace.openLinkText(`${filePath}#${deepestHeading}`, '')` jumps to the section.
  - **Exact Block navigation:** `leaf.openFile(file, { eState: { line: chunk.startLine, focus: true } })` scrolls the editor directly to the specific paragraph/block without modifying the note or adding synthetic block IDs (`^...`).

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

The plugin provides three matching modes tailored to different note structures and research workflows:

### 1. Detailed (MaxSim / All-Pairs Matching) — Default
- **How it works**: Compares every chunk $\vec{v}_k$ of the active note individually against all chunk vectors in the vault:
  $$\text{Score}(\text{doc}) = \max_{c \in \text{active}} \max_{c' \in \text{doc}} \text{cosine}(c, c')$$
- **Attribution**: Preserves both the source section (`matchedSourceHeading`) and the target section (`matchedHeading`, `startLine`), pinpointing the exact idea connecting two notes.
- **Cost**: Sub-millisecond matrix operations reusing stored vector rows with zero embedding inference overhead.
- **Best for**: Multi-topic notes, daily logs, and sprawling braindumps. Avoids the "topic dilution" trap where diverse ideas average out to an unrepresentative centroid.

### 2. Focused (Cursor / Active Section Context)
- **How it works**: Pinpoints the user's immediate editing or reading focus via editor cursor coordinates (`editor.getCursor().line`).
- **Resolution**:
  1. Identifies the specific chunk bounding the cursor line (`chunk.startLine <= cursorLine && cursorLine <= chunk.endLine`).
  2. Falls back to matching the active heading if outside block ranges.
  3. Queries using only that chunk's vector.
- **Best for**: Exploring connections to a single paragraph, quote, or sub-idea while reading or actively writing in a long note.

### 3. Broad (Mean Vector Pooling)
- **How it works**: Computes the document centroid $\vec{q} = \frac{1}{N} \sum_{i=1}^N \vec{v}_i$ across all chunks in the note and runs brute-force cosine similarity against the vault.
- **Best for**: Short, coherent, single-topic notes where overall thematic overlap is desired rather than section-specific links.

### Retrieval Enhancements (Planned)

- **Hybrid Search (Lexical BM25 + Dense Vectors)**:
  Combine sparse term matching (BM25 for exact IDs, technical terms, code symbols) with dense semantic embeddings using Reciprocal Rank Fusion (RRF).


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

## Appendix: transformers.js in Obsidian (hard-won notes)

Obsidian's Electron renderer has Node integration, so
`process.release.name === 'node'` and transformers.js misdetects the
environment, selecting the `onnxruntime-node` backend — an empty stub in
the web build. Additionally, modern onnxruntime-web self-registers under
`globalThis[Symbol.for('onnxruntime')]`, and transformers.js's symbol
branch never populates `supportedDevices`, so every device is rejected.

**Our fix** (`src/embed/pipeline.ts`): import onnxruntime-web first and
delete the global symbol; then patch `process.release.name` around a
dynamic `import('@huggingface/transformers')` (restored immediately
after). transformers.js then takes its web branch: real WASM runtime,
correct device lists. Device fallback chain: WebGPU q8 → WASM q8 →
WASM auto (no device key).

**Why not load transformers.js from a CDN like Smart Connections?**
Smart Connections marks `@huggingface/transformers` as external and
dynamically imports it from jsdelivr at runtime. That avoids all
bundling issues but means executing remote code on every startup —
against Obsidian's plugin guidelines and this project's security rules.
We bundle instead.
