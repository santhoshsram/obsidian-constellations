/**
 * Block & paragraph extraction for markdown notes.
 *
 * Extracts discrete semantic blocks (list item trees, pseudo-headed sections,
 * and prose paragraphs) and groups them up to target token sizes so notes
 * without headings don't collapse into a single monolithic chunk.
 */

import type { TokenCounter } from './tokens';

export interface ContentBlock {
	title?: string;
	text: string;
	startLine: number;
	endLine: number;
}

const MAX_HEADING_CHARS = 80;
const MAX_HEADING_WORDS = 12;

/**
 * Returns the title text if `line` is a standalone title-style bold line,
 * or null if it's normal text or inline bold (e.g. `**Note:** text`).
 */
export function isPseudoHeading(line: string): string | null {
	const trimmed = line.trim();
	if (!trimmed) {
		return null;
	}

	// Must be wrapped entirely in ** or __
	const match = /^(?:\*\*|__)(.+?)(?:\*\*|__)$/.exec(trimmed);
	if (!match) {
		return null;
	}

	const inner = match[1]?.trim() ?? '';
	if (!inner || inner.startsWith('#') || inner.startsWith('-') || inner.startsWith('*')) {
		return null;
	}

	// Bound length
	if (inner.length > MAX_HEADING_CHARS) {
		return null;
	}

	const words = inner.split(/\s+/);
	if (words.length > MAX_HEADING_WORDS) {
		return null;
	}

	// Headings do not end with sentence-terminal punctuation (like periods)
	if (inner.endsWith('.')) {
		return null;
	}

	return inner;
}

const LIST_ITEM_PATTERN = /^(\s*)(?:[-*+]|\d+\.)\s+(.*)$/;

/**
 * Split markdown text into discrete content blocks:
 * 1. Pseudo-headed blocks (`**Heading**` on its own line followed by body)
 * 2. Top-level list items (including all nested sub-items)
 * 3. Prose paragraphs (separated by blank lines)
 */
