/**
 * Context Graph physics and Canvas rendering engine.
 *
 * Uses d3-force for repulsive and link physics, and renders an interactive
 * HTML5 Canvas with smooth zoom, pan, node dragging, and semantic hover highlighting.
 */

import {
	forceSimulation,
	forceLink,
	forceManyBody,
	forceCenter,
	forceCollide,
	forceRadial,
	type Simulation,
	type ForceLink,
	type ForceCenter,
	type ForceRadial,
} from 'd3-force';
import type { GraphData, GraphNode, GraphEdge } from '../../search/graph';

export interface ContextGraphEngineOptions {
	onNodeClick?: (node: GraphNode) => void;
	onNodeDoubleClick?: (node: GraphNode) => void;
	onNodeHover?: (node: GraphNode | null) => void;
	enableTooltip?: boolean;
}

function getEndpointId(endpoint: string | GraphNode): string {
	return typeof endpoint === 'object' ? endpoint.id : endpoint;
}

function getEndpointNode(endpoint: string | GraphNode): GraphNode | null {
	return typeof endpoint === 'object' ? endpoint : null;
}

export class ContextGraphEngine {
	private canvas: HTMLCanvasElement;
	private ctx: CanvasRenderingContext2D | null = null;
	private simulation: Simulation<GraphNode, GraphEdge>;
	private linkForce: ForceLink<GraphNode, GraphEdge>;
	private centerForce: ForceCenter<GraphNode>;
	private radialForce: ForceRadial<GraphNode>;

	private nodes: GraphNode[] = [];
	private edges: GraphEdge[] = [];
	private hoveredNode: GraphNode | null = null;
	private tooltipEl: HTMLElement;

	private panX = 0;
	private panY = 0;
	private zoom = 1;

	private isDraggingCanvas = false;
	private draggedNode: GraphNode | null = null;
	private dragStartX = 0;
	private dragStartY = 0;
	private hasDragged = false;
	private currentSeedKey: string | null = null;

	private resizeObserver: ResizeObserver | null = null;
	private animFrameId: number | null = null;
	private glowAnimFrameId: number | null = null;
	private optimisticLoading = false;
	private optimisticStartTime = 0;

	constructor(
		private container: HTMLElement,
		private options: ContextGraphEngineOptions = {},
	) {
		this.canvas = container.createEl('canvas', {
			cls: 'brain-context-graph-canvas',
		});

		this.ctx = this.canvas.getContext('2d');

		this.tooltipEl = container.createDiv({
			cls: 'brain-context-graph-tooltip is-hidden',
		});

		const rect = container.getBoundingClientRect?.() ?? { width: 800, height: 600 };
		const width = rect.width || 800;
		const height = rect.height || 600;
		const minDim = Math.min(width, height);
		const scale = Math.max(0.7, Math.min(1.3, minDim / 750));

		this.centerForce = forceCenter(width / 2, height / 2);
		this.linkForce = forceLink<GraphNode, GraphEdge>(this.edges).id((d) => d.id);
		this.radialForce = forceRadial<GraphNode>(
			(d: GraphNode) => {
				if (d.isSeed || d.hop > 1) return 0;
				let score = d.similarity ?? 0.6;
				if (score > 1.0) score = 1 / (1 + Math.exp(-score));
				const norm = Math.max(0, Math.min(1, (score - 0.4) / 0.55));
				const minRadial = 90 * scale;
				const maxRadial = 250 * scale;
				return minRadial + (1 - norm) * (maxRadial - minRadial);
			},
			width / 2,
			height / 2,
		);

		this.simulation = forceSimulation<GraphNode>(this.nodes)
			.force('link', this.linkForce)
			.force('charge', forceManyBody<GraphNode>())
			.force('radial', this.radialForce)
			.force('center', this.centerForce)
			.force('collide', forceCollide<GraphNode>());

		this.updateForces(scale);

		this.simulation.on('tick', () => {
			this.requestRender();
		});

		this.setupEventListeners();
		this.setupResizeObserver();
		this.resize();
	}

