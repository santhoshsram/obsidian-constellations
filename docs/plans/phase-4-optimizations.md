# Parsing Enhancements & Indexing Profiling

This plan addresses parsing YAML front matter into embeddable chunks, and profiling the indexing process to identify and fix bottlenecks.

**Branch:** `feat/phase-4-optimizations` (off `main`)

## Proposed Changes

### 1. YAML Front Matter Extraction & Parsing
Currently, YAML front matter (the `---` block at the top of a file) is treated as part of the first section's raw text and often gets malformed or ignored during tokenization. We will explicitly extract and parse it.

#### [MODIFY] `src/chunking/chunker.ts`
- **Regex Extraction:** At the start of `chunkMarkdown`, detect if the document starts with YAML front matter using `/^---\r?\n([\s\S]*?)\r?\n---/`.
- **Title Extraction:** Extract the `title` attribute (if present) from the front matter.
- **Section Injection:** Treat the front matter as its own distinct section before the rest of the markdown sections. Its heading path will be `[filename]` (or the extracted `title`).
- **Context Enhancement:** For all subsequent sections in the note, if a `title` was found in the front matter, use that `title` as the root of the `headingPath` instead of the raw filename. This provides richer context to the embeddings.

#### [NEW] `test/chunking/frontmatter.test.ts`
- Add unit tests to ensure that YAML front matter is correctly extracted.
- Ensure that the `title` field correctly replaces the filename in the heading paths of the chunks.

### 2. Table Parser Optimization
While the parser is generally blazing fast (1-6ms), the `flattenTable` regex in `cleanup.ts` currently suffers from an $O(N^2)$ recursive loop if it encounters loose pipe characters outside of a table. 

#### [MODIFY] `src/chunking/cleanup.ts`
- Fix `TABLE_END.exec(content)` to execute starting from the found `start.index` rather than rescanning from the top of the document.

### 3. Embedding Pipeline Concurrency
The logs proved that chunking takes $\le 6$ms, while embedding takes up to 24 seconds for large files. The current bottleneck is strictly within the `embedMs` phase.

#### [MODIFY] `src/config.ts`
- **Backend Configuration:** Add a new `INDEXING_CONFIG` constant export (similar to `RETRIEVAL_CONFIG`) with `embeddingConcurrency: 4`. 

#### [MODIFY] `src/index/indexing-service.ts`
- **Concurrent Batching:** Import `INDEXING_CONFIG` from `src/config.ts`. Update `embedWithHeartbeat` to run batches concurrently using `Promise.all` combined with a chunking logic bounded by `INDEXING_CONFIG.embeddingConcurrency`.

## Verification Plan
1. Run existing unit tests (must remain green).
2. Add unit tests for the YAML front matter parser.
3. Perform a manual reindex of the vault and verify the front matter sections are present in `chunks.json`.
4. Review the logs to identify the slowest files and report back.
