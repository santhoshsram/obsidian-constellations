/** Canvas drawing for the context graph: theme colors, edges, nodes, and labels. */

import type { GraphNode, GraphEdge } from '../../search/graph';
import {
	normalizeSimilarity,
	DEFAULT_CANVAS_WIDTH,
	DEFAULT_CANVAS_HEIGHT,
	EDGE_ALPHA_SECONDARY_HOVERED,
	EDGE_ALPHA_SECONDARY_DIMMED,
	EDGE_ALPHA_SECONDARY_REST,
	EDGE_ALPHA_PRIMARY_DIMMED,
	EDGE_PRIMARY_BASE_WIDTH,
	EDGE_PRIMARY_WIDTH_SCALE,
	EDGE_PRIMARY_HOVER_WIDTH_MULT,
	NODE_ALPHA_HOP2_ACTIVE,
	NODE_ALPHA_HOP2_DIMMED,
	NODE_ALPHA_HOP2_REST,
	NODE_ALPHA_HOP1_DIMMED,
	NODE_STROKE_SEED,
	NODE_STROKE_HOP2_HOVERED,
	NODE_STROKE_HOP2_CONNECTED,
	NODE_STROKE_HOP2_DIMMED,
	NODE_STROKE_HOP2_REST,
	NODE_STROKE_HOP1_HOVERED,
	NODE_STROKE_HOP1_CONNECTED,
	NODE_STROKE_HOP1_DIMMED,
	NODE_STROKE_HOP1_REST,
	NODE_HOVER_RADIUS_MULT,
	NODE_RADIUS_HOP2_DEFAULT,
	NODE_RADIUS_DEFAULT,
	LABEL_FONT_SIZE_HOP2,
	LABEL_FONT_SIZE_DEFAULT,
	LABEL_ALPHA_HOP2,
	LABEL_ALPHA_DIMMED,
	LABEL_ALPHA_REST,
	LABEL_HALO_WIDTH,
	LABEL_HALO_ALPHA_MULT,
	OPTIMISTIC_RIPPLE_CYCLE_MS,
	OPTIMISTIC_RIPPLE_MAX_DIST,
	OPTIMISTIC_RIPPLE_PHASES,
} from './graph-constants';

function getEndpointId(endpoint: string | GraphNode): string {
	return typeof endpoint === 'object' ? endpoint.id : endpoint;
}

function getEndpointNode(endpoint: string | GraphNode): GraphNode | null {
	return typeof endpoint === 'object' ? endpoint : null;
}

export interface ThemeColors {
	textNormal: string;
	textMuted: string;
	accentColor: string;
	borderColor: string;
	canvasBg: string;
}

/** Reads the current Obsidian theme's CSS custom properties, with sane fallbacks. */
export function readThemeColors(canvas: HTMLCanvasElement): ThemeColors {
	const styles = getComputedStyle(document.body);

	const textNormal = styles.getPropertyValue('--text-normal').trim() || '#dcddde';
	const textMuted = styles.getPropertyValue('--text-muted').trim() || '#8e8e8e';
	const accentColor = styles.getPropertyValue('--interactive-accent').trim() || '#7c3aed';
	const borderColor = styles.getPropertyValue('--background-modifier-border').trim() || '#363636';
	const bgPrimary = styles.getPropertyValue('--background-primary').trim() || '#181818';

	const containerStyle = canvas.parentElement ? getComputedStyle(canvas.parentElement) : null;
	const canvasBg =
		containerStyle?.backgroundColor &&
		containerStyle.backgroundColor !== 'transparent' &&
		containerStyle.backgroundColor !== 'rgba(0, 0, 0, 0)'
			? containerStyle.backgroundColor
			: bgPrimary;

	return { textNormal, textMuted, accentColor, borderColor, canvasBg };
}

export interface HoverConnections {
	connectedNodeIds: Set<string>;
	connectedEdgeIds: Set<string>;
}

