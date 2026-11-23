# AGENTS.md — MindForge Workspace Guide

This file provides essential project context, user UX/UI preferences, architecture details, coding rules, and the required Git workflow for every new session working on **MindForge**.

---

## 1. Project Overview & Tech Stack

**MindForge** is a keyboard-first, rich-content mind mapping web application combining MindMup shortcut ergonomics, MindMeister-inspired visual polish/layouts, and rich Markdown/KaTeX/code/Mermaid rendering inside every node.

- **Frontend:** React 19 + TypeScript + Vite (`src/`)
- **Rich Node Rendering:** `marked` + `DOMPurify` + `katex` (with `mhchem`) + `highlight.js` + custom SVG Mermaid flowchart renderer (`src/utils/llmMathNormalizer.ts`)
- **Backend & Storage:** Lightweight Node HTTP/Connect middleware (`server/api.mjs`, mounted in both `vite.config.ts` dev server and `server/index.mjs` production server) persisting maps to `data/maps/` and uploads to `data/uploads/`, paired with client-side IndexedDB / `localStorage` cache (`src/utils/storage.ts`)
- **Test Runner:** Vitest (`npm test`)
- **Build Check:** `tsc && vite build` (`npm run build`)

---

## 2. User UI / UX Preferences (Always Preserve)

### 2.1 Minimalist Top Navbar & Top-Right Hamburger Menu
- **Keep the top navbar uncluttered.** Only retain:
  - Brand (`MindForge`)
  - **+ Floating** detached root node button (`Ctrl+D`)
  - **Undo / Redo** (`U`/`R` or `Ctrl+Z`/`Ctrl+Y`) and **Select (`V`) / Hand (`H`)** tools
  - **Search** (`Ctrl+F`) — while the **LLM Assistant** circular trigger button lives at the **bottom-right** corner, sliding out a right-hand AI chatbox with chat history, API key settings, universal file uploads, and modified/created node tracking (`Ctrl+Shift+V`)
  - **Save Status Pill** (shows `Saved` cleanly, revealing the `HH:MM` timestamp without seconds only on hover/focus; clickable to trigger save now / retry)
  - **Top-Right Hamburger `Menu`** button (`☰ Menu`)
- **Do NOT add node-level buttons** (`Child`, `Sibling`, `Parent`, `Photo`, `Notes`) to the top navbar or inside the Hamburger Menu's **Tools & Help** section. Those live inside the contextual floating node toolbar and keyboard shortcuts (`Tab`, `Enter`, `Shift+Tab`, `I`, `A`).
- **Categorized Top-Right Hamburger Panel (`.mf-hamburger-panel`):**
  - Anchored to `.mf-topbar-right` (`position: absolute; top: calc(100% + 10px); right: 0;`) so it never collides with the top save-failure banner.
  - Organized into category tabs: **All**, **File**, **Layout**, **Theme**, **Tools**.
  - **File & Auto-Save:** Map Switcher (`Current map` select), New Map, Save Now, Import (`.json`, `.mup`, `.md`), Delete Map, Auto-save interval selector (`15s`, `45s`, `90s`, `180s`), Export formats (`.json`, `.md`, `.mup`, `.mm`, `.svg`, `.png`).
  - **Layout & Edge Spacing:** Layout mode (`Radial Mind Map`, `Right Tree`, `Org Chart`), Connector style (`Curved`, `Elbow`, `Straight`), and **Edge Horizontal Distance** (`36px`–`260px` slider + `Compact 48px`, `Standard 80px`, `MindMup 140px`, `Wide 200px` presets).
  - **Theme & Appearance:** Node & Edge Color Mode (`Contrast`, `Colorful`, `Custom`), Color Palette (`Ocean`, `Midnight`, `Pastel`, `Solarized`, `Emerald`), Light/Dark toggle (`Alt+D`).
  - **Tools & Help:** `AI Assistant Chat` and `Shortcuts` (`Ctrl+/`).

