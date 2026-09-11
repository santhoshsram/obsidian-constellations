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
}

export interface GraphData {
	nodes: GraphNode[];
	edges: GraphEdge[];
	seed: GraphSeed;
}

export interface GraphBuildOptions {
	graphHop1Count: number;
	graphHop2Count: number;
	graphSimilarityThreshold: number;
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
	const hop1Count = Math.max(1, options.graphHop1Count);
	const hop2Count = Math.max(0, options.graphHop2Count);
	const threshold = options.graphSimilarityThreshold;

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
	// Track parent Hop 1 notes that discovered each Hop 2 note
	const hop2Parents = new Map<string, Array<{ parentId: string; score: number }>>();

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
				});
			}
		}

		// Hop 2: Related notes for each Hop 1 note
		if (hop2Count > 0) {
			for (const h1File of hop1Files) {
				const h1Vecs = getVectors(h1File);
				const candidateHop2: Array<{ file: string; score: number }> = [];
				for (const file of index.indexedFiles()) {
					if (visitedFiles.has(file)) continue;
					const vecs = getVectors(file);
					const sim = maxNoteSimilarity(h1Vecs, vecs);
					if (sim >= threshold) {
						candidateHop2.push({ file, score: sim });
					}
				}
				candidateHop2.sort((a, b) => b.score - a.score);
				for (const item of candidateHop2.slice(0, hop2Count)) {
					const existing = hop2Parents.get(item.file) ?? [];
					existing.push({ parentId: h1File, score: item.score });
					hop2Parents.set(item.file, existing);

					if (!visitedFiles.has(item.file)) {
						visitedFiles.add(item.file);
						nodes.push({
							id: item.file,
							label: noteLabel(item.file),
							filePath: item.file,
							isSeed: false,
							hop: 2,
							similarity: item.score,
							radius: 5,
						});
					}
				}
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
			});
		}

		// Hop 2
		if (hop2Count > 0) {
			for (const h1File of hop1Files) {
				const h1Vecs = getVectors(h1File);
				const candidateHop2: Array<{ file: string; score: number }> = [];
				for (const file of index.indexedFiles()) {
					if (visitedFiles.has(file)) continue;
					const vecs = getVectors(file);
					const sim = maxNoteSimilarity(h1Vecs, vecs);
					if (sim >= threshold) {
						candidateHop2.push({ file, score: sim });
					}
				}
				candidateHop2.sort((a, b) => b.score - a.score);
				for (const item of candidateHop2.slice(0, hop2Count)) {
					const existing = hop2Parents.get(item.file) ?? [];
					existing.push({ parentId: h1File, score: item.score });
					hop2Parents.set(item.file, existing);

					if (!visitedFiles.has(item.file)) {
						visitedFiles.add(item.file);
						nodes.push({
							id: item.file,
							label: noteLabel(item.file),
							filePath: item.file,
							isSeed: false,
							hop: 2,
							similarity: item.score,
							radius: 5,
						});
					}
				}
			}
		}
	}

	// Build edges with structured 2-hop topology to prevent hairball cliques:
	// 1. Seed connects ONLY to Hop 1 nodes meeting threshold (or top matches).
	// 2. Hop 2 nodes connect to their Hop 1 parent(s).
	// 3. Peer cross-edges (Hop 1 <-> Hop 1 or Hop 2 <-> Hop 2) are filtered by threshold
	//    and capped per node to prevent complete graph explosion.
	const edges: GraphEdge[] = [];
	const seenPairs = new Set<string>();

	const addEdge = (sourceId: string, targetId: string, similarity: number): boolean => {
		const pairKey = [sourceId, targetId].sort().join('---');
		if (seenPairs.has(pairKey)) return false;
		seenPairs.add(pairKey);
		edges.push({
			id: pairKey,
			source: sourceId,
			target: targetId,
			similarity,
		});
		return true;
	};

	const seedNode = nodes.find((n) => n.isSeed);
	const hop1Nodes = nodes.filter((n) => n.hop === 1);
	const hop2Nodes = nodes.filter((n) => n.hop === 2);

	// 1. Seed -> Hop 1 edges
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
			addEdge(seedNode.id, h1.id, Math.max(0.4, sim));
		}
	}

	// 2. Hop 1 -> Hop 2 edges
	for (const h2 of hop2Nodes) {
		const parents = hop2Parents.get(h2.id) ?? [];
		parents.sort((a, b) => b.score - a.score);
		let linked = false;
		for (const p of parents) {
			if (p.score >= threshold || !linked) {
				addEdge(p.parentId, h2.id, Math.max(0.5, p.score));
				linked = true;
			}
		}
	}

	// 3. Peer cross-edges among Hop 1 nodes (max 2 cross-edges per Hop 1 node)
	const h1CrossCounts = new Map<string, number>();
	const candidateH1Edges: Array<{ a: string; b: string; sim: number }> = [];

	for (let i = 0; i < hop1Nodes.length; i++) {
		for (let j = i + 1; j < hop1Nodes.length; j++) {
			const a = hop1Nodes[i];
			const b = hop1Nodes[j];
			if (!a?.filePath || !b?.filePath) continue;
			const sim = maxNoteSimilarity(getVectors(a.filePath), getVectors(b.filePath));
			if (sim >= threshold) {
				candidateH1Edges.push({ a: a.id, b: b.id, sim });
			}
		}
	}
	candidateH1Edges.sort((x, y) => y.sim - x.sim);
	for (const cand of candidateH1Edges) {
		const countA = h1CrossCounts.get(cand.a) ?? 0;
		const countB = h1CrossCounts.get(cand.b) ?? 0;
		if (countA < 2 && countB < 2) {
			if (addEdge(cand.a, cand.b, cand.sim)) {
				h1CrossCounts.set(cand.a, countA + 1);
				h1CrossCounts.set(cand.b, countB + 1);
			}
		}
	}

	// 4. Peer cross-edges among Hop 2 nodes (max 1 cross-edge per Hop 2 node)
	const h2CrossCounts = new Map<string, number>();
	const candidateH2Edges: Array<{ a: string; b: string; sim: number }> = [];

	for (let i = 0; i < hop2Nodes.length; i++) {
		for (let j = i + 1; j < hop2Nodes.length; j++) {
			const a = hop2Nodes[i];
			const b = hop2Nodes[j];
			if (!a?.filePath || !b?.filePath) continue;
			const sim = maxNoteSimilarity(getVectors(a.filePath), getVectors(b.filePath));
			if (sim >= threshold) {
				candidateH2Edges.push({ a: a.id, b: b.id, sim });
			}
		}
	}
	candidateH2Edges.sort((x, y) => y.sim - x.sim);
	for (const cand of candidateH2Edges) {
		const countA = h2CrossCounts.get(cand.a) ?? 0;
		const countB = h2CrossCounts.get(cand.b) ?? 0;
		if (countA < 1 && countB < 1) {
			if (addEdge(cand.a, cand.b, cand.sim)) {
				h2CrossCounts.set(cand.a, countA + 1);
				h2CrossCounts.set(cand.b, countB + 1);
			}
		}
	}

	return { nodes, edges, seed };
}