	private updateForces(scale: number): void {
		this.linkForce
			.distance((edge) => {
				let score = edge.similarity ?? 0.6;
				if (score > 1.0) score = 1 / (1 + Math.exp(-score));
				const normScore = Math.max(0, Math.min(1, (score - 0.4) / 0.55));

				if (edge.kind === 'peer') {
					// Peer 1-hop cross-edges: wider cluster spacing (smooth counterweight against crowding)
					const minPeerDist = 140 * scale;
					const maxPeerDist = 260 * scale;
					return minPeerDist + (1 - normScore) * (maxPeerDist - minPeerDist);
				}

				if (edge.isSecondary || edge.kind === 'satellite') {
					// Secondary satellite orbit distance (outside parent label zone)
					const minSecDist = 42 * scale;
					const maxSecDist = 78 * scale;
					return minSecDist + (1 - normScore) * (maxSecDist - minSecDist);
				}

				// Primary seed links: distance strictly corresponds to score
				const minLinkDist = 80 * scale;
				const maxLinkDist = 240 * scale;
				return minLinkDist + (1 - normScore) * (maxLinkDist - minLinkDist);
			})
			.strength((edge) => {
				if (edge.kind === 'peer') {
					// Whisper-soft spring tension so similar 1-hops gently drift together without bunching up
					return 0.05;
				}
				if (edge.isSecondary || edge.kind === 'satellite') {
					return 0.8;
				}
				return 1.0;
			});

		this.simulation.force(
			'charge',
			forceManyBody<GraphNode>().strength((d) => {
				if (d.isSeed) return -350 * scale;
				if (d.hop > 1) return -70 * scale; // Tiered 2-hop counterweight (nearly 3x stronger than before)
				return -220 * scale;
			}),
		);

		this.radialForce
			.radius((d: GraphNode) => {
				if (d.isSeed || d.hop > 1) return 0;
				let score = d.similarity ?? 0.6;
				if (score > 1.0) score = 1 / (1 + Math.exp(-score));
				const norm = Math.max(0, Math.min(1, (score - 0.4) / 0.55));
				const minRadial = 90 * scale;
				const maxRadial = 250 * scale;
				return minRadial + (1 - norm) * (maxRadial - minRadial);
			})
			.strength((d: GraphNode) => {
				if (d.isSeed) return 1.0;
				if (d.hop > 1) return 0;
				return 0.95;
			});

		this.simulation.force(
			'collide',
			forceCollide<GraphNode>((d) => (d.radius ?? (d.hop > 1 ? 4.5 : 8)) + (d.hop > 1 ? 12 : 48) * scale).iterations(4),
		);

		this.simulation.force(
			'angular',
			this.createAngularForce(scale),
		);
	}

	private createAngularForce(scale: number) {
		return (alpha: number) => {
			const seed = this.nodes.find((n) => n.isSeed);
			const cx = seed?.x ?? this.centerForce.x?.() ?? 400;
			const cy = seed?.y ?? this.centerForce.y?.() ?? 300;
			const h1Nodes = this.nodes.filter(
				(n) => n.hop === 1 && n.x !== undefined && n.y !== undefined,
			);
			if (h1Nodes.length < 2) return;

			// Compute polar angle for each hop-1 node relative to seed
			const nodeAngles = h1Nodes.map((n) => ({
				node: n,
				angle: Math.atan2((n.y ?? 0) - cy, (n.x ?? 0) - cx),
			}));

			// Sort by angle around the circle [-PI, PI]
			nodeAngles.sort((a, b) => a.angle - b.angle);

			// Minimum angular clearance between any two adjacent 1-hop spokes (~22 degrees = 0.38 rad)
			const minSeparation = Math.min(
				(2 * Math.PI) / (h1Nodes.length + 1),
				0.38,
			);

			const count = nodeAngles.length;
			for (let i = 0; i < count; i++) {
				const current = nodeAngles[i]!;
				const next = nodeAngles[(i + 1) % count]!;

				let diff = next.angle - current.angle;
				if (diff < 0) diff += 2 * Math.PI;

				if (diff < minSeparation) {
					const overlap = minSeparation - Math.max(1e-4, diff);
					const forceMag = overlap * 80 * alpha * scale;

					// Push current counterclockwise (decreasing angle in screen coords)
					const curSin = Math.sin(current.angle);
					const curCos = Math.cos(current.angle);
					current.node.vx = (current.node.vx ?? 0) + curSin * forceMag;
					current.node.vy = (current.node.vy ?? 0) - curCos * forceMag;

					// Push next clockwise (increasing angle in screen coords)
					const nextSin = Math.sin(next.angle);
					const nextCos = Math.cos(next.angle);
					next.node.vx = (next.node.vx ?? 0) - nextSin * forceMag;
					next.node.vy = (next.node.vy ?? 0) + nextCos * forceMag;
				}
			}
		};
	}

	getNodes(): GraphNode[] {
		return this.nodes;
	}

	getEdges(): GraphEdge[] {
		return this.edges;
	}

	getLinkDistance(edge: GraphEdge): number {
		const accessor = this.linkForce.distance();
		if (typeof accessor === 'function') {
			return (accessor as (e: GraphEdge) => number)(edge);
		}
		return typeof accessor === 'number' ? accessor : 0;
	}

	getRadialRadius(node: GraphNode): number {
		const accessor = this.radialForce.radius();
		if (typeof accessor === 'function') {
			return (accessor as (n: GraphNode) => number)(node);
		}
		return typeof accessor === 'number' ? accessor : 0;
	}

	isOptimisticLoading(): boolean {
		return this.optimisticLoading;
	}