export function extractBlocks(text: string, baseLineOffset = 0): ContentBlock[] {
	const lines = text.split('\n');
	const blocks: ContentBlock[] = [];
	let i = 0;

	while (i < lines.length) {
		const line = lines[i] ?? '';

		// Skip blank lines
		if (/^\s*$/.test(line)) {
			i++;
			continue;
		}

		// 1. Check for pseudo-heading
		const pseudoTitle = isPseudoHeading(line);
		if (pseudoTitle) {
			const startLine = i + baseLineOffset;
			i++;
			// Collect subsequent body lines until next pseudo-heading or blank line / major break
			const bodyLines: string[] = [];
			while (i < lines.length) {
				const nextLine = lines[i] ?? '';
				if (/^\s*$/.test(nextLine)) {
					// Check if next non-blank line is another pseudo-heading
					let peek = i + 1;
					while (peek < lines.length && /^\s*$/.test(lines[peek] ?? '')) {
						peek++;
					}
					if (peek < lines.length && isPseudoHeading(lines[peek] ?? '')) {
						break;
					}
					// If not another pseudo-heading, keep collecting after blank line
					bodyLines.push(nextLine);
					i++;
					continue;
				}
				if (isPseudoHeading(nextLine)) {
					break;
				}
				bodyLines.push(nextLine);
				i++;
			}
			const endLine = i - 1 + baseLineOffset;
			const bodyText = bodyLines.join('\n').trim();
			blocks.push({
				title: pseudoTitle,
				text: bodyText ? `${pseudoTitle}\n${bodyText}` : pseudoTitle,
				startLine,
				endLine: Math.max(startLine, endLine),
			});
			continue;
		}

		// 2. Check for top-level list item
		const listMatch = LIST_ITEM_PATTERN.exec(line);
		if (listMatch) {
			const indent = listMatch[1]?.length ?? 0;
			const startLine = i + baseLineOffset;
			const itemLines: string[] = [line];
			i++;

			while (i < lines.length) {
				const nextLine = lines[i] ?? '';
				if (/^\s*$/.test(nextLine)) {
					// Peek ahead to see if list continues
					let peek = i + 1;
					while (peek < lines.length && /^\s*$/.test(lines[peek] ?? '')) {
						peek++;
					}
					if (peek < lines.length) {
						const peekLine = lines[peek] ?? '';
						const peekMatch = LIST_ITEM_PATTERN.exec(peekLine);
						const peekIndent = peekMatch ? (peekMatch[1]?.length ?? 0) : 0;
						if (peekMatch && peekIndent > indent) {
							// Child list item continues after blank line
							itemLines.push(nextLine);
							i++;
							continue;
						}
					}
					break;
				}

				const nextMatch = LIST_ITEM_PATTERN.exec(nextLine);
				if (nextMatch) {
					const nextIndent = nextMatch[1]?.length ?? 0;
					// If it's a child list item (greater indent), include it
					if (nextIndent > indent) {
						itemLines.push(nextLine);
						i++;
						continue;
					} else {
						// Sibling or parent list item begins
						break;
					}
				}

				// Check for indented continuation text
				if (/^(?: {2,}|\t)/.test(nextLine)) {
					itemLines.push(nextLine);
					i++;
					continue;
				}

				// Unindented text ends the list item
				break;
			}

			const endLine = i - 1 + baseLineOffset;
			blocks.push({
				text: itemLines.join('\n').trim(),
				startLine,
				endLine,
			});
			continue;
		}

		// 3. Standard prose paragraph
		const startLine = i + baseLineOffset;
		const paraLines: string[] = [line];
		i++;
		while (i < lines.length) {
			const nextLine = lines[i] ?? '';
			if (/^\s*$/.test(nextLine) || isPseudoHeading(nextLine) || LIST_ITEM_PATTERN.test(nextLine)) {
				break;
			}
			paraLines.push(nextLine);
			i++;
		}
		const endLine = i - 1 + baseLineOffset;
		blocks.push({
			text: paraLines.join('\n').trim(),
			startLine,
			endLine,
		});
	}

	return blocks;
}

export const DEFAULT_TARGET_BLOCK_TOKENS = 250;
export const DEFAULT_MIN_STANDALONE_TOKENS = 80;

/**
 * Group adjacent small blocks up to `targetTokens`.
 * Blocks with distinct `title`s or $\ge$ `DEFAULT_MIN_STANDALONE_TOKENS`
 * are kept separate.
 */
export function groupBlocks(
	blocks: ContentBlock[],
	counter: TokenCounter,
	targetTokens = DEFAULT_TARGET_BLOCK_TOKENS,
): ContentBlock[] {
	if (blocks.length === 0) {
		return [];
	}

	const grouped: ContentBlock[] = [];
	let current: ContentBlock | null = null;
	let currentTokens = 0;

	const flush = () => {
		if (current) {
			grouped.push(current);
			current = null;
			currentTokens = 0;
		}
	};

	for (const block of blocks) {
		const blockTokens = counter.count(block.text);

		// Blocks with a pseudo-heading title stay separate
		if (block.title) {
			flush();
			grouped.push(block);
			continue;
		}

		// Substantial blocks stay separate
		if (blockTokens >= DEFAULT_MIN_STANDALONE_TOKENS && !current) {
			grouped.push(block);
			continue;
		}

		if (!current) {
			current = { ...block };
			currentTokens = blockTokens;
			continue;
		}

		// Try to merge if under target
		if (currentTokens + blockTokens <= targetTokens) {
			current.text = `${current.text}\n\n${block.text}`;
			current.endLine = block.endLine;
			currentTokens += blockTokens;
		} else {
			flush();
			current = { ...block };
			currentTokens = blockTokens;
		}
	}

	flush();
	return grouped;
}