### 2.2 Contextual Floating Toolbars
- **Floating Node Toolbar (`src/components/FloatingNodeToolbar.tsx`):**
  - Appears when 1+ nodes are selected.
  - **Node Color button:** Shows ONLY the rounded color square (`.mf-color-dot-solo`) — **do NOT** add a paint-bucket or fill SVG icon next to it.
  - **Node + Edge Color button:** Sits directly beside the node color square, showing a thick colored line (`.mf-edge-color-line`) in the node's current edge/branch color. Its color panel only sets border + edge color (never node fill). Both color panels place a custom color picker tile (`Pipette` icon, `.mf-swatch-picker`) as the first swatch in the grid and an `Auto` reset button in the popover header. Changing colors automatically switches `doc.colorMode` to `"custom"`.
  - Includes quick node creation (`Child`, `Sibling`, `Parent`), typography/alignment, shape/width presets, `Photo`, `Tasks`, `Notes`, `Stickers`, `Cross-link`, `Fold/Unfold`, `Duplicate`, and `Delete`.
- **Floating Cross-Link Toolbar (`src/components/FloatingCrossLinkToolbar.tsx`):**
  - Cross-links are **only** selectable on single-click directly on the line or label (`selectedCrossLinkId`). Multi-select, marquee drag, and `Ctrl+A` (Select All) must NEVER select cross-links.
  - Uses the exact same dark pill layout/style (`.mf-context-toolbar`) as the node toolbar, showing only:
    1. **Color** swatch square (no bucket icon)
    2. **Layer** (`Above` / `Behind` nodes)
    3. **Line Pattern** (`Dashed` / `Dotted` / `Solid`)
    4. **Delete** (`Backspace`/`Delete` or trash button) and Deselect (`Esc`/`X`).

### 2.3 Theme & Node/Edge Color Modes (`ColorMode`)
Defined in `src/types/mindmap.ts` (`"contrast" | "colorful" | "custom"`):
1. **`contrast`**: Monochrome high-contrast nodes and edges opposing the active light/dark scheme (`#1e293b` in light mode, `#e2e8f0` in dark mode).
2. **`colorful`** *(default)*: Multi-color branches radiating from each root node using the active `MIND_THEMES` palette.
3. **`custom`**: Automatically activated whenever a node or node+edge color is changed via `setNodesColor()`.

### 2.4 Formatting, Layering, Zoom & Auto-Save Behavior
- **Checklist Bullets:** Markdown task items (`- [ ]`, `- [x]`) are tagged at the opening `<li>` via `decorateCheckboxesAndAlerts` (`<li class="mf-task-item">`) in `src/utils/llmMathNormalizer.ts` and styled in `src/index.css` with `list-style: none`. **Never** apply `display: flex` to `<li>` or match across `</li>` in regexes, as that breaks inline Markdown, code spans, KaTeX math, and nested lists.
- **SVG Z-Axis Layering:**
  - `.mf-svg-branches` (`z-index: 1`): Tree branch connectors + cross-links set to `layer: "behind"`.
  - `.mf-node` (`z-index: 5`, `15` selected, `25` editing): Node cards.
  - `.mf-svg-crosslinks` (`z-index: 32`): Cross-links set to `layer: "above"` (default) and `.mf-crosslink-label` text sit above all nodes with a surface-color stroke halo.
- **Horizontal Edge Spacing:** `doc.horizontalGap` defaults to `80` in `src/utils/layoutEngine.ts` (min `36`, max `260`).
- **Zoom Gesture Sensitivity:** `Ctrl+Scroll` / trackpad pinch zoom in `src/App.tsx` must remain smoothly damped (`Math.exp(-clampedDelta * 0.00495)` with `requestAnimationFrame` batching), never fixed large step jumps per event.
- **Undo / Redo & Bottom HUD Level Expansion:**
  - Node expand/collapse actions are excluded from undo/redo history, and undo/redo preserve the current collapse state across shared node IDs.
  - The bottom-left HUD provides an `Expand Level` hover/focus menu above the button listing `Level 1`..`Level N` plus `Expand all` (with no separate `Expand All` button).
- **Auto-Save & Failure Banner:**
  - Default periodic auto-save interval is **45 seconds** (configurable to `15s`, `45s`, `90s`, `180s`), paired with a **4.5-second** edit debounce and `visibilitychange` safeguard.
  - Reflects live state (`saved`, `saving`, `unsaved`, `error`) in the top status pill and displays a top-of-screen `role="alert"` notice banner (`.mf-save-error-banner`) with **Retry Now** and **Dismiss** buttons whenever saving fails.

### 2.5 Chevron / Dropdown Spacing
- Any button or `<select>` with a chevron icon must keep right-side breathing room so the chevron never touches the right border:
  - Native selects (`.mf-select`, `.mf-map-select`) use `appearance: none` with a custom SVG chevron at `background-position: right 10px center` and `padding-right: 30px`.
  - Lucide Chevron icons inside buttons get `margin-right: 4px`.

