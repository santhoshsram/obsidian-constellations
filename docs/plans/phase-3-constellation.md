# Phase 3: Constellation (Context Graph)

Build a utilitarian, high-performance semantic graph using D3.js physics and HTML5 Canvas. The graph visualizes semantic relationships between notes (files) up to a 2-hop radius, preventing the "hairball" effect of global graphs.

**Branch:** `feat/phase-3-constellation` (off `main`)

## User Review Required

> [!NOTE]
> **New Dependency:** We will install `d3-force` (and its types) via npm. This provides the world-class physics engine. We will handle the Canvas rendering loop manually to ensure it looks and performs beautifully within Obsidian.

> [!IMPORTANT]
> **Open Note Affordance:** Since clicking a node simply *recenters* the graph for "semantic surfing", we will implement **Double-Click** on a node to actually open the note in your workspace. We will also add a subtle, fixed "Current Center Note" header at the top of the graph UI with an "Open Note ↗" button as a highly discoverable alternative.

## Proposed Changes

### 1. Graph Engine (D3 Physics + Canvas)

#### [NEW] `src/ui/graph/constellation-engine.ts`
The core rendering and physics engine. Agnostic to where it is mounted (Modal or Sidebar).
- **Physics:** Uses `d3.forceSimulation()` with `forceLink`, `forceManyBody` (repulsion), and `forceCenter`.
- **Rendering:** Uses an HTML5 `<canvas>` element. Draws nodes (circles), edges (lines with opacity based on similarity), and labels (text).
- **Data Scope:** 
  - Given a "Seed" (either an active note path or a search query).
  - Fetches Hop 1 (top $N$ related notes).
  - Fetches Hop 2 (top $M$ related notes for each Hop 1 note).
  - Calculates edges between all nodes in the set based on cosine similarity > threshold (e.g. 0.75).
- **Interactions:** 
  - Drag to pan. Scroll to zoom.
  - Hover: Highlights node and its immediate edges.
  - Click: Emits an event to recenter the seed on the clicked node.
  - Double-Click: Emits an event to open the note.
- **Styling:** Pulls colors directly from Obsidian CSS variables (e.g., `getComputedStyle(document.body).getPropertyValue('--text-normal')`) so it flawlessly matches the user's theme.

### 2. Immersive Overlay (Modal)

#### [NEW] `src/ui/graph/constellation-modal.ts`
An Obsidian `Modal` that houses the full-screen immersive graph.
- **Trigger:** Command palette ("Open Constellation") or left ribbon icon (`brain-circuit`).
- **UI Elements:**
  - Full-size Canvas background.
  - Top Left: Search input field. If you type a query, the graph seeds from the query embedding rather than a note.
  - Top Right: Close button (`X`), though `Esc` also dismisses the modal.
  - Top Center (or Bottom): "Current Note" floating panel with "Open Note ↗" button.
- **Behavior:** Clicking a node in the graph triggers the engine to re-seed and animate to the new center.

### 3. Sidebar Companion View

#### [MODIFY] `src/ui/related-notes-view.ts`
Integrate the graph into the existing Phase 2 sidebar.
- **UI Addition:** Add a segmented control toggle at the top: `[ List | Graph ]`.
- **State:** Persist the user's preference in the workspace leaf state or settings.
- **Graph Mode:** Mounts the `ConstellationEngine` within the sidebar container.
- **Behavior:** Just like the List view, it automatically updates its seed whenever the active workspace leaf changes.

### 4. Entry Points

#### [MODIFY] `src/main.ts`
- Register the new command: `Open Constellation`.
- Add the ribbon icon: `this.addRibbonIcon('brain-circuit', 'Open Constellation', () => { ... })`.

### 5. Settings

#### [MODIFY] `src/settings.ts`
Add graph-specific tuning parameters to `ObsidianBrainSettings`:
- `graphHop1Count` (default: 10)
- `graphHop2Count` (default: 5)
- `graphSimilarityThreshold` (default: 0.75)

## Verification Plan

### Automated Tests
- Test the 2-hop data fetching logic (ensure it correctly rolls up chunk-level similarities to file-level maximums).
- Test that nodes and edges are correctly deduplicated.
- All existing tests must remain 100% green.

### Manual Verification
- Verify the Overlay modal opens via hotkey and ribbon icon.
- Verify `Esc` closes the overlay without affecting the workspace.
- Click a node: Verify the graph physically animates and re-centers.
- Double-click a node: Verify the note opens in the background (or foreground).
- Type in the Search Bar: Verify a query-seeded graph is generated.
- Toggle the Sidebar to Graph mode: Verify the mini-graph renders and tracks active note changes.
- Change Obsidian themes (Light to Dark): Verify the canvas colors update to match natively.
