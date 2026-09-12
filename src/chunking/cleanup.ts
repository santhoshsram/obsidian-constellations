/**
 * Markdown cleanup utilities.
 *
 * Faithful TypeScript port of the regex-based cleanup functions in
 * accio.ai/md-parsers.py (`md_flatten_table`, `strip_md_markups`,
 * `strip_spaces`, `remove_empty_lines`, `md_cleanup`).
 */

// A table starts with a header row followed by a |---| separator row.
const TABLE_START = /(?:^|\n)[ \t]*\|.*\|\n[ \t]*[ -|]+\|\n/;
// A table ends at the last row followed by a non-pipe line...
const TABLE_END = /[ \t]*\|.*\|\n[ \t]*[^|]/;
// ...or at a final row at end of content (Python `$` also matches before
// a single trailing newline, hence the lookahead).
const TABLE_END_EOF = /[ \t]*\|.*\|(?=\n?$)/;

/**
 * Flatten pipe tables in the content: drop the header and separator rows
 * and turn each body row into a space-joined line, so table content
 * survives as plain text for embedding. Recurses to handle multiple
 * tables. If a table start is found but no end, the content is returned
 * unchanged (mirrors the Python original).
 */
export function flattenTable(content: string): string {
	const start = TABLE_START.exec(content);
	if (!start) {
		return content;
	}

	const tail = content.slice(start.index);
	let end = TABLE_END.exec(tail);
	if (!end) {
		end = TABLE_END_EOF.exec(tail);
	}
	if (!end) {
		// Tricky case: table beginning but no end. Leave content as-is.
		return content;
	}

	const endIndex = start.index + end.index;
	const tableContent = content.slice(start.index, endIndex + end[0].length);
	const rowsStr =
		'\n' +
		tableContent
			.split('\n')
			.filter((row) => row.length > 0)
			.slice(2) // drop header and separator rows
			.map((row) => row.split('|').join(' ').trim())
			.join('\n\n') +
		'\n';

	return (
		content.slice(0, start.index + 1) +
		rowsStr +
		flattenTable(content.slice(endIndex + end[0].length))
	);
}

/** Strip markdown markups, keeping the textual content. */
export function stripMdMarkups(text: string): string {
	// heading markups
	text = text.replace(/^#+\s+(.*)$/gm, '$1');
	// bold or italics that use *
	text = text.replace(/\*+(.*?)\*+/g, '$1');
	// bold or italics that use _
	text = text.replace(/_+(.*?)_+/g, '$1');
	// highlights like ==highlighted text==
	text = text.replace(/=+(.*?)=+/g, '$1');
	// block quotes
	text = text.replace(/^\s*>+(.*)$/gm, '$1');
	// bullets (both ordered and unordered)
	text = text.replace(/^\s*(\d+\.|-+) +/gm, '');
	// embeds and links: [text](url) -> "text url"
	text = text.replace(/!*\[(.*?)\]\((.*?)\)/g, '$1 $2');
	return text;
}

/** Remove leading and trailing spaces/tabs on each line. */
export function stripSpaces(text: string): string {
	return text.replace(/^[ \t]+|[ \t]+$/gm, '');
}

/** Collapse runs of empty lines. */
export function removeEmptyLines(text: string): string {
	return text.replace(/^\n+/gm, '');
}

/**
 * Clean up section text for embedding: flatten tables, strip markdown
 * markups, normalize whitespace, drop empty lines, lowercase.
 */
export function mdCleanup(text: string): string {
	text = flattenTable(text);
	text = stripMdMarkups(text);
	text = stripSpaces(text);
	text = removeEmptyLines(text);
	return text.toLowerCase();
}
