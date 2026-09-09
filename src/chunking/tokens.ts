/**
 * Token counting abstraction.
 *
 * Phase 1 wires up a `TokenCounter` backed by the embedding model's own
 * tokenizer (via transformers.js). Until then, and for unit tests, a
 * heuristic counter keeps the chunking pipeline fully functional.
 */

export interface TokenCounter {
	count(text: string): number;
}

/**
 * Rough heuristic of ~4 characters per token. Good enough for tests and
 * for chunking before the model tokenizer has loaded; not a substitute
 * for the real tokenizer when enforcing a model's context limit.
 */
export class HeuristicTokenCounter implements TokenCounter {
	count(text: string): number {
		return Math.ceil(text.length / 4);
	}
}
