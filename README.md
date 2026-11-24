# LazyMindmap

A keyboard-first, rich-content mind mapping web application combining MindMup shortcut ergonomics, MindMeister-inspired visual polish and layouts, and rich Markdown, KaTeX, syntax-highlighted code, and Mermaid diagram rendering inside every node.

---

## Features

- **Keyboard-First Workflow**
  - Rapidly create child (`Tab`), sibling (`Enter`), parent (`Shift+Tab`), and floating root (`Ctrl+D`) nodes.
  - Navigate, select (`V`), pan (`H`), undo/redo (`U`/`R` or `Ctrl+Z`/`Ctrl+Y`), search (`Ctrl+F`), and inspect extended notes/attachments (`A`) without leaving the keyboard.
- **Rich Node Content**
  - Full GitHub-Flavored Markdown (`marked` + `DOMPurify`), interactive task checklists, syntax-highlighted code blocks (`highlight.js`), LaTeX/chemistry math (`katex` + `mhchem`), and SVG Mermaid flowcharts.
  - Inline image/photo uploads, node notes, stickers, and file attachments.
- **Flexible Layouts & Styling**
  - **Layouts:** Radial Mind Map, Right Tree, and Org Chart with configurable horizontal edge spacing (`36px`–`260px`) and connector styles (`Curved`, `Elbow`, `Straight`).
  - **Color Modes & Themes:** `Contrast`, `Colorful`, and `Custom` modes with built-in palettes (`Ocean`, `Midnight`, `Pastel`, `Solarized`, `Emerald`) plus light/dark theme toggle (`Alt+D`).
  - **Cross-Links:** Directed or bidirectional cross-links anchored to node edges with customizable color, line pattern (`Solid`, `Dashed`, `Dotted`), arrowhead options, and `Above`/`Behind` node layering.
- **Integrated AI Assistant**
  - Bottom-right sliding AI chatbox (`Ctrl+Shift+V`) with chat history, API key configuration, universal file uploads, and automatic tracking of created/modified nodes.
- **Dual Persistence & Portability**
  - Client-side IndexedDB / `localStorage` cache paired with a lightweight Node.js backend (`server/api.mjs`) persisting maps to `data/maps/` and uploads to `data/uploads/`.
  - Auto-save with configurable intervals (`15s`, `45s`, `90s`, `180s`), edit debounce, and `visibilitychange` safeguard.
  - **Import:** `.json`, `.mup` (MindMup), `.md`
  - **Export:** `.json`, `.md`, `.mup`, `.mm` (FreeMind), `.svg`, `.png`

---

## Tech Stack

- **Frontend:** React 19, TypeScript, Vite, Lucide Icons
- **Rich Rendering:** `marked`, `DOMPurify`, `katex`, `highlight.js`, custom SVG Mermaid renderer
- **Backend:** Node.js HTTP/Connect middleware (`server/api.mjs`, `server/index.mjs`)
- **Testing:** Vitest

---

## Getting Started

### Prerequisites

- Node.js 20+ (Node 22 recommended)
- npm

### Local Development

```sh
# Install dependencies
npm install

# Start Vite dev server (with /api middleware mounted)
npm run dev
```

### Production Build & Server

```sh
# Type-check and build frontend assets
npm run build

# Start production Node server (serves dist/ and /api on port 3000)
npm start
```

### Docker

```sh
docker compose up -d --build
```

The app will be available at `http://localhost:3000`, with map and upload data persisted in `./data`.

---

## Scripts

| Command | Description |
| :--- | :--- |
| `npm run dev` | Start the Vite development server |
| `npm run build` | Run TypeScript type-checking (`tsc`) and production Vite build |
| `npm run preview` | Preview the built Vite bundle |
| `npm start` | Run the production Node server (`server/index.mjs`) |
| `npm test` | Run the Vitest unit test suite (`src/__tests__/lazymindmap.test.ts`) |

---

## Project Structure

```text
├── server/
│   ├── api.mjs          # REST middleware (/api/maps, /api/uploads, /api/llm/chat, /api/health)
│   └── index.mjs        # Production static + API HTTP server
├── src/
│   ├── components/      # Toolbars, node cards, AI assistant drawer, modals, side drawer
│   ├── hooks/           # Toolbar focusgroup and custom React hooks
│   ├── types/           # Core TypeScript interfaces (MindMapDocument, MindMapNode, CrossLink, etc.)
│   ├── utils/           # Layout engine, tree ops, storage, exporters, themes, Markdown/KaTeX/LLM helpers
│   ├── __tests__/       # Vitest unit tests
│   └── App.tsx          # Main application state, canvas pan/zoom, SVG layers, auto-save loop
├── Dockerfile
├── docker-compose.yml
├── AGENTS.md            # Developer & AI agent workspace guide
└── BRD.md               # Business requirements document
```

---

## Documentation

- [AGENTS.md](./AGENTS.md) — Architecture details, UX/UI conventions, and Git workflow.
- [BRD.md](./BRD.md) — Business requirements and feature specifications.
