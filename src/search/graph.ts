/**
 * Graph data layer for Context Graph (Phase 3).
 *
 * Expands a 2-hop semantic neighborhood around a seed note or search query,
 * rolls up chunk-level cosine similarities to file-level maximums, and
 * generates deduplicated nodes and threshold-filtered edges.
 */

import type { ChunkIndex } from '../index/chunk-index';
import type { Embedder } from '../embed/embedder';

export type GraphSeed =
	| { type: 'note'; path: string }
	| { type: 'query'; query: string };

export interface GraphNode {
	id: string;
	label: string;
	filePath?: string;
	isSeed: boolean;
	hop: number;
	similarity?: number;
	radius?: number;
	parentId?: string;
	sneakPeek?: string[];
	x?: number;
	y?: number;
	vx?: number;
	vy?: number;
	fx?: number | null;
	fy?: number | null;
}

export interface GraphEdge {
	id: string;
	source: string | GraphNode;
	target: string | GraphNode;
	similarity: number;
	isSecondary?: boolean;
	kind?: 'primary' | 'peer' | 'satellite';
}

export interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
	seed: GraphSeed;
}

export interface GraphBuildOptions {
	graphHop1Count?: number;
	graphHop2Count?: number;
	graphSimilarityThreshold?: number;
	maxRelatedNotes?: number;
	minSimilarity?: number;
}

/**
 * Calculate the maximum cosine similarity between any chunk vector of note A
 * and any chunk vector of note B. Vectors are assumed to be L2-normalized.
 */
export function maxNoteSimilarity(
	vectorsA: Float32Array[],
	vectorsB: Float32Array[],
): number {
	if (vectorsA.length === 0 || vectorsB.length === 0) {
		return -1;
	}
	let max = -1;
	for (const va of vectorsA) {
		for (const vb of vectorsB) {
			let dot = 0;
			for (let i = 0; i < va.length; i++) {
				dot += (va[i] ?? 0) * (vb[i] ?? 0);
			}
			if (dot > max) {
				max = dot;
			}
		}
	}
	return max;
}

function noteLabel(filePath: string): string {
	const base = filePath.split('/').pop() ?? filePath;
	return base.replace(/\.md$/, '');
}

/**
 * Build a 2-hop Context Graph around a seed note or text query.
 */