---

## 3. Key Files Map

| File | Responsibility |
| :--- | :--- |
| `src/App.tsx` | Application state, auto-save loop, undo/redo, pan/zoom, SVG layers, modal & toolbar wiring |
| `src/types/mindmap.ts` | Core TypeScript types (`MindMapDocument`, `MindMapNode`, `CrossLink`, `ColorMode`, `SaveState`) |
| `src/components/TopToolbar.tsx` | Minimal navbar, save status pill, and top-right categorized hamburger menu |
| `src/components/FloatingNodeToolbar.tsx` | Contextual floating bar for selected node(s) |
| `src/components/FloatingCrossLinkToolbar.tsx` | Contextual floating bar for a single selected cross-link |
| `src/components/MindMapNodeCard.tsx` | Rich node card rendering, inline Markdown editor, resize handles, photo actions |
| `src/components/NodeSideDrawer.tsx` | `A` shortcut side inspector for extended notes and file attachments |
| `src/components/LlmAssistantDrawer.tsx` | Bottom-right circular FAB + sliding right AI chatbox with history, API key settings, and universal file uploads |
| `src/components/Modals.tsx` | Shortcuts cheat sheet, Image picker, LLM Subtree paste modal, Lightbox |
| `src/utils/layoutEngine.ts` | Radial, right-tree, and org-chart positioning + connector/cross-link path math |
| `src/utils/llmMathNormalizer.ts` | Universal LLM KaTeX/Markdown/code/Mermaid/task-list HTML renderer and clipboard extractor |
| `src/utils/llmMindMapAgent.ts` | LLM prompt/context builder, related node matcher, JSON/Markdown operation applier, and API client |
| `src/utils/treeOps.ts` | Pure immutable document/tree mutation helpers |
| `src/utils/storage.ts` | Dual persistence (`IndexedDB`/`localStorage` + `/api/maps` & `/api/uploads`) |
| `src/utils/themes.ts` | Theme palettes, color swatches, font presets, contrast foreground helper |
| `src/utils/exporters.ts` | Export/import for JSON, Markdown, MindMup `.mup`, FreeMind `.mm`, SVG, PNG |
| `server/api.mjs` | Backend REST middleware for `/api/maps`, `/api/uploads`, `/api/llm/chat`, `/api/health` |
| `src/__tests__/mindforge.test.ts` | Vitest unit test suite |

---

## 4. Verification Commands

Always run both commands after making code changes and confirm both pass before committing:

```sh
npm test        # Runs Vitest suite (src/__tests__/mindforge.test.ts)
npm run build   # Runs TypeScript type-check (tsc) and production Vite build
```

---

## 5. Mandatory Git Flow

Every new feature or bug fix **must** follow this exact Git workflow:

1. **Create a new branch from `develop`** for every new feature or bug fix:
   ```sh
   git checkout develop
   git checkout -b feat/<short-description>   # or fix/<short-description>
   ```
2. **Implement & Verify:** Run `npm test && npm run build` and ensure all checks pass cleanly.
3. **Commit on the feature/fix branch:**
   - Stage only source/project files (`AGENTS.md`, `src/`, etc. — `dist/`, `data/`, and `node_modules/` are gitignored).
   - Write a clear Conventional Commit message (`feat: ...` or `fix: ...`).
4. **Merge into `develop`:**
   ```sh
   git checkout develop
   git merge --no-ff feat/<short-description>   # or fast-forward merge
   ```
5. **Merge `develop` into `main`:**
   ```sh
   git checkout main
   git merge develop
   git checkout develop
   ```
6. **Push only after user confirmation:**
   - **Never** push to a remote automatically.
   - Once the user confirms they want to push, push **all three branches** (`<feature-or-fix-branch>`, `develop`, and `main`):
     ```sh
     git push -u origin <feature-or-fix-branch> develop main
     ```

---

## 6. Web Platform & UI Guidelines

- Follow `modern-web-guidance` for accessible `toolbar` (`role="toolbar"`, `focusgroup="toolbar wrap"`, `aria-pressed` only on toggles, `aria-disabled` instead of `disabled`), native `<dialog>` modals (`NativeDialog.tsx`), and live-region status announcements (`<p role="status">`).
- Note: Chrome/Chromium `focusgroup` and CSS Anchor Positioning patterns are progressively enhanced with fallbacks in `src/hooks/useToolbarFocusGroup.ts` and `src/index.css`.
