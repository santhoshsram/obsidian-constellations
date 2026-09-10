import { describe, it, expect } from 'vitest';
import {
	isPseudoHeading,
	extractBlocks,
	groupBlocks,
	type ContentBlock,
} from '../../src/chunking/blocks';
import { HeuristicTokenCounter } from '../../src/chunking/tokens';
import { chunkMarkdown } from '../../src/chunking/chunker';

const counter = new HeuristicTokenCounter();

describe('isPseudoHeading', () => {
	it('detects standalone bold line as pseudo-heading', () => {
		expect(isPseudoHeading('**Avoid Busy Work**')).toBe('Avoid Busy Work');
		expect(isPseudoHeading('__Avoid Busy Work__')).toBe('Avoid Busy Work');
		expect(isPseudoHeading('  **Avoid Busy Work**  ')).toBe('Avoid Busy Work');
	});

	it('rejects inline bold with trailing prose', () => {
		expect(
			isPseudoHeading(
				'*Absorb:* this is a new para with some text. there is bold but not as title style',
			),
		).toBeNull();
		expect(
			isPseudoHeading(
				'**Absorb:** this is a new para with some text. there is bold but not as title style',
			),
		).toBeNull();
	});

	it('rejects sentences wrapped in bold', () => {
		expect(
			isPseudoHeading(
				'**This is a very long sentence in bold that explains an entire concept and ends with a period.**',
			),
		).toBeNull();
	});

	it('rejects normal text or markdown headings', () => {
		expect(isPseudoHeading('Normal text')).toBeNull();
		expect(isPseudoHeading('# Heading')).toBeNull();
		expect(isPseudoHeading('- List item')).toBeNull();
	});
});

describe('extractBlocks', () => {
	it('extracts top-level list items with indented children as single blocks', () => {
		const text = [
			'- First idea',
			'  - detail a',
			'  - detail b',
			'- Second idea',
			'  - detail c',
		].join('\n');

		const blocks = extractBlocks(text);
		expect(blocks).toHaveLength(2);
		expect(blocks[0]?.text).toBe('- First idea\n  - detail a\n  - detail b');
		expect(blocks[0]?.startLine).toBe(0);
		expect(blocks[0]?.endLine).toBe(2);

		expect(blocks[1]?.text).toBe('- Second idea\n  - detail c');
		expect(blocks[1]?.startLine).toBe(3);
		expect(blocks[1]?.endLine).toBe(4);
	});

	it('extracts pseudo-heading blocks with titles', () => {
		const text = [
			'**Avoid Busy Work**',
			'Sometimes it is unavoidable to be doing busy work.',
			'',
			'**Business Urgency**',
			'Time is the biggest enemy.',
		].join('\n');

		const blocks = extractBlocks(text);
		expect(blocks).toHaveLength(2);
		expect(blocks[0]?.title).toBe('Avoid Busy Work');
		expect(blocks[0]?.text).toContain('Sometimes it is unavoidable');
		expect(blocks[0]?.startLine).toBe(0);
		expect(blocks[0]?.endLine).toBe(1);

		expect(blocks[1]?.title).toBe('Business Urgency');
		expect(blocks[1]?.text).toContain('Time is the biggest enemy.');
		expect(blocks[1]?.startLine).toBe(3);
		expect(blocks[1]?.endLine).toBe(4);
	});

	it('extracts standard prose paragraphs separated by blank lines', () => {
		const text = [
			'Paragraph one has several words.',
			'',
			'Paragraph two is separated by a blank line.',
		].join('\n');

		const blocks = extractBlocks(text);
		expect(blocks).toHaveLength(2);
		expect(blocks[0]?.text).toBe('Paragraph one has several words.');
		expect(blocks[0]?.startLine).toBe(0);
		expect(blocks[0]?.endLine).toBe(0);

		expect(blocks[1]?.text).toBe(
			'Paragraph two is separated by a blank line.',
		);
		expect(blocks[1]?.startLine).toBe(2);
		expect(blocks[1]?.endLine).toBe(2);
	});
});

describe('groupBlocks', () => {
	it('groups small adjacent blocks up to target token size', () => {
		const blocks: ContentBlock[] = [
			{ text: 'Small point one.', startLine: 0, endLine: 0 },
			{ text: 'Small point two.', startLine: 1, endLine: 1 },
			{ text: 'Small point three.', startLine: 2, endLine: 2 },
		];

		// Each is ~4 tokens, target 200 tokens -> should merge into 1 chunk
		const grouped = groupBlocks(blocks, counter, 200);
		expect(grouped).toHaveLength(1);
		expect(grouped[0]?.startLine).toBe(0);
		expect(grouped[0]?.endLine).toBe(2);
		expect(grouped[0]?.text).toContain('Small point one.');
		expect(grouped[0]?.text).toContain('Small point three.');
	});

	it('keeps blocks with pseudo-headings separate', () => {
		const blocks: ContentBlock[] = [
			{
				title: 'Heading A',
				text: 'Text for section A.',
				startLine: 0,
				endLine: 1,
			},
			{
				title: 'Heading B',
				text: 'Text for section B.',
				startLine: 2,
				endLine: 3,
			},
		];

		const grouped = groupBlocks(blocks, counter, 200);
		expect(grouped).toHaveLength(2);
		expect(grouped[0]?.title).toBe('Heading A');
		expect(grouped[1]?.title).toBe('Heading B');
	});
});

