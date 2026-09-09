/**
 * Brute-force cosine-similarity vector store.
 *
 * Implements the `VectorStore` contract behind which a real ANN index
 * (vectra, usearch) can be swapped later. At personal-vault scale
 * (~thousands of chunks), an exhaustive scan is sub-millisecond and needs
 * no native dependencies.
 *
 * Vectors are L2-normalized on add/search, so cosine similarity is a dot
 * product. Removals are tombstones; the persistence layer compacts on
 * save by rewriting `activeRows()` in order.
 */

export interface SearchResult {
	row: number;
	/** Cosine similarity in [-1, 1]; 1 = identical direction. */
	score: number;
}

export interface VectorStore {
	readonly dimensions: number;
	/** Number of active (non-tombstoned) vectors. */
	readonly size: number;
	add(vector: Float32Array): number;
	remove(row: number): void;
	get(row: number): Float32Array | null;
	activeRows(): number[];
	search(
		query: Float32Array,
		topK: number,
		minScore?: number,
	): SearchResult[];
}

export class BruteForceVectorStore implements VectorStore {
	readonly dimensions: number;
	/** rows[row] is null when tombstoned. Vectors are stored normalized. */
	private rows: Array<Float32Array | null> = [];
	private active = 0;

	constructor(dimensions: number) {
		if (dimensions <= 0) {
			throw new Error('dimensions must be positive');
		}
		this.dimensions = dimensions;
	}

	get size(): number {
		return this.active;
	}

	add(vector: Float32Array): number {
		this.checkDimensions(vector);
		this.rows.push(normalize(vector));
		this.active++;
		return this.rows.length - 1;
	}

	remove(row: number): void {
		if (this.rows[row] != null) {
			this.rows[row] = null;
			this.active--;
		}
	}

	get(row: number): Float32Array | null {
		return this.rows[row] ?? null;
	}

	activeRows(): number[] {
		const rows: number[] = [];
		for (let i = 0; i < this.rows.length; i++) {
			if (this.rows[i] != null) {
				rows.push(i);
			}
		}
		return rows;
	}

	search(
		query: Float32Array,
		topK: number,
		minScore = -Infinity,
	): SearchResult[] {
		this.checkDimensions(query);
		if (topK <= 0 || this.active === 0) {
			return [];
		}
		const q = normalize(query);

		const results: SearchResult[] = [];
		for (let row = 0; row < this.rows.length; row++) {
			const v = this.rows[row];
			if (v == null) {
				continue;
			}
			let score = 0;
			for (let d = 0; d < this.dimensions; d++) {
				score += (q[d] ?? 0) * (v[d] ?? 0);
			}
			if (score >= minScore) {
				results.push({ row, score });
			}
		}
		results.sort((a, b) => b.score - a.score);
		return results.slice(0, topK);
	}

	private checkDimensions(vector: Float32Array): void {
		if (vector.length !== this.dimensions) {
			throw new Error(
				`expected a ${this.dimensions}-dimensional vector, got ${vector.length}`,
			);
		}
	}
}

/** Return an L2-normalized copy; zero vectors normalize to zero. */
function normalize(vector: Float32Array): Float32Array {
	let norm = 0;
	for (let i = 0; i < vector.length; i++) {
		const x = vector[i] ?? 0;
		norm += x * x;
	}
	norm = Math.sqrt(norm);
	const out = new Float32Array(vector);
	if (norm > 0) {
		for (let i = 0; i < out.length; i++) {
			out[i] = (out[i] ?? 0) / norm;
		}
	}
	return out;
}
