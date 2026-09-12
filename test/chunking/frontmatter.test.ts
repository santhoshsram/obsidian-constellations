import { describe, it, expect } from 'vitest';
import { chunkMarkdown } from '../../src/chunking/chunker';
import { HeuristicTokenCounter } from '../../src/chunking/tokens';

const counter = new HeuristicTokenCounter();

function long(text: string): string {
	return text.padEnd(60, '.');
}

describe('YAML front matter extraction', () => {
	it('extracts front matter as its own chunk and uses title as root headingPath', () => {
		const content =
			'---\n' +
			'title: Custom Note Title\n' +
			'tags:\n' +
			'  - obsidian\n' +
			'  - brain\n' +
			'---\n' +
			'# Overview\n' +
			`${long('This is the overview section content.')}\n\n` +
			'# Details\n' +
			`${long('This is the details section content.')}`;

		const chunks = chunkMarkdown('my-file.md', content, counter);
		expect(chunks.length).toBe(3);

		// Chunk 0: Front matter
		expect(chunks[0]?.headingPath).toEqual(['Custom Note Title']);
		expect(chunks[0]?.titleContext).toBe('Custom Note Title');
		expect(chunks[0]?.text).toContain('custom note title');
		expect(chunks[0]?.text).toContain('obsidian');
		expect(chunks[0]?.startLine).toBe(0);
		expect(chunks[0]?.endLine).toBe(5);

		// Chunk 1: Overview section with Custom Note Title as root
		expect(chunks[1]?.headingPath).toEqual(['Custom Note Title', 'Overview']);
		expect(chunks[1]?.titleContext).toBe('Custom Note Title Overview');
		expect(chunks[1]?.text).toContain('this is the overview section content');
		expect(chunks[1]?.startLine).toBe(7);

		// Chunk 2: Details section
		expect(chunks[2]?.headingPath).toEqual(['Custom Note Title', 'Details']);
		expect(chunks[2]?.titleContext).toBe('Custom Note Title Details');
		expect(chunks[2]?.text).toContain('this is the details section content');
	});

	it('unquotes quoted title in front matter', () => {
		const contentDouble =
			'---\n' +
			'title: "Double Quoted Title"\n' +
			'---\n' +
			'# Section\n' +
			`${long('Section body content here.')}`;

		const chunksDouble = chunkMarkdown('file.md', contentDouble, counter);
		expect(chunksDouble[0]?.headingPath).toEqual(['Double Quoted Title']);
		expect(chunksDouble[1]?.headingPath).toEqual(['Double Quoted Title', 'Section']);

		const contentSingle =
			'---\n' +
			"title: 'Single Quoted Title'\n" +
			'---\n' +
			'# Section\n' +
			`${long('Section body content here.')}`;

		const chunksSingle = chunkMarkdown('file.md', contentSingle, counter);
		expect(chunksSingle[0]?.headingPath).toEqual(['Single Quoted Title']);
		expect(chunksSingle[1]?.headingPath).toEqual(['Single Quoted Title', 'Section']);
	});

	it('falls back to filename when front matter has no title', () => {
		const content =
			'---\n' +
			'author: Jane Doe\n' +
			'category: Research\n' +
			'---\n' +
			'# Findings\n' +
			`${long('Findings body content here.')}`;

		const chunks = chunkMarkdown('Research-Note.md', content, counter);
		expect(chunks.length).toBe(2);

		// Front matter uses filename
		expect(chunks[0]?.headingPath).toEqual(['Research-Note']);
		expect(chunks[0]?.titleContext).toBe('Research-Note');
		expect(chunks[0]?.text).toContain('jane doe');

		// Subsequent section uses filename
		expect(chunks[1]?.headingPath).toEqual(['Research-Note', 'Findings']);
	});

	it('does not duplicate title if first heading matches front matter title', () => {
		const content =
			'---\n' +
			'title: Matching Title\n' +
			'---\n' +
			'# Matching Title\n' +
			`${long('Content under matching title heading.')}`;

		const chunks = chunkMarkdown('file.md', content, counter);
		expect(chunks.length).toBe(2);
		expect(chunks[0]?.headingPath).toEqual(['Matching Title']);
		expect(chunks[1]?.headingPath).toEqual(['Matching Title']);
	});

	it('does not treat horizontal rules in body as front matter', () => {
		const content =
			'# Intro\n' +
			`${long('Some introductory text here.')}\n\n` +
			'---\n\n' +
			'# After HR\n' +
			`${long('Content after the horizontal rule.')}`;

		const chunks = chunkMarkdown('MyNote.md', content, counter);
		expect(chunks.length).toBe(2);
		expect(chunks[0]?.headingPath).toEqual(['MyNote', 'Intro']);
		expect(chunks[1]?.headingPath).toEqual(['MyNote', 'After HR']);
	});

	it('ignores empty front matter', () => {
		const content =
			'---\n' +
			'---\n' +
			'# Heading\n' +
			`${long('Content with empty front matter.')}`;

		const chunks = chunkMarkdown('MyNote.md', content, counter);
		expect(chunks.length).toBe(1);
		expect(chunks[0]?.headingPath).toEqual(['MyNote', 'Heading']);
	});
});
