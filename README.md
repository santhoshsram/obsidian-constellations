# Obsidian Brain

A local-first "second brain" plugin for Obsidian. It indexes your notes
into semantic chunks, embeds them entirely on-device, and surfaces the
notes — and the exact sections within them — most related to whatever
you're currently viewing. Semantic graph and chat features follow in
later phases.

**Status: early development.** See [docs/roadmap.md](docs/roadmap.md)
for the plan and [docs/architecture.md](docs/architecture.md) for the
technical design.

## Privacy

- All embedding and search runs **locally** via
  [transformers.js](https://huggingface.co/docs/transformers.js) — your
  notes never leave your machine.
- The only network request is a **one-time download** of the embedding
  model ([nomic-embed-text-v1.5](https://huggingface.co/nomic-ai/nomic-embed-text-v1.5))
  from Hugging Face on first use.
- No telemetry, no analytics, no cloud services.
- The index lives in `.obsidian/plugins/obsidian-brain/` inside your
  vault; your notes are never modified.

## Development

```bash
npm install
npm run dev    # watch-mode build
npm test       # vitest suite for the chunking pipeline
npm run build  # type-check + production bundle
npm run lint
```

To test manually, build and copy `main.js`, `manifest.json`, and
`styles.css` to `<Vault>/.obsidian/plugins/obsidian-brain/`, then enable
the plugin in **Settings → Community plugins**. (Use a dedicated
development vault, not your main one.)

## Credits

The markdown chunking pipeline is a TypeScript port of the hand-rolled
parser in [accio.ai](../accio.ai), verified against the original Python
outputs in the test suite.

Based on the
[Obsidian sample plugin](https://github.com/obsidianmd/obsidian-sample-plugin).
