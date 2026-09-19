# Proxima

Proxima surfaces notes that are semantically similar to the note you're currently viewing, and lets you search for notes based on semantic meaning rather than exact words.

> **Why "Proxima"?**
> Proxima means "nearest." It finds the notes conceptually nearest to the one you're reading, not just the ones sharing the same words.

## Screenshots

### Interactive Proxima Graph
The interactive graph showing related concepts orbiting your current note.

![Proxima Graph](assets/graph.png)

### Related Notes Sidebar
Surfaces semantically relevant notes and exact matching passages in real time as you write.

![Related Notes Sidebar](assets/related.png)

### Proxima Graph in Sidebar
Dock the Proxima graph in the sidebar to keep semantic context visible while exploring notes.

![Graph in Sidebar](assets/sidebar.png)

### Plugin Settings
Select your local embedding model, view reranker status, and choose your semantic matching mode.

![Plugin Settings - Models and Matching](assets/settings-1.png)

Fine-tune similarity thresholds, result limits, and tab behaviors.

![Plugin Settings - Retrieval Tuning](assets/settings-2.png)

## Highlights

- **Related Notes View:** Surfaces semantically relevant notes and exact matching passages in real time as you write.
- **Proxima Graph:** An interactive graph with physics-based semantic distance, optimistic centering, and hover sneak-peeks.
- **Two-Stage Funnel:** Dense vector retrieval refined by an on-device cross-encoder reranker for high precision.
- **100% Local & Private:** Runs entirely on-device via WebGPU/WASM. Zero telemetry, no cloud APIs, no external subscriptions.

## Privacy

- All embedding computation, vector search, and reranking run **locally** on your GPU/CPU.
- The only network access is a **one-time download** of model weights from Hugging Face on first activation (cached locally in your browser/vault cache).
- Vault notes are never transmitted or modified. The index is stored strictly in `.obsidian/plugins/proxima/`.

## Desktop only

Proxima requires WebGPU (with a WASM fallback) for on-device inference, which Obsidian only exposes in its desktop Electron shell, not on mobile. `isDesktopOnly` is set deliberately for this reason, not as a placeholder.

## Settings

- **Vault indexing:** Manually re-index the vault (runs automatically on startup/changes).
- **Debug logging:** Toggle detailed indexing and performance logs in the developer console.
- **Embedding model:** Choose the semantic model for vector search. `Gemma 300M` for high accuracy, or `All MiniLM L6` for faster performance on older devices. Changing models triggers a re-index.
- **Reranking model:** Shows the active cross-encoder (`MiniLM L6`). Currently cannot be changed; future enhancements may add other models.
- **Matching mode:** Choose how related notes are found (Detailed, Focused, or Broad).
- **Open related notes in new tab:** Open clicked related notes in a new tab instead of the current one.
- **Related notes:** Maximum number of related notes to show.
- **Sections per note:** Maximum number of matching sections shown per related note.
- **Minimum similarity:** Threshold for matches (higher = stricter).

## Commands

| Command | Action |
| :--- | :--- |
| `Open Proxima graph` | Opens the full-screen interactive Proxima graph |
| `Show related notes` | Toggles the related notes companion sidebar |
| `Reindex notes` | Manually triggers a re-index of new or modified vault notes |

## Development

```bash
npm install
npm test       # run vitest test suite
npm run dev    # watch-mode incremental build
npm run build  # type-check and production bundle
npm run lint   # eslint validation
```

### Manual Testing in Obsidian

1. Run `npm run build` to generate `main.js`.
2. Copy `main.js`, `manifest.json`, and `styles.css` to `<Vault>/.obsidian/plugins/proxima/`.
3. In Obsidian, go to **Settings → Community plugins** and enable **Proxima**.

## Documentation

- [Technical Architecture](docs/architecture.md) — deep dive on the chunking pipeline, index storage, and inference engine.
