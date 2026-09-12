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
				if (d.isSeed) return 0;
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
		this.linkForce.distance((edge) => {
			let score = edge.similarity ?? 0.6;
			if (score > 1.0) score = 1 / (1 + Math.exp(-score));
			const normScore = Math.max(0, Math.min(1, (score - 0.4) / 0.55));

			const minLinkDist = 80 * scale;
			const maxLinkDist = 240 * scale;
			return minLinkDist + (1 - normScore) * (maxLinkDist - minLinkDist);
		});

		this.simulation.force(
			'charge',
			forceManyBody<GraphNode>().strength((d) => (d.isSeed ? -350 * scale : -140 * scale)),
		);

		this.radialForce
			.radius((d: GraphNode) => {
				if (d.isSeed) return 0;
				let score = d.similarity ?? 0.6;
				if (score > 1.0) score = 1 / (1 + Math.exp(-score));
				const norm = Math.max(0, Math.min(1, (score - 0.4) / 0.55));
				const minRadial = 90 * scale;
				const maxRadial = 250 * scale;
				return minRadial + (1 - norm) * (maxRadial - minRadial);
			})
			.strength((d: GraphNode) => (d.isSeed ? 1.0 : 0.75));

		this.simulation.force(
			'collide',
			forceCollide<GraphNode>((d) => (d.radius ?? 8) + 24 * scale).iterations(3),
		);
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
		const h1Angles = new Map<string, number>();
		const h1Count = Math.max(1, hop1Nodes.length);
		hop1Nodes.forEach((h1, i) => {
			const angle = (i / h1Count) * Math.PI * 2 - Math.PI / 2;
			h1Angles.set(h1.id, angle);
		});

		this.nodes = data.nodes.map((n) => {
			const existing = existingPositions.get(n.id);

			if (n.isSeed) {
				if (!isNewSeed && existing && existing.x !== undefined && existing.y !== undefined) {
					return {
						...n,
						x: existing.x,
						y: existing.y,
						fx: existing.x,
						fy: existing.y,
					};
				}
				return {
					...n,
					x: cx,
					y: cy,
					fx: cx,
					fy: cy,
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

			let score = n.similarity ?? 0.6;
			if (score > 1.0) score = 1 / (1 + Math.exp(-score));
			const norm = Math.max(0, Math.min(1, (score - 0.4) / 0.55));

			const angle = h1Angles.get(n.id) ?? 0;
			const minRadial = 90 * scale;
			const maxRadial = 250 * scale;
			const r = minRadial + (1 - norm) * (maxRadial - minRadial);
			return {
				...n,
				x: cx + Math.cos(angle) * r,
				y: cy + Math.sin(angle) * r,
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
		if (!node || node.isSeed || !node.sneakPeek || node.sneakPeek.length === 0) {
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
		const bgSecondary = styles?.getPropertyValue('--background-secondary')?.trim() || '#202020';

		const hovered = this.hoveredNode;
		const connectedNodeIds = new Set<string>();
		const connectedEdgeIds = new Set<string>();

		if (hovered) {
			connectedNodeIds.add(hovered.id);
			for (const edge of this.edges) {
				const sId = getEndpointId(edge.source);
				const tId = getEndpointId(edge.target);
				if (sId === hovered.id || tId === hovered.id) {
					connectedEdgeIds.add(edge.id);
					connectedNodeIds.add(sId);
					connectedNodeIds.add(tId);
				}
			}
		}

		// 1. Draw Edges
		for (const edge of this.edges) {
			const source = getEndpointNode(edge.source);
			const target = getEndpointNode(edge.target);
			if (!source || !target || source.x === undefined || target.x === undefined) continue;

			const isHoveredEdge = hovered && connectedEdgeIds.has(edge.id);
			const isDimmed = hovered && !isHoveredEdge;
			const isSeedEdge = source.isSeed || target.isSeed;

			// Normalize similarity/rerank score to 0..1 range
			let score = edge.similarity ?? 0.6;
			if (score > 1.0) {
				score = 1 / (1 + Math.exp(-score));
			}
			const normScore = Math.max(0, Math.min(1, (score - 0.4) / 0.55));

			// Edge thickness corresponds directly to final score:
			// Weak match: ~1.2px, strong match: ~4.2px
			const baseWidth = 1.0 + normScore * 3.2;
			const isHighlighted = isHoveredEdge || (!hovered && isSeedEdge);
			const lineWidth = isHighlighted ? baseWidth * 1.35 : baseWidth;

			// Edge opacity:
			// When a node is hovered, non-connected edges dim to 0.05.
			// When no node is hovered, seed edges are vibrant in accent color, while outer edges remain subtly visible.
			let alpha: number;
			if (isHoveredEdge) {
				alpha = 0.95;
			} else if (isDimmed) {
				alpha = 0.05;
			} else if (isSeedEdge) {
				alpha = 0.55 + normScore * 0.4;
			} else {
				alpha = 0.2 + normScore * 0.35;
			}

			ctx.beginPath?.();
			ctx.moveTo?.(source.x, source.y ?? 0);
			ctx.lineTo?.(target.x, target.y ?? 0);
			ctx.strokeStyle = isHighlighted ? accentColor : borderColor;
			ctx.lineWidth = lineWidth;
			ctx.globalAlpha = alpha;
			ctx.stroke?.();
		}

		// 2. Draw Nodes
		for (const node of this.nodes) {
			if (node.x === undefined || node.y === undefined) continue;

			const isHovered = hovered && hovered.id === node.id;
			const isConnected = hovered && connectedNodeIds.has(node.id);
			const isDimmed = hovered && !isConnected;

			const radius = (node.radius ?? 8) * (isHovered ? 1.3 : 1);

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

			// Circle fill
			ctx.beginPath?.();
			ctx.arc?.(node.x, node.y, radius, 0, Math.PI * 2);
			ctx.fillStyle = node.isSeed ? accentColor : isHovered ? accentColor : bgSecondary;
			ctx.globalAlpha = isDimmed ? 0.25 : 1.0;
			ctx.fill?.();

			// Circle stroke: Seed and Hop 1 nodes show accentColor stroke in default resting state
			const isAccentStroke = node.isSeed || isHovered || isConnected || (!hovered && node.hop === 1);
			ctx.strokeStyle = isAccentStroke ? accentColor : borderColor;
			ctx.lineWidth = isHovered ? 2.5 : node.isSeed ? 2 : 1.5;
			ctx.stroke?.();

			// Label
			const showLabel = node.isSeed || node.hop <= 1 || isHovered || this.zoom > 1.2;
			if (showLabel) {
				ctx.font = `${node.isSeed ? 'bold ' : ''}${Math.round(11 / Math.sqrt(this.zoom))}px sans-serif`;
				ctx.textAlign = 'center';
				ctx.textBaseline = 'top';
				ctx.fillStyle = node.isSeed ? accentColor : node.hop <= 1 ? textNormal : textMuted;
				ctx.globalAlpha = isDimmed ? 0.2 : 0.95;
				ctx.fillText?.(node.label, node.x, node.y + radius + 4);
			}
		}

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