/** Computes which nodes/edges should be visually highlighted for the current hover target. */
export function computeHoverConnections(hovered: GraphNode | null, edges: GraphEdge[]): HoverConnections {
	const connectedNodeIds = new Set<string>();
	const connectedEdgeIds = new Set<string>();
	if (!hovered) return { connectedNodeIds, connectedEdgeIds };

	connectedNodeIds.add(hovered.id);

	for (const edge of edges) {
		const sId = getEndpointId(edge.source);
		const tId = getEndpointId(edge.target);
		if (sId === hovered.id || tId === hovered.id) {
			connectedEdgeIds.add(edge.id);
			connectedNodeIds.add(sId);
			connectedNodeIds.add(tId);
		}
	}

	// A hovered 2-hop satellite also highlights its 1-hop parent's primary spoke to the seed.
	if (hovered.hop === 2 && hovered.parentId) {
		connectedNodeIds.add(hovered.parentId);
		for (const edge of edges) {
			const sId = getEndpointId(edge.source);
			const tId = getEndpointId(edge.target);
			const sourceNode = getEndpointNode(edge.source);
			const targetNode = getEndpointNode(edge.target);
			const isPrimarySpoke =
				(sourceNode?.isSeed && tId === hovered.parentId) || (targetNode?.isSeed && sId === hovered.parentId);
			if (isPrimarySpoke) {
				connectedEdgeIds.add(edge.id);
			}
		}
	}

	return { connectedNodeIds, connectedEdgeIds };
}

function drawEdge(
	ctx: CanvasRenderingContext2D,
	edge: GraphEdge,
	source: GraphNode,
	target: GraphNode,
	hovered: GraphNode | null,
	connectedEdgeIds: Set<string>,
	theme: ThemeColors,
): void {
	const isHoveredEdge = Boolean(hovered && connectedEdgeIds.has(edge.id));
	const isSeedEdge = source.isSeed || target.isSeed;
	const isSecondary = Boolean(edge.isSecondary || !isSeedEdge);
	const normScore = normalizeSimilarity(edge.similarity ?? 0.6);

	let lineWidth: number;
	let strokeStyle: string;
	let alpha: number;

	if (isSecondary) {
		lineWidth = 1.0;
		if (isHoveredEdge) {
			strokeStyle = theme.accentColor;
			alpha = EDGE_ALPHA_SECONDARY_HOVERED;
		} else if (hovered) {
			strokeStyle = theme.textMuted;
			alpha = EDGE_ALPHA_SECONDARY_DIMMED;
		} else {
			strokeStyle = theme.textMuted;
			alpha = EDGE_ALPHA_SECONDARY_REST;
		}
	} else {
		const baseWidth = EDGE_PRIMARY_BASE_WIDTH + normScore * EDGE_PRIMARY_WIDTH_SCALE;
		lineWidth = isHoveredEdge ? baseWidth * EDGE_PRIMARY_HOVER_WIDTH_MULT : baseWidth;
		strokeStyle = isHoveredEdge || !hovered ? theme.accentColor : theme.borderColor;
		alpha = isHoveredEdge || !hovered ? 1.0 : EDGE_ALPHA_PRIMARY_DIMMED;
	}

	ctx.beginPath();
	ctx.moveTo(source.x!, source.y ?? 0);
	ctx.lineTo(target.x!, target.y ?? 0);
	ctx.strokeStyle = strokeStyle;
	ctx.lineWidth = lineWidth;
	ctx.globalAlpha = alpha;
	ctx.stroke();
}

/** Draws all edges whose endpoints are both positioned, applying hover-based highlight styling. */
export function renderEdges(
	ctx: CanvasRenderingContext2D,
	edges: GraphEdge[],
	hovered: GraphNode | null,
	connectedEdgeIds: Set<string>,
	theme: ThemeColors,
): void {
	for (const edge of edges) {
		const source = getEndpointNode(edge.source);
		const target = getEndpointNode(edge.target);
		if (!source || !target || source.x === undefined || target.x === undefined) continue;
		drawEdge(ctx, edge, source, target, hovered, connectedEdgeIds, theme);
	}
}