export async function buildContextGraph(
	index: ChunkIndex,
	seed: GraphSeed,
	options: GraphBuildOptions,
	embedder?: Embedder,
	initialHop1?: Array<{ filePath: string; score: number }>,
): Promise<GraphData> {
	const hop1Count = Math.max(
		1,
		options.maxRelatedNotes ?? options.graphHop1Count ?? 10,
	);
	const threshold =
		options.minSimilarity ?? options.graphSimilarityThreshold ?? 0.45;

	const nodes: GraphNode[] = [];
	const visitedFiles = new Set<string>();
	const fileVectors = new Map<string, Float32Array[]>();
	const seedScoreMap = new Map<string, number>();

	const getVectors = (file: string): Float32Array[] => {
		let v = fileVectors.get(file);
		if (!v) {
			v = index.vectorsForFile(file);
			fileVectors.set(file, v);
		}
		return v;
	};

	let queryVector: Float32Array | null = null;

	const computeSneakPeek = (file: string): string[] => {
		const fileVecs = getVectors(file);
		const candidates: Array<{ file: string; score: number }> = [];
		for (const other of index.indexedFiles()) {
			if (other === file) continue;
			if (seed.type === 'note' && other === seed.path) continue;
			const otherVecs = getVectors(other);
			const sim = maxNoteSimilarity(fileVecs, otherVecs);
			if (sim >= threshold) {
				candidates.push({ file: other, score: sim });
			}
		}
		candidates.sort((a, b) => b.score - a.score);
		return candidates.slice(0, 5).map((c) => noteLabel(c.file));
	};

	if (seed.type === 'note') {
		const seedChunks = index.chunksForFile(seed.path);
		if (seedChunks.length === 0) {
			return { nodes: [], edges: [], seed };
		}

		visitedFiles.add(seed.path);
		const seedNode: GraphNode = {
			id: seed.path,
			label: noteLabel(seed.path),
			filePath: seed.path,
			isSeed: true,
			hop: 0,
			similarity: 1.0,
			radius: 10,
		};
		nodes.push(seedNode);

		// Hop 1: Related notes to seed note
		const hop1Files: string[] = [];

		if (initialHop1 && initialHop1.length > 0) {
			for (const item of initialHop1.slice(0, hop1Count)) {
				hop1Files.push(item.filePath);
				visitedFiles.add(item.filePath);
				seedScoreMap.set(item.filePath, item.score);
				nodes.push({
					id: item.filePath,
					label: noteLabel(item.filePath),
					filePath: item.filePath,
					isSeed: false,
					hop: 1,
					similarity: item.score,
					radius: 7,
					sneakPeek: computeSneakPeek(item.filePath),
				});
			}
		} else {
			const seedVecs = getVectors(seed.path);
			const scoredFiles: Array<{ file: string; score: number }> = [];

			for (const file of index.indexedFiles()) {
				if (file === seed.path) continue;
				const vecs = getVectors(file);
				const sim = maxNoteSimilarity(seedVecs, vecs);
				if (sim >= threshold) {
					scoredFiles.push({ file, score: sim });
				}
			}
			scoredFiles.sort((a, b) => b.score - a.score);

			for (const item of scoredFiles.slice(0, hop1Count)) {
				hop1Files.push(item.file);
				visitedFiles.add(item.file);
				seedScoreMap.set(item.file, item.score);
				nodes.push({
					id: item.file,
					label: noteLabel(item.file),
					filePath: item.file,
					isSeed: false,
					hop: 1,
					similarity: item.score,
					radius: 7,
					sneakPeek: computeSneakPeek(item.file),
				});
			}
		}
	} else {
		// seed.type === 'query'
		if (!embedder) {
			return { nodes: [], edges: [], seed };
		}
		queryVector = await embedder.embedQuery(seed.query);

		const queryNode: GraphNode = {
			id: '__query__',
			label: `"${seed.query}"`,
			isSeed: true,
			hop: 0,
			similarity: 1.0,
			radius: 10,
		};
		nodes.push(queryNode);

		// Search index with query vector
		const searchResults = index.search(queryVector, 50, threshold);
		const fileBestScore = new Map<string, number>();
		for (const res of searchResults) {
			const existing = fileBestScore.get(res.record.filePath) ?? -1;
			if (res.score > existing) {
				fileBestScore.set(res.record.filePath, res.score);
			}
		}
		const rankedHop1 = [...fileBestScore.entries()]
			.map(([file, score]) => ({ file, score }))
			.sort((a, b) => b.score - a.score);

		const hop1Files: string[] = [];
		for (const item of rankedHop1.slice(0, hop1Count)) {
			hop1Files.push(item.file);
			visitedFiles.add(item.file);
			nodes.push({
				id: item.file,
				label: noteLabel(item.file),
				filePath: item.file,
				isSeed: false,
				hop: 1,
				similarity: item.score,
				radius: 7,
				sneakPeek: computeSneakPeek(item.file),
			});
		}
	}

	// Build edges:
	// - Primary edges (Seed -> Hop 1): Solid, vibrant
	// - Secondary edges (Hop 1 -> Hop 2 or Hop 1 -> Hop 1): Faint hairline ambient satellites
	const edges: GraphEdge[] = [];
	const seenPairs = new Set<string>();

	const addEdge = (
		sourceId: string,
		targetId: string,
		similarity: number,
		isSecondary = false,
		kind: 'primary' | 'peer' | 'satellite' = 'primary',
	): boolean => {
		const pairKey = [sourceId, targetId].sort().join('---');
		if (seenPairs.has(pairKey)) return false;
		seenPairs.add(pairKey);
		edges.push({
			id: pairKey,
			source: sourceId,
			target: targetId,
			similarity,
			isSecondary,
			kind,
		});
		return true;
	};

	const seedNode = nodes.find((n) => n.isSeed);
	const hop1Nodes = nodes.filter((n) => n.hop === 1);
	const hop1NodeIds = new Set(hop1Nodes.map((n) => n.id));

	// 1. Seed -> Hop 1 edges (Primary spokes)
	if (seedNode) {
		for (const h1 of hop1Nodes) {
			let sim = 0;
			if (seed.type === 'note' && h1.filePath) {
				const precomputed = seedScoreMap.get(h1.filePath);
				if (typeof precomputed === 'number') {
					sim = precomputed;
				} else {
					sim = maxNoteSimilarity(getVectors(seed.path), getVectors(h1.filePath));
				}
			} else if (seed.type === 'query' && queryVector && h1.filePath) {
				for (const v of getVectors(h1.filePath)) {
					let dot = 0;
					for (let d = 0; d < v.length; d++) {
						dot += (queryVector[d] ?? 0) * (v[d] ?? 0);
					}
					if (dot > sim) sim = dot;
				}
			}
			addEdge(seedNode.id, h1.id, Math.max(0.4, sim), false, 'primary');
		}
	}

	// 2. Secondary 2-hop satellites & peer cross-connections
	const hop2PerNode = Math.min(
		6,
		Math.max(0, options.graphHop2Count !== undefined ? options.graphHop2Count : 4),
	);
	const h1CrossCounts = new Map<string, number>();

	for (const h1 of hop1Nodes) {
		if (!h1.filePath) continue;
		const h1Vecs = getVectors(h1.filePath);
		const candidates: Array<{ file: string; score: number }> = [];

		for (const other of index.indexedFiles()) {
			if (other === h1.filePath) continue;
			if (seed.type === 'note' && other === seed.path) continue;
			const otherVecs = getVectors(other);
			const sim = maxNoteSimilarity(h1Vecs, otherVecs);
			if (sim >= threshold) {
				candidates.push({ file: other, score: sim });
			}
		}
		candidates.sort((a, b) => b.score - a.score);

		let addedForH1 = 0;
		for (const cand of candidates) {
			if (addedForH1 >= hop2PerNode) break;

			// Case A: Candidate is another 1-hop foreground star (peer cross-connection)
			if (hop1NodeIds.has(cand.file)) {
				const countA = h1CrossCounts.get(h1.id) ?? 0;
				const countB = h1CrossCounts.get(cand.file) ?? 0;
				if (countA < 1 && countB < 1) {
					if (addEdge(h1.id, cand.file, cand.score, true, 'peer')) {
						h1CrossCounts.set(h1.id, countA + 1);
						h1CrossCounts.set(cand.file, countB + 1);
					}
				}
				continue;
			}

			// Case B: Candidate is a true 2-hop background star (satellite)
			if (!visitedFiles.has(cand.file)) {
				visitedFiles.add(cand.file);
				nodes.push({
					id: cand.file,
					label: noteLabel(cand.file),
					filePath: cand.file,
					isSeed: false,
					hop: 2,
					similarity: cand.score,
					radius: 4.5,
					parentId: h1.id,
				});
			}

			if (addEdge(h1.id, cand.file, cand.score, true, 'satellite')) {
				addedForH1++;
			}
		}
	}

	return { nodes, edges, seed };
}
