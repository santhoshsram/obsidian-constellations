import { describe, it, expect } from 'vitest';
import {
	MIN_SECTION_LEN,
	MAX_HEADING_LEVEL,
	getHeadings,
	keepSection,
	splitBySections,
} from '../../src/chunking/sections';

const NESTED =
	'preamble text that is long enough to keep as a section yes indeed it is\n' +
	'\n' +
	'# H1 One\n' +
	'body of h1 one which is also long enough to keep around\n' +
	'\n' +
	'## H2 Sub\n' +
	'body of h2 sub which is long enough to keep as well\n' +
	'\n' +
	'### H3 Deep\n' +
	'body of h3 deep which is long enough to keep as well too\n' +
	'\n' +
	'#### H4 Deepest\n' +
	'body of h4 deepest which is long enough to keep as well too\n' +
	'\n' +
	'##### H5 NotSplit\n' +
	'body of h5 which stays inside the h4 section content\n' +
	'\n' +
	'# H1 Two\n' +
	'short\n' +
	'\n' +
	'# H1 Three\n' +
	'body of h1 three which is long enough to be kept around';

describe('splitBySections', () => {
	it('splits into sections down to h4 with heading breadcrumbs', () => {
		const sections = splitBySections(NESTED);

		// Breadcrumbs with empty entries (levels without a heading)
		// filtered, for readability of the assertions.
		const breadcrumbs = sections.map(([titles]) =>
			titles.filter((t) => t.length > 0),
		);
		expect(breadcrumbs).toEqual([
			[], // preamble
			['H1 One'],
			['H1 One', 'H2 Sub'],
			['H1 One', 'H2 Sub', 'H3 Deep'],
			['H1 One', 'H2 Sub', 'H3 Deep', 'H4 Deepest'],
			['H1 Three'],
		]);
	});

	it('keeps the preamble as a section with an empty breadcrumb', () => {
		const sections = splitBySections(NESTED);
		const preamble = sections[0];
		expect(preamble).toBeDefined();
		expect(preamble?.[0].every((t) => t === '')).toBe(true);
		expect(preamble?.[1]).toContain('preamble text');
	});

	it('drops sections shorter than MIN_SECTION_LEN', () => {
		const sections = splitBySections(NESTED);
		const all = sections.flatMap(([titles]) => titles);
		expect(all).not.toContain('H1 Two'); // body was "short"
	});

	it('does not split beyond MAX_HEADING_LEVEL', () => {
		expect(MAX_HEADING_LEVEL).toBe(4);
		const sections = splitBySections(NESTED);
		const h4 = sections.find(([titles]) => titles.includes('H4 Deepest'));
		expect(h4).toBeDefined();
		expect(h4?.[1]).toContain('##### H5 NotSplit');
		expect(h4?.[1]).toContain('body of h5');
	});

	it('returns empty for levels above the max', () => {
		expect(splitBySections(NESTED, MAX_HEADING_LEVEL + 1)).toEqual([]);
	});

	it('keeps section content verbatim (uncleaned)', () => {
		const sections = splitBySections(NESTED);
		const h1 = sections.find(
			([titles]) =>
				titles[0] === 'H1 One' && titles.every((t, i) => i === 0 || t === ''),
		);
		expect(h1?.[1]).toContain('body of h1 one');
	});
});

describe('getHeadings', () => {
	it('extracts headings of a given level without prefix', () => {
		expect(getHeadings(NESTED, 1)).toEqual(['H1 One', 'H1 Two', 'H1 Three']);
		expect(getHeadings(NESTED, 4)).toEqual(['H4 Deepest']);
	});

	it('can keep the heading prefix', () => {
		expect(getHeadings(NESTED, 1, false)).toEqual([
			'# H1 One',
			'# H1 Two',
			'# H1 Three',
		]);
	});

	it('returns empty for unsupported levels', () => {
		expect(getHeadings(NESTED, 5)).toEqual([]);
	});
});

describe('keepSection', () => {
	it('drops content shorter than the minimum length', () => {
		expect(keepSection('x'.repeat(MIN_SECTION_LEN - 1))).toBe(false);
		expect(keepSection('x'.repeat(MIN_SECTION_LEN))).toBe(true);
	});
});