interface NodeStyle {
	nodeAlpha: number;
	fillStyle: string;
	strokeStyle: string;
	strokeWidth: number;
}

function styleForNode(
	node: GraphNode,
	isHovered: boolean,
	isConnected: boolean,
	isHop2: boolean,
	hovered: GraphNode | null,
	theme: ThemeColors,
): NodeStyle {
	if (node.isSeed) {
		return { nodeAlpha: 1.0, fillStyle: theme.accentColor, strokeStyle: theme.accentColor, strokeWidth: NODE_STROKE_SEED };
	}
	if (isHop2) {
		if (isHovered || isConnected) {
			return {
				nodeAlpha: NODE_ALPHA_HOP2_ACTIVE,
				fillStyle: isHovered ? theme.accentColor : theme.canvasBg,
				strokeStyle: theme.accentColor,
				strokeWidth: isHovered ? NODE_STROKE_HOP2_HOVERED : NODE_STROKE_HOP2_CONNECTED,
			};
		}
		if (hovered) {
			return {
				nodeAlpha: NODE_ALPHA_HOP2_DIMMED,
				fillStyle: theme.canvasBg,
				strokeStyle: theme.textMuted,
				strokeWidth: NODE_STROKE_HOP2_DIMMED,
			};
		}
		return {
			nodeAlpha: NODE_ALPHA_HOP2_REST,
			fillStyle: theme.canvasBg,
			strokeStyle: theme.textMuted,
			strokeWidth: NODE_STROKE_HOP2_REST,
		};
	}
	if (isHovered || isConnected) {
		return {
			nodeAlpha: 1.0,
			fillStyle: isHovered ? theme.accentColor : theme.canvasBg,
			strokeStyle: theme.accentColor,
			strokeWidth: isHovered ? NODE_STROKE_HOP1_HOVERED : NODE_STROKE_HOP1_CONNECTED,
		};
	}
	if (hovered) {
		return {
			nodeAlpha: NODE_ALPHA_HOP1_DIMMED,
			fillStyle: theme.canvasBg,
			strokeStyle: theme.borderColor,
			strokeWidth: NODE_STROKE_HOP1_DIMMED,
		};
	}
	return { nodeAlpha: 1.0, fillStyle: theme.canvasBg, strokeStyle: theme.accentColor, strokeWidth: NODE_STROKE_HOP1_REST };
}

function drawOptimisticRipples(
	ctx: CanvasRenderingContext2D,
	node: GraphNode,
	radius: number,
	optimisticStartTime: number,
	theme: ThemeColors,
): void {
	const elapsedMs = Date.now() - optimisticStartTime;

	ctx.save();
	ctx.strokeStyle = theme.accentColor;
	ctx.lineWidth = 1.5;

	for (const phase of OPTIMISTIC_RIPPLE_PHASES) {
		const progress = ((elapsedMs + phase * OPTIMISTIC_RIPPLE_CYCLE_MS) % OPTIMISTIC_RIPPLE_CYCLE_MS) / OPTIMISTIC_RIPPLE_CYCLE_MS;
		const rippleRadius = radius + 2 + progress * OPTIMISTIC_RIPPLE_MAX_DIST;
		const rippleAlpha = (1 - progress) * 0.65;

		ctx.beginPath();
		ctx.arc(node.x!, node.y!, rippleRadius, 0, Math.PI * 2);
		ctx.globalAlpha = rippleAlpha;
		ctx.stroke();
	}

	ctx.restore();
}

