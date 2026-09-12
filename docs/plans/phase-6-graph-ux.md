# Graph Utility & UX Overhaul

This plan outlines the specific changes to make the Context Graph both elegant and utilitarian, while solving the sluggish UX and minor UI bugs.

## Proposed Changes

### 1. Fix "Open note" tab focusing
**File:** `src/ui/graph/context-graph-modal.ts`
- Currently, clicking "Open note ↗" always opens a new tab or replaces the current one blindly.
- **Fix:** We will iterate over `app.workspace.getLeavesOfType('markdown')`. If a tab is already open with that exact file path, we will simply focus it using `app.workspace.setActiveLeaf(leaf, { focus: true })`. If not, we fall back to opening a new tab.

### 2. Hub-and-Spoke Topology & "Sneak Peek" Tooltip
**File:** `src/search/graph.ts` and `src/ui/graph/context-graph-engine.ts`
- **Topology:** We will modify the `contextGraph` algorithm to remove all "Hop 2" nodes and all peer cross-edges. The graph will become a strict "Hub and Spoke" (the central note connected to its most relevant peers), instantly removing the spiderweb clutter.
- **Sneak Peek Data:** While computing Hop 1 nodes, the algorithm will quickly find the top 3 related notes for each Hop 1 node and store their titles in a new `node.sneakPeek` array. We will NOT render these as nodes.
- **Hover UX:** We will add a sleek HTML-based tooltip in the engine. When you hover over a peripheral node, a frosted-glass popover will appear next to your cursor listing its top 3 related notes in plain text (ordered by relevance, no raw scores).

### 3. Physics: Distance = Relevance
**File:** `src/ui/graph/context-graph-engine.ts`
- We will update the `d3-force` simulation so the spring distance for edges is explicitly tied to semantic relevance.
- Higher AI similarity scores will result in shorter, tighter links to the center. Lower scores will result in longer links, placing them further out in the orbit. 
- We will combine this with `forceCollide` so they arrange themselves gracefully in concentric rings around the center based on their semantic strength.

### 4. Optimistic Centering (Solving the Sluggishness)
**File:** `src/ui/graph/context-graph-modal.ts` & `src/ui/graph/context-graph-engine.ts`
- We will introduce an `optimisticFocus(nodeId, newTitle)` method to the engine.
- When you click a node, instead of waiting 1-2 seconds for the WebGPU cross-encoder, the UI will instantly react:
  1. All other nodes and edges will gracefully fade out and disappear.
  2. The clicked node will animate to the dead center of the screen.
  3. It will begin a soft, pulsing "loading" glow.
- In the background, the heavy `reseed()` operation will run. Once it finishes a second later, the new related nodes will bloom outward from the center. This completely masks the AI latency with a premium, responsive animation.

## Verification Plan

### Manual Verification
- **Open Note:** Click a node, click "Open note", and verify it switches to the already open tab instead of spawning duplicates.
- **Visuals:** Ensure the graph is a strict star topology with no messy cross-edges.
- **Sneak Peek:** Hover over an outer node and verify the tooltip appears with 1-3 plain text titles of its connections.
- **Physics:** Ensure thicker edges are noticeably closer to the center than thinner edges.
- **Responsiveness:** Click an outer node and verify it instantly moves to the center and pulses before the new data loads in.
