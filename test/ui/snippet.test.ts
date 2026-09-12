import { describe, it, expect } from 'vitest';
import { formatSectionSnippet, getSectionDisplay } from '../../src/ui/snippet';

describe('formatSectionSnippet', () => {
	it('returns short text as-is', () => {
		expect(formatSectionSnippet('Short text')).toBe('Short text');
	});

	it('truncates text longer than 80 chars at word boundary with ellipsis', () => {
		const text =
			'This is a fairly long sentence designed to test whether snippet truncation cuts neatly at a word boundary instead of mid-word.';
		const snippet = formatSectionSnippet(text, 80);
		expect(snippet.endsWith('…')).toBe(true);
		// Without the ellipsis, length <= 80
		const withoutEllipsis = snippet.slice(0, -1);
		expect(withoutEllipsis.length).toBeLessThanOrEqual(80);
		// Should not end with a partial word split in 'whether' or 'snippet'
		expect(withoutEllipsis).toBe(
			'This is a fairly long sentence designed to test whether snippet truncation cuts',
		);
	});

	it('handles text with no space before maxLength gracefully', () => {
		const longWord = 'A'.repeat(100);
		const snippet = formatSectionSnippet(longWord, 80);
		expect(snippet).toBe('A'.repeat(80) + '…');
	});

	it('handles empty or whitespace-only text', () => {
		expect(formatSectionSnippet('')).toBe('');
		expect(formatSectionSnippet('   ')).toBe('');
	});

	it('collapses newlines and multiple spaces into single spaces', () => {
		const multiline = 'Line one\n\nLine two    with spaces';
		expect(formatSectionSnippet(multiline)).toBe('Line one Line two with spaces');
	});
});

describe('getSectionDisplay', () => {
	it('returns the deepest heading when headingPath has more than one element', () => {
		const result = getSectionDisplay({
			headingPath: ['Document Title', 'Section A', 'Subsection B'],
			text: 'Some body text for subsection B...',
		});
		expect(result).toEqual({
			label: 'Subsection B',
			isHeading: true,
		});
	});

	it('does not truncate heading string because CSS handles visual truncation', () => {
		const longHeading =
			'A very long section heading that exceeds eighty characters and should not be truncated by code';
		const result = getSectionDisplay({
			headingPath: ['Document Title', longHeading],
			text: 'Some body text...',
		});
		expect(result.label).toBe(longHeading);
		expect(result.isHeading).toBe(true);
	});

	it('returns snippet when headingPath is empty or has only root note title', () => {
		const result1 = getSectionDisplay({
			headingPath: ['Document Title'],
			text: 'Paragraph text without heading.',
		});
		expect(result1).toEqual({
			label: 'Paragraph text without heading.',
			isHeading: false,
		});

		const result2 = getSectionDisplay({
			headingPath: [],
			text: 'Another untitled chunk text.',
		});
		expect(result2).toEqual({
			label: 'Another untitled chunk text.',
			isHeading: false,
		});
	});

	it('returns empty label when text and heading are missing', () => {
		const result = getSectionDisplay({});
		expect(result).toEqual({
			label: '',
			isHeading: false,
		});
	});

	it('strips redundant note title prefix from chunk text snippet', () => {
		const result = getSectionDisplay({
			headingPath: ['Interesting Papers'],
			titleContext: 'Interesting Papers',
			text: 'Interesting Papers\n distilling step-by-step! outperforming large models on benchmarks.',
		});
		expect(result).toEqual({
			label: 'Distilling step-by-step! outperforming large models on benchmarks.',
			isHeading: false,
		});
	});

	it('strips note title prefix followed by hyphen or colon', () => {
		const result = getSectionDisplay({
			headingPath: ['Notes on Memory'],
			text: 'Notes on Memory - memories trigger through similarity and emotional salience.',
		});
		expect(result).toEqual({
			label: 'Memories trigger through similarity and emotional salience.',
			isHeading: false,
		});
	});
});
