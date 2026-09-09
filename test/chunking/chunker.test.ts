import { describe, it, expect } from 'vitest';
import { chunkMarkdown, fileTitle } from '../../src/chunking/chunker';
import { HeuristicTokenCounter } from '../../src/chunking/tokens';

const counter = new HeuristicTokenCounter();

/** Pad a string to at least MIN_SECTION_LEN (50) characters. */
function long(text: string): string {
	return text.padEnd(60, '.');
}

describe('fileTitle', () => {
	it('returns the basename without extension', () => {
		expect(fileTitle('folder/sub/My Note.md')).toBe('My Note');
		expect(fileTitle('My Note.md')).toBe('My Note');
	});
});

describe('chunkMarkdown', () => {
	it('does not duplicate the filename when the first heading matches it', () => {
		const content = `# My Note\n${long('Body text of the note')}`;
		const chunks = chunkMarkdown('My Note.md', content, counter);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.headingPath).toEqual(['My Note']);
		expect(chunks[0]?.titleContext).toBe('My Note');
	});

	it('prepends the filename when the first heading differs', () => {
		const content = `# Different Title\n${long('Body text of the note')}`;
		const chunks = chunkMarkdown('My Note.md', content, counter);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.headingPath).toEqual(['My Note', 'Different Title']);
		expect(chunks[0]?.titleContext).toBe('My Note Different Title');
	});

	it('uses the filename alone for notes without headings', () => {
		const chunks = chunkMarkdown(
			'Plain.md',
			long('Just a long paragraph without any headings'),
			counter,
		);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.headingPath).toEqual(['Plain']);
	});

	it('drops sections that are too short', () => {
		const content = `# Kept\n${long('long body')}\n\n# Dropped\nshort`;
		const chunks = chunkMarkdown('Note.md', content, counter);
		expect(chunks).toHaveLength(1);
		expect(chunks[0]?.headingPath).toEqual(['Note', 'Kept']);
	});

	it('cleans section text but keeps title context case', () => {
		const content = `# My Note\n${long('Some **BOLD** Text HERE')}`;
		const chunks = chunkMarkdown('My Note.md', content, counter);
		const text = chunks[0]?.text ?? '';
		expect(text.startsWith('My Note\n')).toBe(true);
		expect(text).toContain('some bold text here');
		expect(text).not.toContain('**');
	});

	it('carries the heading breadcrumb into every chunk', () => {
		const content =
			`# Top\n${long('top body')}\n\n` +
			`## Sub\n${long('sub body')}`;
		const chunks = chunkMarkdown('Note.md', content, counter);
		expect(chunks).toHaveLength(2);
		expect(chunks[0]?.headingPath).toEqual(['Note', 'Top']);
		expect(chunks[1]?.headingPath).toEqual(['Note', 'Top', 'Sub']);
		expect(chunks[1]?.text.startsWith('Note Top Sub\n')).toBe(true);
	});

	it('records the file path on every chunk', () => {
		const chunks = chunkMarkdown(
			'folder/Note.md',
			long('body without headings'),
			counter,
		);
		expect(chunks[0]?.filePath).toBe('folder/Note.md');
	});
});
