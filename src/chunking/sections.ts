/**
 * Heading-based markdown section splitting.
 *
 * Faithful TypeScript port of `md_get_headings`, `keep_section` and
 * `md_split_by_sections` from accio.ai/md-parsers.py, extended from 3 to
 * 4 heading levels.
 */

/** Sections whose (trimmed) content is shorter than this are dropped. */
export const MIN_SECTION_LEN = 50;

/** Deepest heading level we split on (h4). */
export const MAX_HEADING_LEVEL = 4;

/** Split patterns per heading level, with the heading text captured. */
const HEADING_PATTERNS: Record<number, RegExp> = {
	1: /^# (.*)$/m,
	2: /^## (.*)$/m,
	3: /^### (.*)$/m,
	4: /^#### (.*)$/m,
};

/**
 * Return the headings of the given level. When `stripPrefix` is true the
 * `#` prefix is removed, otherwise the full heading line is returned.
 */
export function getHeadings(
	text: string,
	level: number,
	stripPrefix = true,
): string[] {
	const pattern = HEADING_PATTERNS[level];
	if (!pattern) {
		return [];
	}
	const global = new RegExp(pattern.source, 'gm');
	const headings: string[] = [];
	for (const match of text.matchAll(global)) {
		const heading = stripPrefix ? match[1] : match[0];
		if (heading !== undefined) {
			headings.push(heading);
		}
	}
	return headings;
}

/** Keep a section only if its content meets the minimum length. */
export function keepSection(text: string): boolean {
	return text.length >= MIN_SECTION_LEN;
}

/**
 * Split markdown text into sections based on headings, recursing down to
 * MAX_HEADING_LEVEL.
 *
 * Returns a list of `[headingBreadcrumb, content]` tuples. The breadcrumb
 * holds the chain of parent headings (e.g. `["H1", "H2", "H3"]`). Levels
 * without a heading contribute an empty-string entry, mirroring the
 * Python original; callers building display strings should filter empties.
 */
export function splitBySections(
	text: string,
	headingLevel = 1,
): Array<[string[], string]> {
	if (headingLevel > MAX_HEADING_LEVEL) {
		return [];
	}

	const pattern = HEADING_PATTERNS[headingLevel];
	if (!pattern) {
		return [];
	}

	// Split with a capture group: [pre, title1, content1, title2, ...]
	const sections = text.split(pattern);
	// The piece above the first heading has no heading of its own.
	sections.unshift('');

	const results: Array<[string[], string]> = [];
	for (let i = 0; i + 1 < sections.length; i += 2) {
		const title = sections[i] ?? '';
		const content = sections[i + 1] ?? '';
		// Drop sections that are too small.
		if (!keepSection(content.trim())) {
			continue;
		}
		const subsections = splitBySections(content, headingLevel + 1);
		if (subsections.length === 0) {
			results.push([[title.trim()], content]);
		} else {
			for (const [subtitles, subcontent] of subsections) {
				results.push([[title.trim(), ...subtitles], subcontent]);
			}
		}
	}
	return results;
}
