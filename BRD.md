# Business Requirements Document (BRD)
## LazyMindmap — Keyboard-First, Rich-Content Mind Mapping Web Application

**Document Version:** 1.1 (Approved)  
**Date:** November 23, 2026  
**Workspace:** `/Users/arkarchanmyae/Desktop/projects/mindmap`

---

## 1. Executive Summary & Product Vision

**LazyMindmap** (working title) is a high-speed, keyboard-first, rich-content mind mapping web application designed to unite:
- **MindMeister's** visual polish, flexible layouts, branch color cascades, and presentation-ready styling.
- **MindMup's** rapid, zero-mouse keyboard-centric creation and navigation workflow.
- **Obsidian / Notion-grade** rich node rendering capable of displaying photos, universal AI/LLM mathematical formulas, syntax-highlighted code blocks, interactive checklists, tables, diagrams, and file attachments inside every node.

### Deployment & Availability Target
- **Cross-Platform Web App:** Responsive single-page application accessible from macOS, Windows, Linux, tablets, and mobile browsers with macOS `Cmd` / `Ctrl` shortcut ergonomics.
- **Self-Contained Docker Container:** Deployable via a single command (`docker compose up` or `docker run`) with zero runtime reliance on external CDNs (all fonts, KaTeX assets, syntax highlighters, and icons bundled locally).

---

## 2. Investigation Report: LLM Providers' Math Symbol & Formula Output Formats

Before designing the math rendering engine, an investigation was conducted into how major LLM providers format mathematical formulas in Markdown and how web UI copy-paste behaves across platforms.

### 2.1 Provider-by-Provider Delimiter & Copy Matrix

