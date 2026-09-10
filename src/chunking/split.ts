/**
 * Token-bounded section splitting.
 *
 * Faithful TypeScript port of `halved_by_delimiter` and
 * `split_by_max_tokens` from accio.ai/md-parsers.py, generalized over a
 * `TokenCounter` instead of a llama.cpp model.
 */

import type { TokenCounter } from './tokens';

/** Matches the accio.ai default; nomic-embed-text-v1.5 allows 8192. */
export const MAX_TOKENS = 2048;

/** Recursion budget before falling back to truncation. */
export const MAX_RECURSION = 5;

/** Delimiters tried in order when halving oversized sections. */
const DELIMITERS = ['\n\n', '\n', '. ', ' '];

/**
 * Truncate text to at most `maxTokens` tokens. Uses binary search on the
 * character length so it works with any `TokenCounter`.
 */
export function truncateSection(
	text: string,
	counter: TokenCounter,
	maxTokens: number = MAX_TOKENS,
): string {
	if (counter.count(text) <= maxTokens) {
		return text;
	}
	let lo = 0;
	let hi = text.length;
	while (lo < hi) {
		const mid = Math.ceil((lo + hi) / 2);
		if (counter.count(text.slice(0, mid)) <= maxTokens) {
			lo = mid;
		} else {
			hi = mid - 1;
		}
	}
	return text.slice(0, lo);
}

/**
 * Split a string in two on a delimiter, trying to balance tokens on each
 * side. Returns `[text, '']` when the delimiter is not found.
 */
export function halvedByDelimiter(
	text: string,
	counter: TokenCounter,
	delimiter = '\n',
): [string, string] {
	const chunks = text.split(delimiter);
	if (chunks.length === 1) {
		return [text, '']; // no delimiter found
	}
	if (chunks.length === 2) {
		return [chunks[0] ?? '', chunks[1] ?? '']; // no halfway search needed
	}

	const totalTokens = counter.count(text);
	const halfway = Math.floor(totalTokens / 2);
	let bestDiff = halfway;
	let i = 0;
	for (i = 0; i < chunks.length; i++) {
		const left = chunks.slice(0, i + 1).join(delimiter);
		const leftTokens = counter.count(left);
		const diff = Math.abs(halfway - leftTokens);
		if (diff >= bestDiff) {
			break;
		}
		bestDiff = diff;
	}
	const left = chunks.slice(0, i).join(delimiter);
	const right = chunks.slice(i).join(delimiter);
	return [left, right];
}

/**
 * If `text` (prefixed by `titles`) exceeds `maxTokens`, split it into
 * multiple chunks such that each has fewer than `maxTokens` tokens.
 * Every returned chunk includes the titles context on its first line.
 */
export function splitByMaxTokens(
	titles: string,
	text: string,
	counter: TokenCounter,
	maxTokens: number = MAX_TOKENS,
	maxRecursion: number = MAX_RECURSION,
): string[] {
	const fullText = titles + '\n' + text;
	const numTokens = counter.count(fullText);

	if (numTokens <= maxTokens) {
		return [fullText];
	}
	if (maxRecursion === 0) {
		// No split found within the recursion budget: truncate.
		return [truncateSection(fullText, counter, maxTokens)];
	}
	for (const delimiter of DELIMITERS) {
		const [left, right] = halvedByDelimiter(text, counter, delimiter);
		if (left === '' || right === '') {
			// This delimiter did not work, try the next one.
			continue;
		}
		const results: string[] = [];
		for (const half of [left, right]) {
			results.push(
				...splitByMaxTokens(
					titles,
					half,
					counter,
					maxTokens,
					maxRecursion - 1,
				),
			);
		}
		return results;
	}

	// No split found at all; truncate. Should be a corner case.
	return [truncateSection(fullText, counter, maxTokens)];
}