describe('chunkMarkdown with Block / Paragraph Chunking', () => {
	it('splits heading-less multi-bullet notes into multiple chunks', () => {
		const bullets = [
			'- Project management tool for architects - Gatherit.co is a SaaS tool for interior design teams to manage their projects in India and US.',
			'- travel buddy finder : Publish destination and date of travel, and request one-to-one meeting with people living there, to learn more about the place and the culture.',
			'- aws + k8s debugger\n  - my current painpoint - constantly keep executing aws and k8s commands to figure out what is broken\n  - automatically execute get command and log commands to figure out what went wrong without asking permissions\n  - as permission only when doing write ops.\n  - create a plan to fix',
			'- Lovable to prodable\n  - expand on cursor for ops / workflow creation tool. focus on security, cost, performance and compliance\n  - problem: ballooning / exorbitant cost in netlify and vercel\n  - deploy on some well known cloud or provider like vultr/hetzner',
			'- NutriBuster\n  - Take photos of food\n  - Show nutritional content\n  - compare with daily allowed values\n  - Busy some common myths',
			'- AgentHub - a dockerhub style repo for sharing full agents that can be easily pulled and run on multiple agent run times - like mastra, openclaw, nemoclaw, paperlip.ai, etc.',
		].join('\n\n');

		const chunks = chunkMarkdown('Ideas Braindump.md', bullets, counter);
		// Instead of 1 monolithic chunk, it should produce multiple chunks
		expect(chunks.length).toBeGreaterThan(1);
		expect(chunks.every((c) => c.startLine !== undefined && c.endLine !== undefined)).toBe(true);
	});

	it('splits pseudo-headed notes into attributed chunks', () => {
		const content = [
			'# PM Advice / Tips',
			'',
			'**Avoid Busy Work**',
			'',
			'Sometimes it is unavoidable to be doing busy work. But think in terms of outcomes, and work backwards from there.',
			'',
			'**Absorb, Synthesize and Prioritize**',
			'',
			'Work out a process that works for you. It can be excel, Aha, jira, word docs.',
			'',
			'**Business Urgency**',
			'',
			'Time is the biggest enemy. As a PM, you need to be crystal focused on business value.',
		].join('\n');

		const chunks = chunkMarkdown('PM Advice - Tips.md', content, counter);
		expect(chunks.length).toBeGreaterThanOrEqual(3);
		const headings = chunks.map((c) => c.headingPath[c.headingPath.length - 1]);
		expect(headings).toContain('Avoid Busy Work');
		expect(headings).toContain('Business Urgency');
	});

	it('chunks real Ideas Braindump into multiple distinct chunks with line numbers', async () => {
		const fs = await import('fs');
		const vaultPath =
			'/Users/santhosh/Library/Mobile Documents/iCloud~md~obsidian/Documents/obsidian-brain-test/Projects/Product Plans & Research/Ideas Braindump.md';
		if (fs.existsSync(vaultPath)) {
			const content = fs.readFileSync(vaultPath, 'utf8');
			const chunks = chunkMarkdown(
				'Projects/Product Plans & Research/Ideas Braindump.md',
				content,
				counter,
			);
			// 7,800 chars / ~1,256 tokens -> grouped into ~6-10 chunks of 150-250 tokens
			expect(chunks.length).toBeGreaterThanOrEqual(6);
			expect(
				chunks.every(
					(c) =>
						typeof c.startLine === 'number' &&
						typeof c.endLine === 'number' &&
						c.endLine >= c.startLine,
				),
			).toBe(true);
		}
	});

	it('chunks real PM Advice - Tips into exactly 5 pseudo-headed chunks', async () => {
		const fs = await import('fs');
		const vaultPath =
			'/Users/santhosh/Library/Mobile Documents/iCloud~md~obsidian/Documents/obsidian-brain-test/Information/Product Management/PM Advice - Tips.md';
		if (fs.existsSync(vaultPath)) {
			const content = fs.readFileSync(vaultPath, 'utf8');
			const chunks = chunkMarkdown(
				'Information/Product Management/PM Advice - Tips.md',
				content,
				counter,
			);
			expect(chunks.length).toBe(5);
			const headings = chunks.map((c) => c.headingPath[c.headingPath.length - 1]);
			expect(headings).toContain('Avoid Busy Work');
			expect(headings).toContain('Absorb, Synthesize and Prioritize');
			expect(headings).toContain('Communicate Out');
			expect(headings).toContain("Don't Confuse Activity with Progress");
			expect(headings).toContain('Business Urgency');
		}
	});
});
