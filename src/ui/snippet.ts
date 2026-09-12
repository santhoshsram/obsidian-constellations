/**
 * Format a snippet of text for chunk display in the related notes sidebar.
 * If text exceeds maxLength (default 80), trims to last word boundary and adds "…".
 */
export function formatSectionSnippet(text: string, maxLength = 80): string {
	const normalized = text.replace(/\s+/g, ' ').trim();
	if (!normalized) {
		return '';
	}
	if (normalized.length <= maxLength) {
		return normalized;
	}

	const slice = normalized.slice(0, maxLength);
	const lastSpace = slice.lastIndexOf(' ');
	if (lastSpace > 0) {
		return slice.slice(0, lastSpace) + '…';
	}
	return slice + '…';
}

function escapeRegex(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Determine the label and heading status for a chunk.
 * If chunk has a heading beyond the root note title (headingPath.length > 1),
 * uses the deepest heading. Otherwise, uses a truncated text snippet with redundant
 * note title prefixes stripped out.
 */
export function getSectionDisplay(chunk: {
	headingPath?: string[];
	text?: string;
	titleContext?: string;
}): { label: string; isHeading: boolean } {
	const headings = chunk.headingPath;
	if (headings && headings.length > 1) {
		return {
			label: headings[headings.length - 1] ?? '',
			isHeading: true,
		};
	}

	let bodyText = chunk.text ?? '';
	const rootTitle = headings?.[0]?.trim() || chunk.titleContext?.trim();

	if (rootTitle && bodyText) {
		const prefixRegex = new RegExp(
			`^${escapeRegex(rootTitle)}[\\s:\\-–—\\n]*`,
			'i',
		);
		const stripped = bodyText.replace(prefixRegex, '').trim();
		if (stripped) {
			bodyText = stripped.charAt(0).toUpperCase() + stripped.slice(1);
		}
	}

	return {
		label: formatSectionSnippet(bodyText),
		isHeading: false,
	};
}