| Provider / Platform | Raw Markdown ("Copy" Button) — Inline | Raw Markdown ("Copy" Button) — Block / Display | DOM Highlight-Copy Behavior & Special Quirks |
| :--- | :--- | :--- | :--- |
| **ChatGPT (OpenAI)** | Frequently outputs `\( ... \)` or `$ ... $` | Frequently outputs `\[ ... \]` or `$$ ... $$` | Highlighting text in the browser UI copies rendered KaTeX DOM containing `<span class="katex-mathml"><math>...<annotation encoding="application/x-tex">...</annotation></math></span>` alongside `.katex-html`. Pasting as plain text often yields duplicated, mangled output (e.g., `E=mc2E = mc^2`). |
| **Claude (Anthropic)** | Primarily `$ ... $` (occasionally `\( ... \)`) | Primarily `$$ ... $$` plus standalone environments (`\begin{align}`, `\begin{equation}`, `\begin{pmatrix}`) | Sometimes emits bare `\begin{align}...\end{align}` or `\begin{equation}...\end{equation}` blocks *without* outer `$$` delimiters. DOM selection also carries KaTeX MathML `<annotation>` tags. |
| **Gemini (Google)** | `$ ... $` or `\( ... \)` | `$$ ... $$` or `\[ ... \]` | Occasionally wraps LaTeX inside fenced code blocks (```` ```latex ```` or ```` ```math ````). DOM copy often exposes custom math attributes (e.g., `data-math`) or KaTeX/MathML annotations. |
| **DeepSeek (R1 / V3)** | Strongly defaults to `\( ... \)` | Strongly defaults to `\[ ... \]` | Heavy math/reasoning output relies on standard LaTeX bracket delimiters (`\(...\)` / `\[...\]`), which fail to render in Markdown parsers that only recognize `$` / `$$`. |
| **Grok (xAI) & Perplexity** | Primarily `$ ... $` | Primarily `$$ ... $$` | Occasionally outputs spaces immediately inside inline dollar delimiters (e.g., `$ x^2 $`) or places inline citation markers immediately adjacent to math (e.g., `$E=mc^2$[1]`). |
| **GitHub / GitLab Flavored Markdown** | `$ ... $` and `` $` ... `$ `` | `$$ ... $$` and ```` ```math ```` | Supports backtick-wrapped inline math `` $`...`$ `` and fenced `math` code blocks. |

### 2.2 Common Failure Modes When Pasting LLM Output into Web Apps

1. **Delimiter Mismatch & Backslash Stripping:**
   - Standard Markdown parsers (`remark-math` by default) only recognize `$` and `$$`.
   - Worse, standard Markdown treats `\` as an escape character, stripping the backslash in `\(` and `\[` before a math plugin can read it—turning `\(x^2\)` into literal `(x^2)`.
2. **The Underscore / Asterisk Mangling Trap:**
   - If math delimiters are not extracted *prior* to Markdown inline emphasis parsing, subscripts and multiplication symbols like `x_{i,1} + x_{i,2}` or `a * b * c` are mistakenly converted into `<em>` italics tags, breaking the formula.
3. **Spaced Single-Dollar Rejection:**
   - Strict parsers reject `$ x + y $` (with leading/trailing whitespace) to prevent false positives on currency, breaking valid LLM math strings.
4. **DOM Highlight-Copy Duplication:**
   - Users frequently highlight part of an AI answer and press `Cmd/Ctrl + C` instead of clicking the provider's "Copy" button. Without HTML-aware paste interception, browsers paste both the hidden accessibility MathML text and the visual HTML text.

### 2.3 Required Solution: Universal LLM Math Pipeline

To make pasting or typing formulas from **any** LLM seamless, LazyMindmap will implement a three-stage math pipeline:

1. **Pre-Markdown Math Tokenizer & Normalizer:**
   - Runs **before** Markdown backslash escaping and inline emphasis (`_`, `*`) rules so formulas are isolated into protected tokens and never mangled.
2. **Universal Delimiter & Syntax Support (Normalized to KaTeX):**
   1. `$$ ... $$` (single-line and multi-line block math)
   2. `\[ ... \]` and double-escaped `\\[ ... \\]` (block math)
   3. `$ ... $` (inline math, using smart currency disambiguation so prose like `"$100 to $200"` remains currency text while `"$E=mc^2$"` and `"$ x + 1 $"` render as math)
   4. `\( ... \)` and double-escaped `\\( ... \\)` (inline math)
   5. `` $` ... `$ `` (GitHub/GitLab inline math)
   6. Fenced ```` ```math ````, ```` ```latex ````, and ```` ```tex ```` blocks
   7. Bare top-level LaTeX environments without outer delimiters: `\begin{equation(*)}`, `\begin{align(*)}`, `\begin{gather(*)}`, `\begin{aligned}`, `\begin{matrix}`, `\begin{pmatrix}`, `\begin{bmatrix}`, `\begin{cases}`, `\begin{array}`
   8. Chemistry notation via KaTeX `mhchem` extension (`\ce{H2O}`, `\pu{123 kJ/mol}`).
3. **Smart Clipboard Paste Interceptor (`onPaste`):**
   - Inspects `clipboardData.getData('text/html')` alongside `text/plain` when pasting into a node.
   - Detects KaTeX / MathJax / provider DOM structures (`<annotation encoding="application/x-tex">`, `data-math`, `script[type^="math/tex"]`) and reconstructs clean Markdown with `$ ... $` and `$$ ... $$` automatically.

---

## 3. Functional Requirements: Complete MindMup Keyboard Shortcut Parity

All shortcuts below match **MindMup.com**'s documented behavior. On macOS, `Ctrl` and `Cmd` work interchangeably for `Ctrl`-prefixed shortcuts, with `Ctrl + Space` / `Ctrl` fallbacks wherever macOS or browsers reserve a `Cmd` shortcut (e.g., `Cmd + Space` for Spotlight). Single-key canvas shortcuts only trigger when the user is **not** actively typing inside a node editor or input field.

### 3.1 Help & Discovery
| Shortcut | Action |
| :--- | :--- |
| `Ctrl + /` (or `?` on canvas) | Toggle the Keyboard Shortcuts Cheat Sheet modal |

### 3.2 Node Creation & Hierarchy
| Shortcut | Action |
| :--- | :--- |
| `Tab` | Add a **child** node (in horizontal/mindmap layouts) or a **sibling** node (in vertical/org-chart layouts) |
| `Enter` | Add a **sibling** node below (in horizontal layouts) or a **child** node (in vertical layouts) |
| `Shift + Enter` *(canvas mode)* | Add a **sibling** node *above* the current selection |
| `Shift + Tab` | Insert a **parent** node between the selected node and its current parent (or create a new parent above root) |
| `Backspace` / `Delete` | Delete the selected node(s) and their subtree |
| `Ctrl + D` | Insert a new disconnected / detached root node on the canvas |
| `D` | Disconnect / detach the selected node into an independent root node |
| `Ctrl + Up Arrow` / `Ctrl + Down Arrow` | Reorder the selected node up or down among its siblings |

### 3.3 Node Editing & Rich Media Shortcuts
| Shortcut | Action |
| :--- | :--- |
| `Space` (also `F2` / Double-Click) | Enter inline node editor |
| `Shift + Enter` *(while editing)* | Insert a newline / line break inside node content |
| `Enter` *(while editing)* | Commit edits and exit editing mode (configurable behavior for single-line vs. multi-line rich/code blocks, with `Ctrl/Cmd + Enter` always committing) |
| `Esc` *(while editing)* | Cancel current edit and revert node content |
| `I` | Add or change the node image/photo (file upload, clipboard paste, or URL) |
| `A` | Open / toggle the node attachments & extended side-panel notes drawer |
| `Shift + Space` | Open the node color & style quick-picker popover |
| `Shift + S` | Add or edit node stickers / icons / emojis |
| `Alt + X` + `Left Click` (or `C` connector mode) | Draw a cross-link / relationship arrow to another node |

### 3.4 Text Formatting & Sizing (Canvas Mode)
| Shortcut | Action |
| :--- | :--- |
| `T` | Increase node font size |
| `Shift + T` | Decrease node font size |
| `Alt + T` | Reset node font size to default |
| `Shift + Ctrl + L` | Left-align node text |
| `Shift + Ctrl + E` | Center-align node text |
| `Shift + Ctrl + R` | Right-align node text |

### 3.5 Selection & Tree Navigation
| Shortcut | Action |
| :--- | :--- |
| `Arrow Keys` (`Up`, `Down`, `Left`, `Right`) | Spatial & hierarchical navigation between nodes |
| `Shift + Arrow Keys` | Extend multi-selection to adjacent / sibling nodes |
| `{` (`Shift + [`) | Multi-select the current node **and** its entire subtree |
| `[` | Multi-select **only** the subtree under the current node (excluding the node itself) |
| `=` | Multi-select all siblings sharing the same parent |
| `Ctrl/Cmd + A` | Select all visible nodes (press again to include hidden collapsed nodes) |
| `Esc` *(canvas mode)* | Clear multi-selection and popovers back to primary node |
| `F` | Fold or unfold (collapse / expand) the selected node's subtree |
| `Alt + 1` .. `Alt + 9` | Collapse / expand the map to outline level `1..9` |
| `Alt + 0` or `Shift + F` | Expand all collapsed nodes across the map |

### 3.6 Canvas & Viewport Controls
| Shortcut | Action |
| :--- | :--- |
| `V` | Activate Select / Pointer tool (drag for marquee box selection) |
| `H` | Activate Hand / Pan tool (drag canvas to pan) |
| `Ctrl + 0` | Recenter view on the root node and reset zoom to 100% |
| `Ctrl + 1` | Zoom to fit the entire mind map inside the viewport |
| `Alt + D` | Toggle Light / Dark appearance scheme |
| `Alt + M` | Cycle MindMeister-style color theme palette |
| `Scroll` | Vertical pan |
| `Shift + Scroll` | Horizontal pan |
| `Ctrl + Scroll` | Smooth cursor-centered zoom in / out |

### 3.7 General Editing, Clipboard & Search
| Shortcut | Action |
| :--- | :--- |
| `U` or `Ctrl + Z` | Undo |
| `R`, `Ctrl + Y`, or `Ctrl + Shift + Z` | Redo |
| `Ctrl + C` / `Ctrl + X` / `Ctrl + V` | Copy, Cut, Paste nodes/subtrees, or smart-paste external Markdown, images, and LLM responses into the selected node |
| `Ctrl + Shift + V` | Parse structured LLM Markdown response (headings, bullets, math, code) into a multi-level subtree |
| `Ctrl + S` | Save map / trigger export snapshot |
| `Ctrl + F` | Open map search & filter bar with instant jump-to-node |

---

## 4. Rich Node Content Formats ("Everything-in-a-Node")

Every node functions as a lightweight, performant rich-content container capable of rendering mixed media cleanly without degrading infinite-canvas pan/zoom responsiveness.

### 4.1 Photos & Images
- **Input Methods:** Drag-and-drop image files onto any node, press `I` for upload/URL picker, or paste (`Ctrl + V`) directly from clipboard screenshots.
- **Supported Formats:** PNG, JPEG, WebP, GIF, SVG.
- **Node Display & Photo Actions:**
  - Thumbnail / cover-image (`contain` / `cover`) or inline block mode, with `Top` / `Bottom` placement and `Left` / `Center` / `Right` alignment.
  - Per-photo overlay action bar when selected (`Preview`, `S`/`M`/`L` width presets, `Flip Top/Bottom`, `Remove`) plus interactive drag-to-resize corner handle.
  - Floating contextual toolbar photo panel for batch photo sizing, alignment, caption editing, and removal across single or multi-selected nodes.
  - Click-to-expand lightbox viewer with zoom and download.
  - Interactive node width/height resize handles on every selected node (double-click handle to reset to Auto Fit).

### 4.2 Math Formulas (Inline & Block)
- Rendered offline via **KaTeX** (with `mhchem` for chemical equations and `copy-tex` support so copying rendered equations preserves LaTeX source).
- Supports all 8 LLM delimiter/environment forms listed in Section 2.3.
- Live preview / split preview while editing a node containing math expressions.

### 4.3 Code Blocks & Inline Code
- Inline code (`` `const x = 1` ``) and multi-line fenced code blocks (```` ```python ````) with language auto-detection and syntax highlighting (**Shiki** or **Highlight.js / Prism**).
- Each code block includes:
  - Language badge.
  - One-click **Copy Code** button directly on the canvas node.
  - Optional line numbers and horizontal scroll containment so wide code blocks do not distort the mind map layout.

### 4.4 Other Supported Rich Formats
- **GitHub Flavored Markdown (GFM):** Headings, bold, italics, strikethrough, ordered/unordered lists, blockquotes, and admonition callouts (`> [!NOTE]`, `> [!TIP]`, `> [!WARNING]`, `> [!CAUTION]`).
- **Tables:** Full Markdown tables rendered with clean borders, alternating rows, and responsive sizing inside nodes.
- **Interactive Task Lists:** Markdown checkboxes (`- [ ]` / `- [x]`) toggleable directly on the canvas with a single click—without entering edit mode.
- **Diagrams-in-a-Node (Mermaid.js):** Fenced ```` ```mermaid ```` blocks render flowcharts, sequence diagrams, state diagrams, and ER diagrams directly inside a node.
- **Hyperlinks, Media & File Attachments:**
  - Clickable URLs rendered as clean link chips with domain icons.
  - Embedded audio/video snippet playback for local or URL media.
  - Arbitrary file attachments accessible via the `A` shortcut drawer.
- **AI Response Auto-Branching (Bonus Workflow):**
  - When pasting a structured LLM Markdown response (containing `#` / `##` headings and nested bullet lists alongside math/code blocks), users can choose to paste it into a **single rich node** or **auto-split** headings/bullets into a hierarchical subtree while keeping each block's formulas and code intact.

---

## 5. MindMeister-Inspired Visual & Core Features

- **Layout Modes:**
  - Classic Radial Mind Map (balanced left & right branches).
  - Right-Aligned Tree.
  - Top-Down Org Chart (automatically adapts `Tab` / `Enter` semantics per MindMup rules).
  - Freeform / Manual positioning mode.
- **Visual Themes & Styling:**
  - Curated themes (Ocean, Midnight Dark, Pastel, High-Contrast, Solarized) with light/dark mode support.
  - Automatic branch color palettes cascading from Level-1 branches to descendant nodes (with per-node overrides via `Shift + Space`).
  - Connector styles: Smooth Bezier curves, Orthogonal/Elbow connectors, and Straight lines.
  - Node shapes: Rounded Pill, Card/Rectangle, Underline-only, and Cloud.
  - Stickers, icons, and emoji badges (`Shift + S`).
- **Cross-Links (`Alt + X + Left Click`):**
  - Dashed directional relationship curves linking any two nodes across separate branches, with optional text labels.
- **Import & Export:**
  - **Export:** Native `.json` (full fidelity), `.md` (structured Markdown outline preserving LaTeX & code), MindMup (`.mup`), FreeMind (`.mm`), High-DPI `.png`, `.svg`, and `.pdf`.
  - **Import:** Markdown (including raw LLM responses), native `.json`, and `.mup`.

---

## 6. Technical Architecture & Docker Containerization

### 6.1 Cross-Platform Web Architecture
- **Frontend:** TypeScript + React SPA (Vite) with a hardware-accelerated infinite canvas (CSS transform pan/zoom viewport + SVG/Canvas connector layer + virtualized HTML rich-node overlays for crisp DOM text, KaTeX, Shiki, and Mermaid rendering).
- **Offline-First & Zero CDN Dependencies:** All KaTeX CSS/fonts, syntax highlighting grammars, Mermaid bundles, and icons packaged inside the application bundle.
- **Storage Strategy:** Local-first persistence (IndexedDB + File System Access API fallback) paired with optional lightweight backend storage so maps and uploaded photos sync across devices on a self-hosted instance.

### 6.2 Docker Packaging Requirements
- **Multi-Stage `Dockerfile`:**
  - Build stage compiles frontend and backend/static server artifacts.
  - Lightweight runtime stage serves the application on a configurable port (e.g., `3000` or `8080`).
- **`docker-compose.yml`:**
  - Single-command startup (`docker compose up -d`).
  - Persistent volume mount (e.g., `./data:/app/data`) for saved mind maps, metadata, and uploaded images.
  - Built-in `HEALTHCHECK` endpoint.
- **Multi-Architecture Support:** Build-ready for both `linux/amd64` (x86_64 servers/PCs) and `linux/arm64` (Apple Silicon Macs, Raspberry Pi, ARM cloud instances).

---

## 7. Finalized Product & Architecture Decisions (v1.1 Approved)

All architectural and UX decisions below have been confirmed for V1 implementation:

1. **Persistence Mode in Docker — Both (Dual Persistence):**
   - Lightweight Node backend persists mind maps (`/api/maps`) and uploaded photos/attachments (`/api/uploads`) to a mounted Docker volume (`./data:/app/data`), paired with client-side IndexedDB local cache and offline fallback.
2. **Pasting LLM Responses — Single Node Default + Subtree Split:**
   - `Ctrl/Cmd + V` pastes into the selected node by default (or pastes copied mind map nodes), while `Ctrl/Cmd + Shift + V` (and a toolbar/modal option) parses structured LLM Markdown (headings, lists, math, code) into a multi-level mind map subtree.
3. **Node Editor UX (`Space` shortcut) — Option A:**
   - Inline auto-expanding Markdown `<textarea>` directly inside the node on the canvas with a live rendered preview (shown when math, code, tables, or markdown formatting are detected) plus `A` shortcut for a spacious side-panel notes, attachments, and full-editor drawer.
4. **Collaboration & Access Control — Personal (Single-User):**
   - Single-user self-hosted workspace with a multi-map switcher and zero authentication barrier.
5. **Extra Shortcuts — Theme Toggle & Collapse/Expand Levels:**
   - Added `Alt + D` (toggle Light/Dark scheme), `Alt + M` (cycle MindMeister color themes), `Alt + 1..9` (collapse/expand map to outline level `1..9`), and `Alt + 0` / `Shift + F` (expand all nodes), alongside `F` for selected subtree folding.
