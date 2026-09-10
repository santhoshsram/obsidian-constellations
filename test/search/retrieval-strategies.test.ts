import { describe, it, expect } from 'vitest';
import { ChunkIndex } from '../../src/index/chunk-index';
import type { NewChunk } from '../../src/index/chunk-index';
import { BruteForceVectorStore } from '../../src/index/vector-store';
import {
	relatedToNote,
	relatedToNoteMaxSim,
	relatedToNoteCursor,
	relatedToNoteWithStrategy,
} from '../../src/search/retrieval';

function chunk(filePath: string, text: string, heading: string): NewChunk {
	return {
		filePath,
		headingPath: [filePath.replace('.md', ''), heading],
		titleContext: `${filePath.replace('.md', '')} ${heading}`,
		text,
	};
}

function mockEmbed(table: Record<string, number[]>) {
	return async (texts: string[]) =>
		texts.map((t) => new Float32Array(table[t] ?? [0, 0, 0]));
}

describe('Retrieval Strategies', () => {
	// 3D vector space:
	// Dimension 0: Distributed Systems
	// Dimension 1: Databases
	// Dimension 2: Graphics / UI
	const VECTORS: Record<string, number[]> = {
		'raft-chunk': [1, 0, 0],
		'sql-chunk': [0, 1, 0],
		'paxos-chunk': [0.96, 0.05, 0],
		'btree-chunk': [0.05, 0.96, 0],
		'canvas-chunk': [0, 0, 1],
	};

	async function setupIndex(): Promise<ChunkIndex> {
		const store = new BruteForceVectorStore(3);
		const index = new ChunkIndex(store);

		// Multi-topic note with two distinct sections
		await index.updateFile(
			'multi-topic.md',
			[
				chunk('multi-topic.md', 'raft-chunk', 'Consensus & Raft'),
				chunk('multi-topic.md', 'sql-chunk', 'B-Trees & SQL'),
			],
			mockEmbed(VECTORS),
		);

		// Single-topic note matching section 1
		await index.updateFile(
			'distributed.md',
			[chunk('distributed.md', 'paxos-chunk', 'Paxos Implementation')],
			mockEmbed(VECTORS),
		);

		// Single-topic note matching section 2
		await index.updateFile(
			'databases.md',
			[chunk('databases.md', 'btree-chunk', 'B-Tree Indexing')],
			mockEmbed(VECTORS),
		);

		// Unrelated note
		await index.updateFile(
			'graphics.md',
			[chunk('graphics.md', 'canvas-chunk', 'Canvas Rendering')],
			mockEmbed(VECTORS),
		);

		return index;
	}

	describe('MaxSim (All-Pairs Matching)', () => {
		it('surfaces both topics of a multi-topic note where mean pooling fails with strict threshold', async () => {
			const index = await setupIndex();

			// With minScore = 0.8:
			// Mean vector of [1,0,0] and [0,1,0] has norm ~0.707 along each axis.
			// Cosine similarity to [0.96, 0.05, 0] is (0.5 * 0.96 + 0.5 * 0.05) / (sqrt(0.5) * 1) ≈ 0.714 < 0.8.
			// So mean vector retrieval finds NO notes!
			const meanResults = relatedToNote(index, 'multi-topic.md', {
				maxNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.8,
			});
			expect(meanResults).toHaveLength(0);

			// MaxSim tests each chunk independently against the vault:
			// Chunk 1 matches distributed.md with score ~0.96
			// Chunk 2 matches databases.md with score ~0.96
			const maxSimResults = relatedToNoteMaxSim(index, 'multi-topic.md', {
				maxNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.8,
			});

			expect(maxSimResults).toHaveLength(2);
			const filePaths = maxSimResults.map((r) => r.filePath);
			expect(filePaths).toContain('distributed.md');
			expect(filePaths).toContain('databases.md');
			expect(filePaths).not.toContain('graphics.md');
		});

		it('attributes the matched source heading from the active note', async () => {
			const index = await setupIndex();

			const results = relatedToNoteMaxSim(index, 'multi-topic.md', {
				maxNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.5,
			});

			const distResult = results.find((r) => r.filePath === 'distributed.md');
			expect(distResult).toBeDefined();
			expect(distResult?.matchedSourceHeading).toBe('Consensus & Raft');

			const dbResult = results.find((r) => r.filePath === 'databases.md');
			expect(dbResult).toBeDefined();
			expect(dbResult?.matchedSourceHeading).toBe('B-Trees & SQL');
		});

		it('returns identical ranking to mean vector when note has only one chunk', async () => {
			const index = await setupIndex();

			const meanResults = relatedToNote(index, 'distributed.md', {
				maxNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.1,
			});

			const maxSimResults = relatedToNoteMaxSim(index, 'distributed.md', {
				maxNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.1,
			});

			expect(maxSimResults.map((r) => r.filePath)).toEqual(
				meanResults.map((r) => r.filePath),
			);
		});
	});

	describe('Cursor Section Matching', () => {
		it('retrieves only notes related to the section specified by cursor heading', async () => {
			const index = await setupIndex();

			// Cursor in "Consensus & Raft"
			const consensusResults = relatedToNoteCursor(index, 'multi-topic.md', {
				maxNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.5,
				cursorHeading: 'Consensus & Raft',
			});

			expect(consensusResults.map((r) => r.filePath)).toEqual(['distributed.md']);
			expect(consensusResults[0]?.matchedSourceHeading).toBe('Consensus & Raft');

			// Cursor in "B-Trees & SQL"
			const dbResults = relatedToNoteCursor(index, 'multi-topic.md', {
				maxNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.5,
				cursorHeading: 'B-Trees & SQL',
			});

			expect(dbResults.map((r) => r.filePath)).toEqual(['databases.md']);
			expect(dbResults[0]?.matchedSourceHeading).toBe('B-Trees & SQL');
		});

		it('supports direct chunkIndex specification', async () => {
			const index = await setupIndex();

			const chunk0Results = relatedToNoteCursor(index, 'multi-topic.md', {
				maxNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.5,
				chunkIndex: 0,
			});

			expect(chunk0Results.map((r) => r.filePath)).toEqual(['distributed.md']);

			const chunk1Results = relatedToNoteCursor(index, 'multi-topic.md', {
				maxNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.5,
				chunkIndex: 1,
			});

			expect(chunk1Results.map((r) => r.filePath)).toEqual(['databases.md']);
		});

		it('falls back gracefully to first chunk when heading is not found', async () => {
			const index = await setupIndex();

			const results = relatedToNoteCursor(index, 'multi-topic.md', {
				maxNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.5,
				cursorHeading: 'Non-Existent Section',
			});

			// Falls back to chunk 0 ("Consensus & Raft")
			expect(results.map((r) => r.filePath)).toEqual(['distributed.md']);
		});

		it('matches chunk by cursorLine when heading is absent', async () => {
			const store = new BruteForceVectorStore(3);
			const index = new ChunkIndex(store);

			await index.updateFile(
				'flat.md',
				[
					{
						filePath: 'flat.md',
						headingPath: ['flat'],
						titleContext: 'flat',
						text: 'raft-chunk',
						startLine: 0,
						endLine: 10,
					},
					{
						filePath: 'flat.md',
						headingPath: ['flat'],
						titleContext: 'flat',
						text: 'sql-chunk',
						startLine: 11,
						endLine: 25,
					},
				],
				mockEmbed(VECTORS),
			);

			await index.updateFile(
				'distributed.md',
				[chunk('distributed.md', 'paxos-chunk', 'Paxos')],
				mockEmbed(VECTORS),
			);
			await index.updateFile(
				'databases.md',
				[chunk('databases.md', 'btree-chunk', 'BTree')],
				mockEmbed(VECTORS),
			);

			// Cursor at line 5 -> should match chunk 0 (raft -> distributed.md)
			const resLine5 = relatedToNoteCursor(index, 'flat.md', {
				maxNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.5,
				cursorLine: 5,
			});
			expect(resLine5.map((r) => r.filePath)).toEqual(['distributed.md']);

			// Cursor at line 18 -> should match chunk 1 (sql -> databases.md)
			const resLine18 = relatedToNoteCursor(index, 'flat.md', {
				maxNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.5,
				cursorLine: 18,
			});
			expect(resLine18.map((r) => r.filePath)).toEqual(['databases.md']);
		});
	});

	describe('Strategy Router (relatedToNoteWithStrategy)', () => {
		it('routes correctly according to strategy option', async () => {
			const index = await setupIndex();

			const maxSim = relatedToNoteWithStrategy(index, 'multi-topic.md', {
				strategy: 'maxsim',
				maxNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.8,
			});
			expect(maxSim.length).toBe(2);

			const mean = relatedToNoteWithStrategy(index, 'multi-topic.md', {
				strategy: 'mean',
				maxNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.8,
			});
			expect(mean.length).toBe(0);

			const cursor = relatedToNoteWithStrategy(index, 'multi-topic.md', {
				strategy: 'cursor',
				cursorHeading: 'Consensus & Raft',
				maxNotes: 10,
				maxChunksPerNote: 3,
				minScore: 0.8,
			});
			expect(cursor.length).toBe(1);
			expect(cursor[0]?.filePath).toBe('distributed.md');
		});
	});
});