function drawLabel(
	ctx: CanvasRenderingContext2D,
	node: GraphNode,
	radius: number,
	isHop2: boolean,
	isHovered: boolean,
	isConnected: boolean,
	hovered: GraphNode | null,
	zoom: number,
	findParent: (id: string) => GraphNode | undefined,
	theme: ThemeColors,
): void {
	let showLabel = node.isSeed || node.hop === 1;
	if (isHop2) showLabel = isHovered || isConnected;
	if (!showLabel) return;

	const fontSize = isHop2 ? LABEL_FONT_SIZE_HOP2 : LABEL_FONT_SIZE_DEFAULT;
	ctx.font = `${node.isSeed ? 'bold ' : ''}${Math.round(fontSize / Math.sqrt(zoom))}px sans-serif`;
	ctx.textAlign = 'center';
	ctx.textBaseline = 'top';

	let lx = node.x!;
	let ly = node.y! + radius + 4;
	if (isHop2 && node.parentId) {
		const parent = findParent(node.parentId);
		if (parent?.x !== undefined && parent.y !== undefined) {
			const dx = node.x! - parent.x;
			const dy = node.y! - parent.y;
			const len = Math.hypot(dx, dy) || 1;
			lx = node.x! + (dx / len) * (radius + 6);
			ly = node.y! + (dy / len) * (radius + 6);
			if (dy < -5) {
				ctx.textBaseline = 'bottom';
			} else if (Math.abs(dy) <= 5) {
				ctx.textBaseline = 'middle';
				ctx.textAlign = dx > 0 ? 'left' : 'right';
			}
		}
	}

	const textFill = node.isSeed ? theme.accentColor : isHop2 ? theme.textMuted : isHovered ? theme.accentColor : theme.textNormal;
	const textAlpha = isHop2 ? LABEL_ALPHA_HOP2 : !hovered || isHovered ? LABEL_ALPHA_REST : LABEL_ALPHA_DIMMED;

	// Halo behind the label so glyphs aren't sliced by edges/dots crossing underneath.
	ctx.save();
	ctx.strokeStyle = theme.canvasBg;
	ctx.lineWidth = LABEL_HALO_WIDTH / Math.sqrt(zoom);
	ctx.lineJoin = 'round';
	ctx.globalAlpha = textAlpha * LABEL_HALO_ALPHA_MULT;
	ctx.strokeText(node.label, lx, ly);
	ctx.restore();

	ctx.fillStyle = textFill;
	ctx.globalAlpha = textAlpha;
	ctx.fillText(node.label, lx, ly);
}

/** Draws a single node: optimistic-loading ripple, fill/stroke circle, and label. */
export function renderNode(
	ctx: CanvasRenderingContext2D,
	node: GraphNode,
	hovered: GraphNode | null,
	connectedNodeIds: Set<string>,
	optimisticLoading: boolean,
	optimisticStartTime: number,
	zoom: number,
	findParent: (id: string) => GraphNode | undefined,
	theme: ThemeColors,
): void {
	if (node.x === undefined || node.y === undefined) return;

	const isHovered = Boolean(hovered && hovered.id === node.id);
	const isConnected = Boolean(hovered && connectedNodeIds.has(node.id));
	const isHop2 = node.hop === 2;
	const baseRadius = node.radius ?? (isHop2 ? NODE_RADIUS_HOP2_DEFAULT : NODE_RADIUS_DEFAULT);
	const radius = baseRadius * (isHovered ? NODE_HOVER_RADIUS_MULT : 1);

	if (node.isSeed && optimisticLoading) {
		drawOptimisticRipples(ctx, node, radius, optimisticStartTime, theme);
	}

	const style = styleForNode(node, isHovered, isConnected, isHop2, hovered, theme);

	ctx.beginPath();
	ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
	ctx.fillStyle = style.fillStyle;
	ctx.globalAlpha = style.nodeAlpha;
	ctx.fill();

	ctx.strokeStyle = style.strokeStyle;
	ctx.lineWidth = style.strokeWidth;
	ctx.stroke();

	drawLabel(ctx, node, radius, isHop2, isHovered, isConnected, hovered, zoom, findParent, theme);
}

export { DEFAULT_CANVAS_WIDTH, DEFAULT_CANVAS_HEIGHT };
