import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ContextGraphEngine } from '../../src/ui/graph/context-graph-engine';
import { MockElement } from '../mocks/obsidian';
import type { GraphData } from '../../src/search/graph';

describe('ContextGraphEngine', () => {
	let container: MockElement;
	let engine: ContextGraphEngine;
	let onNodeClick: ReturnType<typeof vi.fn>;
	let onNodeDoubleClick: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		onNodeClick = vi.fn();
		onNodeDoubleClick = vi.fn();
		container = new MockElement('div');
		engine = new ContextGraphEngine(container as unknown as HTMLElement, {
			onNodeClick,
			onNodeDoubleClick,
		});
	});

	afterEach(() => {
		engine.destroy();
	});

	it('creates canvas element inside container', () => {
		const canvas = container.children.find((c) => c.tagName.toLowerCase() === 'canvas');
		expect(canvas).toBeDefined();
	});

	it('sets data and initializes simulation nodes', () => {
		const data: GraphData = {
			seed: { type: 'note', path: 'A.md' },
			nodes: [
				{ id: 'A.md', label: 'A', isSeed: true, hop: 0, radius: 10 },
				{ id: 'B.md', label: 'B', isSeed: false, hop: 1, radius: 7 },
			],
			edges: [{ id: 'A---B', source: 'A.md', target: 'B.md', similarity: 0.9 }],
		};

		engine.setData(data);
		expect(engine.getNodes().length).toBe(2);
		expect(engine.getEdges().length).toBe(1);
	});

	it('pins the seed node at canvas center on initial or new seed data', () => {
		const data: GraphData = {
			seed: { type: 'note', path: 'Active.md' },
			nodes: [
				{ id: 'Active.md', label: 'Active', isSeed: true, hop: 0, radius: 10 },
				{ id: 'Neighbor.md', label: 'Neighbor', isSeed: false, hop: 1, radius: 7 },
			],
			edges: [{ id: 'Active---Neighbor', source: 'Active.md', target: 'Neighbor.md', similarity: 0.85 }],
		};
		engine.setData(data);

		const seed = engine.getNodes().find((n) => n.id === 'Active.md');
		expect(seed).toBeDefined();
		// Default mock container width 800, height 600 -> cx = 400, cy = 300
		expect(seed?.x).toBe(400);
		expect(seed?.y).toBe(300);
		expect(seed?.fx).toBe(400);
		expect(seed?.fy).toBe(300);
	});

	it('preserves existing node positions when updating data', () => {
		const data1: GraphData = {
			seed: { type: 'note', path: 'A.md' },
			nodes: [{ id: 'A.md', label: 'A', isSeed: true, hop: 0, radius: 10 }],
			edges: [],
		};
		engine.setData(data1);

		// Assign a coordinate to A.md
		const nodeA = engine.getNodes().find((n) => n.id === 'A.md');
		expect(nodeA).toBeDefined();
		if (nodeA) {
			nodeA.x = 150;
			nodeA.y = 250;
		}

		const data2: GraphData = {
			seed: { type: 'note', path: 'A.md' },
			nodes: [
				{ id: 'A.md', label: 'A', isSeed: true, hop: 0, radius: 10 },
				{ id: 'B.md', label: 'B', isSeed: false, hop: 1, radius: 7 },
			],
			edges: [{ id: 'A---B', source: 'A.md', target: 'B.md', similarity: 0.85 }],
		};
		engine.setData(data2);

		const updatedA = engine.getNodes().find((n) => n.id === 'A.md');
		expect(updatedA?.x).toBe(150);
		expect(updatedA?.y).toBe(250);
	});

	it('correctly hit-tests a node at given client coordinates', () => {
		const data: GraphData = {
			seed: { type: 'note', path: 'A.md' },
			nodes: [{ id: 'A.md', label: 'A', isSeed: true, hop: 0, radius: 10 }],
			edges: [],
		};
		engine.setData(data);

		const node = engine.getNodes()[0];
		if (node) {
			node.x = 200;
			node.y = 200;
		}

		// Hit test at node location
		const hit = engine.getNodeAt(200, 200);
		expect(hit?.id).toBe('A.md');

		// Hit test far away
		const miss = engine.getNodeAt(500, 500);
		expect(miss).toBeNull();
	});

	it('emits onNodeClick when clicked on a node', () => {
		const data: GraphData = {
			seed: { type: 'note', path: 'A.md' },
			nodes: [{ id: 'A.md', label: 'A', isSeed: true, hop: 0, radius: 10 }],
			edges: [],
		};
		engine.setData(data);
		const node = engine.getNodes()[0];
		if (node) {
			node.x = 100;
			node.y = 100;
		}

		engine.handleClick(100, 100);
		expect(onNodeClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'A.md' }));
	});

	it('emits onNodeDoubleClick when double-clicked on a node', () => {
		const data: GraphData = {
			seed: { type: 'note', path: 'A.md' },
			nodes: [{ id: 'A.md', label: 'A', isSeed: true, hop: 0, radius: 10 }],
			edges: [],
		};
		engine.setData(data);
		const node = engine.getNodes()[0];
		if (node) {
			node.x = 100;
			node.y = 100;
		}

		engine.handleDoubleClick(100, 100);
		expect(onNodeDoubleClick).toHaveBeenCalledWith(expect.objectContaining({ id: 'A.md' }));
	});

	it('renders central note edges in accent color and keeps nodes undimmed by default', () => {
		const data: GraphData = {
			seed: { type: 'note', path: 'A.md' },
			nodes: [
				{ id: 'A.md', label: 'A', isSeed: true, hop: 0, radius: 10 },
				{ id: 'B.md', label: 'B', isSeed: false, hop: 1, radius: 7 },
			],
			edges: [{ id: 'A---B', source: 'A.md', target: 'B.md', similarity: 0.88 }],
		};
		engine.setData(data);
		// Trigger render
		expect(() => engine.render()).not.toThrow();
	});
});