	optimisticFocus(nodeId: string, newTitle?: string): void {
		const targetNode = this.nodes.find((n) => n.id === nodeId);
		if (!targetNode) return;

		this.tooltipEl?.addClass('is-hidden');

		const rect = this.container.getBoundingClientRect?.() ?? { width: 800, height: 600 };
		const width = Math.max(100, rect.width || 800);
		const height = Math.max(100, rect.height || 600);
		const cx = width / 2;
		const cy = height / 2;

		targetNode.isSeed = true;
		targetNode.hop = 0;
		if (newTitle) {
			targetNode.label = newTitle;
		}
		targetNode.x = cx;
		targetNode.y = cy;
		targetNode.fx = cx;
		targetNode.fy = cy;
		targetNode.vx = 0;
		targetNode.vy = 0;

		this.nodes = [targetNode];
		this.edges = [];
		this.hoveredNode = null;
		this.canvas.removeClass('is-hovering-node');

		this.simulation.nodes(this.nodes);
		this.linkForce.links(this.edges);
		this.simulation.stop();

		this.optimisticLoading = true;
		this.optimisticStartTime = Date.now();
		this.panX = 0;
		this.panY = 0;
		this.zoom = 1;

		this.startLoadingGlowLoop();
	}

	private startLoadingGlowLoop(): void {
		if (!this.optimisticLoading) return;
		this.render();
		if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
			this.glowAnimFrameId = window.requestAnimationFrame(() => {
				if (this.optimisticLoading) {
					this.startLoadingGlowLoop();
				}
			});
		}
	}

	private stopLoadingGlow(): void {
		this.optimisticLoading = false;
		if (this.glowAnimFrameId !== null) {
			if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') {
				window.cancelAnimationFrame(this.glowAnimFrameId);
			} else if (typeof cancelAnimationFrame === 'function') {
				cancelAnimationFrame(this.glowAnimFrameId);
			}
			this.glowAnimFrameId = null;
		}
	}

	setData(data: GraphData): void {
		this.stopLoadingGlow();
		const existingPositions = new Map<
			string,
			{ x?: number; y?: number; vx?: number; vy?: number }
		>();
		for (const n of this.nodes) {
			existingPositions.set(n.id, { x: n.x, y: n.y, vx: n.vx, vy: n.vy });
		}

		const rect = this.container.getBoundingClientRect?.() ?? { width: 800, height: 600 };
		const width = Math.max(100, rect.width || 800);
		const height = Math.max(100, rect.height || 600);
		const cx = width / 2;
		const cy = height / 2;
		const minDim = Math.min(width, height);
		const scale = Math.max(0.7, Math.min(1.3, minDim / 750));

		const newSeedKey = data.seed.type === 'note' ? data.seed.path : data.seed.query;
		const isNewSeed = this.currentSeedKey !== newSeedKey;
		this.currentSeedKey = newSeedKey;

		if (isNewSeed) {
			this.panX = 0;
			this.panY = 0;
			this.zoom = 1;
		}

		const hop1Nodes = data.nodes.filter((n) => n.hop === 1);
		// Order hop-1 nodes so that mutually similar / peer-connected nodes occupy adjacent angular slots
		// This prevents peer springs from pulling across the center or crisscrossing spokes!
		const orderedH1: GraphNode[] = [];
		if (hop1Nodes.length > 0) {
			const remaining = new Set(hop1Nodes);
			let current = hop1Nodes[0]!;
			orderedH1.push(current);
			remaining.delete(current);

			while (remaining.size > 0) {
				// Find best neighbor in remaining connected by peer edge or highest similarity
				let bestNext: GraphNode | null = null;
				let bestSim = -1;

				for (const edge of data.edges) {
					if (edge.kind === 'peer') {
						const sId = getEndpointId(edge.source);
						const tId = getEndpointId(edge.target);
						if (sId === current.id) {
							const cand = [...remaining].find((n) => n.id === tId);
							if (cand && (edge.similarity ?? 0) > bestSim) {
								bestSim = edge.similarity ?? 0;
								bestNext = cand;
							}
						} else if (tId === current.id) {
							const cand = [...remaining].find((n) => n.id === sId);
							if (cand && (edge.similarity ?? 0) > bestSim) {
								bestSim = edge.similarity ?? 0;
								bestNext = cand;
							}
						}
					}
				}

				if (!bestNext) {
					// Fallback to first remaining
					bestNext = remaining.values().next().value!;
				}

				orderedH1.push(bestNext);
				remaining.delete(bestNext);
				current = bestNext;
			}
		}

		const h1Angles = new Map<string, number>();
		const h1Count = Math.max(1, orderedH1.length);
		orderedH1.forEach((h1, i) => {
			const angle = (i / h1Count) * Math.PI * 2 - Math.PI / 2;
			h1Angles.set(h1.id, angle);
		});

		const nodePosMap = new Map<string, { x: number; y: number; angle: number }>();

		// 1. Seed position
		const seedNode = data.nodes.find((n) => n.isSeed);
		if (seedNode) {
			const existing = existingPositions.get(seedNode.id);
			if (!isNewSeed && existing && existing.x !== undefined && existing.y !== undefined) {
				nodePosMap.set(seedNode.id, { x: existing.x, y: existing.y, angle: 0 });
			} else {
				nodePosMap.set(seedNode.id, { x: cx, y: cy, angle: 0 });
			}
		}

		// 2. Hop-1 positions
		orderedH1.forEach((h1) => {
			const existing = existingPositions.get(h1.id);
			if (!isNewSeed && existing && existing.x !== undefined && existing.y !== undefined) {
				const angle = Math.atan2(existing.y - cy, existing.x - cx);
				nodePosMap.set(h1.id, { x: existing.x, y: existing.y, angle });
				return;
			}
			let score = h1.similarity ?? 0.6;
			if (score > 1.0) score = 1 / (1 + Math.exp(-score));
			const norm = Math.max(0, Math.min(1, (score - 0.4) / 0.55));

			const angle = h1Angles.get(h1.id) ?? 0;
			const minRadial = 90 * scale;
			const maxRadial = 250 * scale;
			const r = minRadial + (1 - norm) * (maxRadial - minRadial);
			nodePosMap.set(h1.id, {
				x: cx + Math.cos(angle) * r,
				y: cy + Math.sin(angle) * r,
				angle,
			});
		});

		// 3. Group hop-2 nodes by parent
		const satellitesByParent = new Map<string, GraphNode[]>();
		data.nodes.forEach((n) => {
			if (n.hop > 1 && n.parentId) {
				const list = satellitesByParent.get(n.parentId) ?? [];
				list.push(n);
				satellitesByParent.set(n.parentId, list);
			}
		});

		// 4. Map all nodes to simulation format
		this.nodes = data.nodes.map((n) => {
			const existing = existingPositions.get(n.id);

			if (n.isSeed) {
				const pos = nodePosMap.get(n.id) ?? { x: cx, y: cy };
				return {
					...n,
					x: pos.x,
					y: pos.y,
					fx: pos.x,
					fy: pos.y,
				};
			}

			if (!isNewSeed && existing && existing.x !== undefined && existing.y !== undefined) {
				return {
					...n,
					x: existing.x,
					y: existing.y,
					vx: existing.vx,
					vy: existing.vy,
				};
			}

			if (n.hop === 1) {
				const pos = nodePosMap.get(n.id) ?? { x: cx, y: cy };
				return {
					...n,
					x: pos.x,
					y: pos.y,
				};
			}

			// Hop > 1 (satellites)
			if (n.parentId && nodePosMap.has(n.parentId)) {
				const parentPos = nodePosMap.get(n.parentId)!;
				const siblings = satellitesByParent.get(n.parentId) ?? [n];
				const sibIndex = siblings.findIndex((s) => s.id === n.id);
				const totalSibs = Math.max(1, siblings.length);
				const spread = 0.35; // radians spread between satellites
				const satAngleOffset = (sibIndex - (totalSibs - 1) / 2) * spread;
				const satAngle = parentPos.angle + satAngleOffset;
				const satDist = 58 * scale;
				return {
					...n,
					x: parentPos.x + Math.cos(satAngle) * satDist,
					y: parentPos.y + Math.sin(satAngle) * satDist,
				};
			}

			return {
				...n,
				x: cx + (Math.random() - 0.5) * 100 * scale,
				y: cy + (Math.random() - 0.5) * 100 * scale,
			};
		});

		// Deep clone edges for D3 simulation mutation
		this.edges = data.edges.map((e) => ({
			...e,
			source: getEndpointId(e.source),
			target: getEndpointId(e.target),
		}));

		this.centerForce.x(cx);
		this.centerForce.y(cy);
		this.updateForces(scale);

		this.simulation.nodes(this.nodes);
		this.linkForce.links(this.edges);
		this.simulation.alpha(0.8).restart();
		this.requestRender();
	}

	getNodeAt(clientX: number, clientY: number): GraphNode | null {
		const rect = this.canvas.getBoundingClientRect?.() ?? {
			left: 0,
			top: 0,
			width: 800,
			height: 600,
		};
		const localX = clientX - rect.left;
		const localY = clientY - rect.top;
		const worldX = (localX - this.panX) / this.zoom;
		const worldY = (localY - this.panY) / this.zoom;

		for (let i = this.nodes.length - 1; i >= 0; i--) {
			const node = this.nodes[i];
			if (!node || node.x === undefined || node.y === undefined) continue;
			const radius = (node.radius ?? 8) + 6;
			const dx = worldX - node.x;
			const dy = worldY - node.y;
			if (dx * dx + dy * dy <= radius * radius) {
				return node;
			}
		}
		return null;
	}

	handleClick(clientX: number, clientY: number): void {
		const node = this.getNodeAt(clientX, clientY);
		if (node) {
			this.options.onNodeClick?.(node);
		}
	}

	handleDoubleClick(clientX: number, clientY: number): void {
		const node = this.getNodeAt(clientX, clientY);
		if (node) {
			this.options.onNodeDoubleClick?.(node);
		}
	}

	private setupEventListeners(): void {
		this.canvas.addEventListener('wheel', this.onWheel);
		this.canvas.addEventListener('pointerdown', this.onPointerDown);
		this.canvas.addEventListener('pointermove', this.onPointerMove);
		this.canvas.addEventListener('pointerup', this.onPointerUp);
		this.canvas.addEventListener('click', this.onClick);
		this.canvas.addEventListener('dblclick', this.onDblClick);
	}

	private onWheel = (e: WheelEvent): void => {
		this.tooltipEl.addClass('is-hidden');
		e.preventDefault?.();
		const zoomFactor = e.deltaY < 0 ? 1.1 : 0.9;
		const newZoom = Math.max(0.2, Math.min(4.0, this.zoom * zoomFactor));

		const rect = this.canvas.getBoundingClientRect?.() ?? { left: 0, top: 0 };
		const mouseX = e.clientX - rect.left;
		const mouseY = e.clientY - rect.top;

		this.panX = mouseX - (mouseX - this.panX) * (newZoom / this.zoom);
		this.panY = mouseY - (mouseY - this.panY) * (newZoom / this.zoom);
		this.zoom = newZoom;
		this.requestRender();
	};

	private onPointerDown = (e: PointerEvent): void => {
		this.tooltipEl.addClass('is-hidden');
		this.hasDragged = false;
		this.dragStartX = e.clientX;
		this.dragStartY = e.clientY;

		const node = this.getNodeAt(e.clientX, e.clientY);
		if (node) {
			this.draggedNode = node;
			node.fx = node.x;
			node.fy = node.y;
			this.simulation.alphaTarget(0.3).restart();
		} else {
			this.isDraggingCanvas = true;
			this.canvas.addClass('is-grabbing');
		}
	};

	private onPointerMove = (e: PointerEvent): void => {
		const dx = e.clientX - this.dragStartX;
		const dy = e.clientY - this.dragStartY;
		if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
			this.hasDragged = true;
		}

		if (this.draggedNode) {
			this.tooltipEl.addClass('is-hidden');
			const rect = this.canvas.getBoundingClientRect?.() ?? { left: 0, top: 0 };
			const localX = e.clientX - rect.left;
			const localY = e.clientY - rect.top;
			this.draggedNode.fx = (localX - this.panX) / this.zoom;
			this.draggedNode.fy = (localY - this.panY) / this.zoom;
			this.requestRender();
			return;
		}

		if (this.isDraggingCanvas) {
			this.tooltipEl.addClass('is-hidden');
			this.panX += e.movementX ?? dx;
			this.panY += e.movementY ?? dy;
			this.dragStartX = e.clientX;
			this.dragStartY = e.clientY;
			this.requestRender();
			return;
		}

		// Hover hit testing
		const hovered = this.getNodeAt(e.clientX, e.clientY);
		if (hovered !== this.hoveredNode) {
			this.hoveredNode = hovered;
			this.canvas.toggleClass('is-hovering-node', hovered !== null);
			this.options.onNodeHover?.(hovered);
			this.updateTooltip(hovered, e.clientX, e.clientY);
			this.requestRender();
		} else if (hovered && !hovered.isSeed && hovered.sneakPeek && hovered.sneakPeek.length > 0) {
			this.positionTooltip(e.clientX, e.clientY);
		}
	};

	private updateTooltip(node: GraphNode | null, clientX: number, clientY: number): void {
		if (!this.tooltipEl) return;
		if (!this.options.enableTooltip || !node || node.isSeed || !node.sneakPeek || node.sneakPeek.length === 0) {
			this.tooltipEl.addClass('is-hidden');
			return;
		}

		this.tooltipEl.empty();
		this.tooltipEl.createDiv({
			cls: 'brain-context-graph-tooltip-header',
			text: 'Connections',
		});
		const list = this.tooltipEl.createDiv({
			cls: 'brain-context-graph-tooltip-list',
		});
		node.sneakPeek.slice(0, 5).forEach((title, idx) => {
			const item = list.createDiv({
				cls: 'brain-context-graph-tooltip-item',
			});
			item.createSpan({
				cls: 'brain-context-graph-tooltip-number',
				text: `${idx + 1}.`,
			});
			item.createSpan({
				cls: 'brain-context-graph-tooltip-text',
				text: title,
			});
		});

		this.positionTooltip(clientX, clientY);
		this.tooltipEl.removeClass('is-hidden');
	}

	private positionTooltip(clientX: number, clientY: number): void {
		if (!this.tooltipEl) return;
		const rect = this.container.getBoundingClientRect?.() ?? {
			left: 0,
			top: 0,
			width: 800,
			height: 600,
		};
		const localX = clientX - rect.left;
		const localY = clientY - rect.top;

		if (this.tooltipEl.style) {
			this.tooltipEl.style.left = `${localX + 14}px`;
			this.tooltipEl.style.top = `${localY + 14}px`;
		}
	}

	private onPointerUp = (): void => {
		if (this.draggedNode) {
			if (this.draggedNode.isSeed) {
				this.draggedNode.fx = this.draggedNode.x;
				this.draggedNode.fy = this.draggedNode.y;
			} else {
				this.draggedNode.fx = null;
				this.draggedNode.fy = null;
			}
			this.draggedNode = null;
			this.simulation.alphaTarget(0);
		}
		this.isDraggingCanvas = false;
		this.canvas.removeClass('is-grabbing');
		this.canvas.toggleClass('is-hovering-node', this.hoveredNode !== null);
	};

	private onClick = (e: MouseEvent): void => {
		if (!this.hasDragged) {
			this.handleClick(e.clientX, e.clientY);
		}
	};

	private onDblClick = (e: MouseEvent): void => {
		this.handleDoubleClick(e.clientX, e.clientY);
	};

	private setupResizeObserver(): void {
		if (typeof ResizeObserver !== 'undefined') {
			this.resizeObserver = new ResizeObserver(() => {
				this.resize();
			});
			this.resizeObserver.observe(this.container);
		}
	}

	resize(): void {
		const rect = this.container.getBoundingClientRect?.() ?? { width: 800, height: 600 };
		const width = Math.max(100, rect.width || 800);
		const height = Math.max(100, rect.height || 600);
		const cx = width / 2;
		const cy = height / 2;
		const minDim = Math.min(width, height);
		const scale = Math.max(0.65, Math.min(2.0, minDim / 550));

		const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
		this.canvas.width = width * dpr;
		this.canvas.height = height * dpr;

		if (this.canvas.style) {
			this.canvas.style.width = `${width}px`;
			this.canvas.style.height = `${height}px`;
		}

		if (this.ctx && typeof this.ctx.scale === 'function') {
			this.ctx.scale(dpr, dpr);
		}

		this.centerForce.x(cx);
		this.centerForce.y(cy);

		const seed = this.nodes.find((n) => n.isSeed);
		if (seed && (!this.draggedNode || this.draggedNode !== seed)) {
			seed.fx = cx;
			seed.fy = cy;
		}

		this.updateForces(scale);
		this.simulation.alpha(0.3).restart();
		this.requestRender();
	}

	private requestRender(): void {
		if (this.animFrameId !== null) return;
		if (
			typeof window !== 'undefined' &&
			typeof window.requestAnimationFrame === 'function'
		) {
			this.animFrameId = window.requestAnimationFrame(() => {
				this.animFrameId = null;
				this.render();
			});
		} else {
			this.render();
		}
	}

	render(): void {
		const ctx = this.ctx;
		if (!ctx) return;

		const rect = this.canvas.getBoundingClientRect?.() ?? { width: 800, height: 600 };
		const width = rect.width || 800;
		const height = rect.height || 600;

		ctx.clearRect?.(0, 0, width, height);
		ctx.save?.();

		ctx.translate?.(this.panX, this.panY);
		ctx.scale?.(this.zoom, this.zoom);

		// Get Obsidian theme CSS variables
		const styles =
			typeof window !== 'undefined' && typeof getComputedStyle === 'function' && document.body
				? getComputedStyle(document.body)
				: null;

		const textNormal = styles?.getPropertyValue('--text-normal')?.trim() || '#dcddde';
		const textMuted = styles?.getPropertyValue('--text-muted')?.trim() || '#8e8e8e';
		const accentColor = styles?.getPropertyValue('--interactive-accent')?.trim() || '#7c3aed';
		const borderColor = styles?.getPropertyValue('--background-modifier-border')?.trim() || '#363636';
		const bgPrimary = styles?.getPropertyValue('--background-primary')?.trim() || '#181818';

		const containerStyle =
			typeof window !== 'undefined' && typeof getComputedStyle === 'function' && this.canvas.parentElement
				? getComputedStyle(this.canvas.parentElement)
				: null;
		const canvasBg =
			containerStyle?.backgroundColor &&
			containerStyle.backgroundColor !== 'transparent' &&
			containerStyle.backgroundColor !== 'rgba(0, 0, 0, 0)'
				? containerStyle.backgroundColor
				: bgPrimary;

		const hovered = this.hoveredNode;
		const connectedNodeIds = new Set<string>();
		const connectedEdgeIds = new Set<string>();

		if (hovered) {
			connectedNodeIds.add(hovered.id);

			// Direct edges and immediate neighbors
			for (const edge of this.edges) {
				const sId = getEndpointId(edge.source);
				const tId = getEndpointId(edge.target);
				if (sId === hovered.id || tId === hovered.id) {
					connectedEdgeIds.add(edge.id);
					connectedNodeIds.add(sId);
					connectedNodeIds.add(tId);
				}
			}

			// Ancestry path: If hovered is a 2-hop satellite, also highlight its 1-hop parent's primary spoke to seed
			if (hovered.hop === 2 && hovered.parentId) {
				connectedNodeIds.add(hovered.parentId);
				for (const edge of this.edges) {
					const sId = getEndpointId(edge.source);
					const tId = getEndpointId(edge.target);
					const sourceNode = getEndpointNode(edge.source);
					const targetNode = getEndpointNode(edge.target);
					const isPrimarySpoke =
						(sourceNode?.isSeed && tId === hovered.parentId) ||
						(targetNode?.isSeed && sId === hovered.parentId);
					if (isPrimarySpoke) {
						connectedEdgeIds.add(edge.id);
					}
				}
			}
		}

		// 1. Draw Edges
		for (const edge of this.edges) {
			const source = getEndpointNode(edge.source);
			const target = getEndpointNode(edge.target);
			if (!source || !target || source.x === undefined || target.x === undefined) continue;

			const isHoveredEdge = Boolean(hovered && connectedEdgeIds.has(edge.id));
			const isSeedEdge = source.isSeed || target.isSeed;
			const isSecondary = Boolean(edge.isSecondary || !isSeedEdge);

			// Normalize similarity/rerank score to 0..1 range
			let score = edge.similarity ?? 0.6;
			if (score > 1.0) {
				score = 1 / (1 + Math.exp(-score));
			}
			const normScore = Math.max(0, Math.min(1, (score - 0.4) / 0.55));

			let lineWidth: number;
			let strokeStyle: string;
			let alpha: number;

			if (isSecondary) {
				// Secondary satellite or peer links: uniform fixed hairline
				lineWidth = 1.0;
				if (isHoveredEdge) {
					// Soft translucent accent when active cluster is hovered
					strokeStyle = accentColor;
					alpha = 0.50;
				} else if (hovered) {
					// Other secondary links recede into the background
					strokeStyle = textMuted;
					alpha = 0.05;
				} else {
					// Whisper-soft constellation hairline at rest (delicate ambient wallpaper)
					strokeStyle = textMuted;
					alpha = 0.10;
				}
			} else {
				// Primary seed links: dynamic thickness strictly based on score
				const baseWidth = 1.0 + normScore * 3.2;
				lineWidth = isHoveredEdge ? baseWidth * 1.35 : baseWidth;
				strokeStyle = (isHoveredEdge || !hovered) ? accentColor : borderColor;

				if (isHoveredEdge) {
					alpha = 1.0;
				} else if (hovered) {
					// Other primary spokes fade just a wee bit (~0.90) for subtle contrast
					alpha = 0.90;
				} else {
					// Solid at rest, never faded based on score
					alpha = 1.0;
				}
			}

			ctx.beginPath?.();
			ctx.moveTo?.(source.x, source.y ?? 0);
			ctx.lineTo?.(target.x, target.y ?? 0);
			ctx.strokeStyle = strokeStyle;
			ctx.lineWidth = lineWidth;
			ctx.globalAlpha = alpha;
			ctx.stroke?.();
		}

		// 2. Draw Nodes in stratified visual layers (Z-Index):
		// Layer A: 2-Hop background satellites
		// Layer B: 1-Hop constellation stars (non-hovered)
		// Layer C: Hovered star & Central Protagonist (topmost)
		const hop2Nodes = this.nodes.filter((n) => n.hop === 2 && hovered?.id !== n.id);
		const hop1Nodes = this.nodes.filter((n) => n.hop === 1 && hovered?.id !== n.id);
		const topNodes = this.nodes.filter((n) => n.isSeed || hovered?.id === n.id);

		const renderNode = (node: GraphNode): void => {
			if (node.x === undefined || node.y === undefined) return;

			const isHovered = Boolean(hovered && hovered.id === node.id);
			const isConnected = Boolean(hovered && connectedNodeIds.has(node.id));
			const isHop2 = node.hop === 2;
			const radius = (node.radius ?? (isHop2 ? 4.5 : 8)) * (isHovered ? 1.3 : 1);

			// Radiating ripple rings when in optimistic loading state
			if (node.isSeed && this.optimisticLoading) {
				const elapsed = Date.now() - this.optimisticStartTime;
				const cycleDuration = 1200;
				const maxRippleDist = 20;
				const ripplePhases = [0, 0.5];

				ctx.save?.();
				ctx.strokeStyle = accentColor;
				ctx.lineWidth = 1.5;

				for (const phase of ripplePhases) {
					const progress = ((elapsed + phase * cycleDuration) % cycleDuration) / cycleDuration;
					const rippleRadius = radius + 2 + progress * maxRippleDist;
					const rippleAlpha = (1 - progress) * 0.65;

					ctx.beginPath?.();
					ctx.arc?.(node.x, node.y, rippleRadius, 0, Math.PI * 2);
					ctx.globalAlpha = rippleAlpha;
					ctx.stroke?.();
				}

				ctx.restore?.();
			}

			// Node Opacity & Fill/Stroke styling
			let nodeAlpha = 1.0;
			let fillStyle = canvasBg;
			let strokeStyle = textMuted;
			let strokeWidth = 1.5;

			if (node.isSeed) {
				// Protagonist
				nodeAlpha = 1.0;
				fillStyle = accentColor;
				strokeStyle = accentColor;
				strokeWidth = 2.0;
			} else if (isHop2) {
				// 2-Hop Ambient Satellites
				if (isHovered || isConnected) {
					nodeAlpha = 0.95;
					fillStyle = isHovered ? accentColor : canvasBg;
					strokeStyle = accentColor;
					strokeWidth = isHovered ? 2.0 : 1.3;
				} else if (hovered) {
					nodeAlpha = 0.12;
					fillStyle = canvasBg;
					strokeStyle = textMuted;
					strokeWidth = 0.8;
				} else {
					nodeAlpha = 0.30;
					fillStyle = canvasBg;
					strokeStyle = textMuted;
					strokeWidth = 1.0;
				}
			} else {
				// 1-Hop Major Constellation Stars
				if (isHovered || isConnected) {
					nodeAlpha = 1.0;
					fillStyle = isHovered ? accentColor : canvasBg;
					strokeStyle = accentColor;
					strokeWidth = isHovered ? 2.5 : 2.0;
				} else if (hovered) {
					nodeAlpha = 0.90;
					fillStyle = canvasBg;
					strokeStyle = borderColor;
					strokeWidth = 1.5;
				} else {
					nodeAlpha = 1.0;
					fillStyle = canvasBg;
					strokeStyle = accentColor;
					strokeWidth = 1.8;
				}
			}

			// Circle fill
			ctx.beginPath?.();
			ctx.arc?.(node.x, node.y, radius, 0, Math.PI * 2);
			ctx.fillStyle = fillStyle;
			ctx.globalAlpha = nodeAlpha;
			ctx.fill?.();

			// Circle stroke
			ctx.strokeStyle = strokeStyle;
			ctx.lineWidth = strokeWidth;
			ctx.stroke?.();

			// Label
			let showLabel = false;
			if (node.isSeed) {
				showLabel = true;
			} else if (node.hop === 1) {
				showLabel = true;
			} else if (isHop2) {
				showLabel = Boolean(isHovered || isConnected);
			}

			if (showLabel) {
				const fontSize = isHop2 ? 9 : 11;
				ctx.font = `${node.isSeed ? 'bold ' : ''}${Math.round(fontSize / Math.sqrt(this.zoom))}px sans-serif`;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'top';

				// Determine label position: offset satellites outward from parent
				let lx = node.x;
				let ly = node.y + radius + 4;
				if (isHop2 && node.parentId) {
					const parent = this.nodes.find((n) => n.id === node.parentId);
					if (parent && parent.x !== undefined && parent.y !== undefined) {
						const dx = node.x - parent.x;
						const dy = node.y - parent.y;
						const len = Math.hypot(dx, dy) || 1;
						lx = node.x + (dx / len) * (radius + 6);
						ly = node.y + (dy / len) * (radius + 6);
						if (dy < -5) {
							ctx.textBaseline = 'bottom';
						} else if (Math.abs(dy) <= 5) {
							ctx.textBaseline = 'middle';
							ctx.textAlign = dx > 0 ? 'left' : 'right';
						}
					}
				}

				const textFill = node.isSeed ? accentColor : isHop2 ? textMuted : (isHovered ? accentColor : textNormal);
				const textAlpha = isHop2 ? 0.85 : (!hovered || isHovered ? 0.95 : 0.90);

				// Canvas text halo behind every label to prevent letters being sliced by lines/dots
				ctx.save?.();
				ctx.strokeStyle = canvasBg;
				ctx.lineWidth = 3.5 / Math.sqrt(this.zoom);
				ctx.lineJoin = 'round';
				ctx.globalAlpha = textAlpha * 0.9;
				ctx.strokeText?.(node.label, lx, ly);
				ctx.restore?.();

				ctx.fillStyle = textFill;
				ctx.globalAlpha = textAlpha;
				ctx.fillText?.(node.label, lx, ly);
			}
		};

		// Draw passes from lowest layer to topmost layer
		for (const n of hop2Nodes) renderNode(n);
		for (const n of hop1Nodes) renderNode(n);
		for (const n of topNodes) renderNode(n);

		ctx.restore?.();
	}

	destroy(): void {
		if (this.animFrameId !== null) {
			if (
				typeof window !== 'undefined' &&
				typeof window.cancelAnimationFrame === 'function'
			) {
				window.cancelAnimationFrame(this.animFrameId);
			} else if (typeof cancelAnimationFrame === 'function') {
				cancelAnimationFrame(this.animFrameId);
			}
			this.animFrameId = null;
		}
		this.stopLoadingGlow();
		this.simulation.stop();
		this.resizeObserver?.disconnect();
		this.resizeObserver = null;

		this.canvas.removeEventListener('wheel', this.onWheel);
		this.canvas.removeEventListener('pointerdown', this.onPointerDown);
		this.canvas.removeEventListener('pointermove', this.onPointerMove);
		this.canvas.removeEventListener('pointerup', this.onPointerUp);
		this.canvas.removeEventListener('click', this.onClick);
		this.canvas.removeEventListener('dblclick', this.onDblClick);

		this.canvas.remove?.();
		this.tooltipEl?.remove?.();
	}
}
