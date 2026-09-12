/**
 * End-to-end chunking pipeline for a single markdown note.
 *
 * Port of `process_md_file` from accio.ai/md-parsers.py: split into
 * heading sections, build a title context (filename + heading
 * breadcrumb), clean the section text, and bound chunks by tokens.
 */

import { mdCleanup } from './cleanup';
import { splitBySections } from './sections';
import { forceSplitOversizedBlock } from './split';
import { extractBlocks, groupBlocks } from './blocks';
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
	/** Starting line (0-indexed) of this chunk in the source note. */
	startLine?: number;
	/** Ending line (0-indexed) of this chunk in the source note. */
	endLine?: number;
}

/** Basename of a path without its extension (browser-safe). */
export function fileTitle(filePath: string): string {
	const base = filePath.split('/').pop() ?? filePath;
	return base.replace(/\.[^/.]+$/, '');
}

const FRONTMATTER_REGEX = /^---\r?\n([\s\S]*?)\r?\n---/;

interface ExtractedFrontmatter {
	rawFrontmatter: string;
	title?: string;
	bodyContent: string;
	endLine: number;
}

function extractFrontmatter(content: string): ExtractedFrontmatter | null {
	const match = FRONTMATTER_REGEX.exec(content);
	if (!match) {
		return null;
	}

	const raw = match[1] ?? '';
	const fullMatch = match[0];
	const bodyContent = content.slice(fullMatch.length);
	const endLine = fullMatch.split('\n').length - 1;

	let title: string | undefined;
	const titleMatch = /^[ \t]*title:[ \t]*(.*?)[ \t]*$/m.exec(raw);
	if (titleMatch) {
		let val = titleMatch[1]?.trim() ?? '';
		if (
			(val.startsWith('"') && val.endsWith('"')) ||
			(val.startsWith("'") && val.endsWith("'"))
		) {
			val = val.slice(1, -1).trim();
		}
		if (val.length > 0) {
			title = val;
		}
	}

	return {
		rawFrontmatter: raw,
		title,
		bodyContent,
		endLine,
	};
}

/**
 * Parse a markdown note into embeddable chunks.
 *
 * Sections are split on headings (levels 1–4). Within each section,
 * text is parsed into semantic blocks (paragraphs, list item trees, and
 * bold pseudo-headings) and grouped into ~250-token chunks.
 */
export function chunkMarkdown(
	filePath: string,
	content: string,
	counter: TokenCounter,
): ParsedChunk[] {
	const filename = fileTitle(filePath);
	const fm = extractFrontmatter(content);
	const rootTitle = fm?.title ?? filename;

	const chunks: ParsedChunk[] = [];

	if (fm && fm.rawFrontmatter.trim().length > 0) {
		const cleaned = mdCleanup(fm.rawFrontmatter);
		const titleContext = rootTitle;
		for (const chunkText of forceSplitOversizedBlock(
			titleContext,
			cleaned,
			counter,
		)) {
			chunks.push({
				filePath,
				headingPath: [rootTitle],
				titleContext,
				text: chunkText,
				startLine: 0,
				endLine: fm.endLine,
			});
		}
	}

	const bodyToSplit = fm ? fm.bodyContent : content;
	const sections = splitBySections(bodyToSplit);
	let searchOffset = fm ? content.indexOf(bodyToSplit) : 0;
	if (searchOffset < 0) {
		searchOffset = 0;
	}

	for (const [titles, text] of sections) {
		const textIdx = content.indexOf(text, searchOffset);
		const baseLineOffset =
			textIdx >= 0 ? content.slice(0, textIdx).split('\n').length - 1 : 0;
		if (textIdx >= 0) {
			searchOffset = textIdx + text.length;
		}

		// Filter empty breadcrumb entries (levels without a heading).
		const headingPath = titles.filter((t) => t.length > 0);
		const firstTitle = headingPath[0]?.trim().toLowerCase() ?? '';
		if (!firstTitle.startsWith(rootTitle.trim().toLowerCase())) {
			headingPath.unshift(rootTitle);
		}

		const blocks = extractBlocks(text, baseLineOffset);
		const grouped = groupBlocks(blocks, counter, 250);

		if (grouped.length === 0) {
			continue;
		}

		for (const block of grouped) {
			const blockHeadingPath = block.title
				? [...headingPath, block.title]
				: [...headingPath];
			const titleContext = blockHeadingPath.join(' ');
			const cleaned = mdCleanup(block.text);

			for (const chunkText of forceSplitOversizedBlock(
				titleContext,
				cleaned,
				counter,
			)) {
				chunks.push({
					filePath,
					headingPath: blockHeadingPath,
					titleContext,
					text: chunkText,
					startLine: block.startLine,
					endLine: block.endLine,
				});
			}
		}
	}
	return chunks;
}
