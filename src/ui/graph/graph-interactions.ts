/** Pointer/wheel input handling and tooltip positioning for the context graph canvas. */

import type { GraphNode } from '../../search/graph';

const ZOOM_MIN = 0.2;
const ZOOM_MAX = 4.0;
const ZOOM_IN_FACTOR = 1.1;
const ZOOM_OUT_FACTOR = 0.9;
const DRAG_THRESHOLD_PX = 3;
const TOOLTIP_OFFSET_PX = 14;

export interface ViewTransform {
	panX: number;
	panY: number;
	zoom: number;
}

/** Computes the updated pan/zoom for a wheel event, keeping the point under the cursor fixed. */
export function applyWheelZoom(
	transform: ViewTransform,
	canvas: HTMLCanvasElement,
	e: WheelEvent,
): ViewTransform {
	const zoomFactor = e.deltaY < 0 ? ZOOM_IN_FACTOR : ZOOM_OUT_FACTOR;
	const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, transform.zoom * zoomFactor));

	const rect = canvas.getBoundingClientRect();
	const mouseX = e.clientX - rect.left;
	const mouseY = e.clientY - rect.top;

	return {
		panX: mouseX - (mouseX - transform.panX) * (newZoom / transform.zoom),
		panY: mouseY - (mouseY - transform.panY) * (newZoom / transform.zoom),
		zoom: newZoom,
	};
}

/** Converts client (viewport) coordinates to world (unpanned/unzoomed) coordinates. */
export function clientToWorld(
	clientX: number,
	clientY: number,
	rect: { left: number; top: number },
	transform: ViewTransform,
): { x: number; y: number } {
	const localX = clientX - rect.left;
	const localY = clientY - rect.top;
	return {
		x: (localX - transform.panX) / transform.zoom,
		y: (localY - transform.panY) / transform.zoom,
	};
}

/** Finds the topmost node whose hit radius contains the given client coordinates. */
export function findNodeAt(
	nodes: GraphNode[],
	clientX: number,
	clientY: number,
	canvas: HTMLCanvasElement,
	transform: ViewTransform,
): GraphNode | null {
	const rect = canvas.getBoundingClientRect();
	const world = clientToWorld(clientX, clientY, rect, transform);

	for (let i = nodes.length - 1; i >= 0; i--) {
		const node = nodes[i];
		if (!node || node.x === undefined || node.y === undefined) continue;
		const radius = (node.radius ?? 8) + 6;
		const dx = world.x - node.x;
		const dy = world.y - node.y;
		if (dx * dx + dy * dy <= radius * radius) {
			return node;
		}
	}
	return null;
}

export function hasDraggedPastThreshold(dx: number, dy: number): boolean {
	return Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX;
}

/** Positions the tooltip element relative to the container, offset from the cursor. */
export function positionTooltip(
	tooltipEl: HTMLElement,
	container: HTMLElement,
	clientX: number,
	clientY: number,
): void {
	const rect = container.getBoundingClientRect();
	const localX = clientX - rect.left;
	const localY = clientY - rect.top;

	tooltipEl.style.left = `${localX + TOOLTIP_OFFSET_PX}px`;
	tooltipEl.style.top = `${localY + TOOLTIP_OFFSET_PX}px`;
}

/** Renders the sneak-peek connection list into the tooltip, or hides it if not applicable. */
export function updateTooltipContent(
	tooltipEl: HTMLElement,
	container: HTMLElement,
	node: GraphNode | null,
	enableTooltip: boolean,
	clientX: number,
	clientY: number,
): void {
	if (!enableTooltip || !node || node.isSeed || !node.sneakPeek || node.sneakPeek.length === 0) {
		tooltipEl.addClass('is-hidden');
		return;
	}

	tooltipEl.empty();
	tooltipEl.createDiv({
		cls: 'constellations-context-graph-tooltip-header',
		text: 'Connections',
	});
	const list = tooltipEl.createDiv({
		cls: 'constellations-context-graph-tooltip-list',
	});
	node.sneakPeek.slice(0, 5).forEach((title, idx) => {
		const item = list.createDiv({
			cls: 'constellations-context-graph-tooltip-item',
		});
		item.createSpan({
			cls: 'constellations-context-graph-tooltip-number',
			text: `${idx + 1}.`,
		});
		item.createSpan({
			cls: 'constellations-context-graph-tooltip-text',
			text: title,
		});
	});

	positionTooltip(tooltipEl, container, clientX, clientY);
	tooltipEl.removeClass('is-hidden');
}
