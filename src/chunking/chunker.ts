/**
 * End-to-end chunking pipeline for a single markdown note.
 *
 * Port of `process_md_file` from accio.ai/md-parsers.py: split into
 * heading sections, build a title context (filename + heading
 * breadcrumb), clean the section text, and bound chunks by tokens.
 */

import { mdCleanup } from './cleanup';
import { splitBySections } from './sections';
import { splitByMaxTokens, MAX_TOKENS } from './split';
import type { TokenCounter } from './tokens';

/** One embeddable chunk of a note. */
export interface ParsedChunk {
	/** Vault-relative path of the source note. */
	filePath: string;
	/**
	 * Heading breadcrumb for this chunk. Starts with the filename unless
	 * the note's first heading already matches it. Empty entries (levels
	 * without a heading) are filtered out.
	 */
	headingPath: string[];
	/** `headingPath` joined for embedding/display. */
	titleContext: string;
	/** Cleaned chunk text: `titleContext` + '\n' + cleaned section text. */
	text: string;
}

/** Basename of a path without its extension (browser-safe). */
export function fileTitle(filePath: string): string {
	const base = filePath.split('/').pop() ?? filePath;
	return base.replace(/\.[^/.]+$/, '');
}

/**
 * Parse a markdown note into embeddable chunks.
 *
 * Mirrors `process_md_file`: sections are split on headings (levels 1–4),
 * the filename is prepended to the title context unless the first heading
 * already starts with it, section text is cleaned, and oversized sections
 * are split to fit `maxTokens`.
 */
export function chunkMarkdown(
	filePath: string,
	content: string,
	counter: TokenCounter,
	maxTokens: number = MAX_TOKENS,
): ParsedChunk[] {
	const sections = splitBySections(content);
	const filename = fileTitle(filePath);

	const chunks: ParsedChunk[] = [];
	for (const [titles, text] of sections) {
		// Filter empty breadcrumb entries (levels without a heading).
		const headingPath = titles.filter((t) => t.length > 0);
		const firstTitle = headingPath[0]?.trim().toLowerCase() ?? '';
		if (!firstTitle.startsWith(filename.trim().toLowerCase())) {
			// Handle the case where the filename and the first heading
			// are the same: don't duplicate it in the context.
			headingPath.unshift(filename);
		}
		const titleContext = headingPath.join(' ');

		for (const chunkText of splitByMaxTokens(
			titleContext,
			mdCleanup(text),
			counter,
			maxTokens,
		)) {
			chunks.push({
				filePath,
				headingPath,
				titleContext,
				text: chunkText,
			});
		}
	}
	return chunks;
}
