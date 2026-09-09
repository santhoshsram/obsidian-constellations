# Roadmap

> **Process note:** we follow strict TDD — failing test first, then
> implementation. Every phase below starts with tests.

## Phase 0 — Skeleton & parser port ✅

- Rename plugin: `id: obsidian-brain`, name "Obsidian Brain",
  `isDesktopOnly: true`, `minAppVersion: 1.5.7`.
- Minimal `main.ts` (lifecycle only) + settings tab scaffold.
- Port `accio.ai/md-parsers.py` chunking pipeline to TypeScript
  (`src/chunking/`), extended to 4 heading levels.
- vitest test suite, with expected outputs generated from the original
  Python code for fidelity.
- `npm run build`, `npm test`, `npm run lint` green.

## Phase 1 — Embeddings & index (headless)

- `EmbeddingService`: transformers.js + nomic-embed-text-v1.5, model
  download with progress, `search_document:` / `search_query:` prefixes.
- `TokenCounter` backed by the model tokenizer.
- Persistent index: `vectors.bin` + `chunks.json` + `state.json`;
  content-addressed chunk IDs; embedding reuse on edits.
- `VectorStore` interface + brute-force cosine implementation.
- File-event-driven incremental indexing (debounced) + catch-up scan on
  load + "Reindex vault" command.
- Validation: command-palette "Find related to current note" logging
  results to console.

## Phase 2 — Related-notes UI

- Static HTML mocks of the sidebar (2–3 variants) → review → implement.
- Right-sidebar `ItemView`: related notes + top 2–3 matching chunks,
  click-through navigation.
- Status bar indexing progress; settings tab complete.

## Phase 3 — Semantic graph

- Design TBD after Phase 2. Custom canvas force layout vs. `d3-force`.

## Phase 4 — Chat

- RAG over the same retrieval; streaming chat via OpenAI-compatible local
  endpoints (Ollama, LM Studio). Provider interface for future cloud
  providers (OpenAI, Anthropic, OpenRouter) — opt-in only.

## Release checklist (when ready)

- Bump `manifest.json` version + `versions.json` (`npm run version`).
- GitHub release, tag = version (no leading `v`), attach `main.js`,
  `manifest.json`, `styles.css`.
- README with privacy disclosure (model download, local processing).
