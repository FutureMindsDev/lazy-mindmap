import { useRef } from "react";
import { useToolbarFocusGroup } from "../hooks/useToolbarFocusGroup";
import {
  Download,
  FilePlus2,
  Hand,
  HelpCircle,
  ImagePlus,
  Keyboard,
  Moon,
  MousePointer2,
  Palette,
  Paperclip,
  Redo2,
  Save,
  Search,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  Upload,
} from "lucide-react";
import type {
  CanvasTool,
  ConnectorStyle,
  LayoutMode,
  MapSummary,
  ThemeId,
} from "../types/mindmap";
import { MIND_THEMES } from "../utils/themes";

interface TopToolbarProps {
  maps: MapSummary[];
  activeMapId: string;
  canUndo: boolean;
  canRedo: boolean;
  tool: CanvasTool;
  layout: LayoutMode;
  theme: ThemeId;
  connectorStyle: ConnectorStyle;
  isDark: boolean;
  syncStatus: string;
  drawerOpen: boolean;
  onSelectMap: (id: string) => void;
  onCreateNewMap: () => void;
  onDeleteCurrentMap: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSetTool: (tool: CanvasTool) => void;
  onChangeLayout: (layout: LayoutMode) => void;
  onChangeTheme: (theme: ThemeId) => void;
  onChangeConnector: (style: ConnectorStyle) => void;
  onToggleDarkLight: () => void;
  onOpenImageModal: () => void;
  onToggleDrawer: () => void;
  onOpenSubtreePaste: () => void;
  onOpenSearch: () => void;
  onSaveNow: () => void;
  onExportAction: (fmt: string) => void;
  onImportFile: () => void;
  onOpenShortcuts: () => void;
}

/**
 * Toolbar adhering to modern-web-guidance `toolbar` rules:
 * - role="toolbar" with focusgroup="toolbar wrap"
 * - Roving-tabindex fallback ONLY when 'focusGroup' is not on HTMLElement.prototype
 * - aria-pressed only on true toggle buttons; aria-disabled instead of disabled
 */
export function TopToolbar({
  maps,
  activeMapId,
  canUndo,
  canRedo,
  tool,
  layout,
  theme,
  connectorStyle,
  isDark,
  syncStatus,
  drawerOpen,
  onSelectMap,
  onCreateNewMap,
  onDeleteCurrentMap,
  onUndo,
  onRedo,
  onSetTool,
  onChangeLayout,
  onChangeTheme,
  onChangeConnector,
  onToggleDarkLight,
  onOpenImageModal,
  onToggleDrawer,
  onOpenSubtreePaste,
  onOpenSearch,
  onSaveNow,
  onExportAction,
  onImportFile,
  onOpenShortcuts,
}: TopToolbarProps) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  useToolbarFocusGroup(toolbarRef);

  return (
    <header className="mf-topbar">
      <div className="mf-brand">
        <span className="mf-brand-badge" aria-hidden="true">
          M
        </span>
        <span>MindForge</span>
      </div>

      <select
        className="mf-map-select"
        aria-label="Switch mind map"
        value={activeMapId}
        onChange={(e) => onSelectMap(e.target.value)}
      >
        {maps.map((m) => (
          <option key={m.id} value={m.id}>
            {m.title} ({m.nodeCount})
          </option>
        ))}
      </select>

      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Mind map actions"
        className="mf-toolbar"
        {...({ focusgroup: "toolbar wrap" } as Record<string, string>)}
      >
        <div role="group" aria-label="Workspace" className="mf-toolbar-group">
          <button
            type="button"
            className="mf-btn"
            aria-label="New mind map"
            title="New mind map"
            onClick={onCreateNewMap}
          >
            <FilePlus2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mf-btn"
            aria-label="Delete current mind map"
            title="Delete current mind map"
            onClick={onDeleteCurrentMap}
          >
            <Trash2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mf-btn"
            aria-label="Save map (Ctrl+S)"
            title="Save map (Ctrl+S)"
            onClick={onSaveNow}
          >
            <Save size={16} aria-hidden="true" />
          </button>
        </div>

        <span role="separator" aria-orientation="vertical" className="mf-toolbar-sep" />

        <div role="group" aria-label="History and tools" className="mf-toolbar-group">
          <button
            type="button"
            className="mf-btn"
            aria-label="Undo (U or Ctrl+Z)"
            title="Undo (U or Ctrl+Z)"
            aria-disabled={!canUndo ? "true" : undefined}
            onClick={() => canUndo && onUndo()}
          >
            <Undo2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mf-btn"
            aria-label="Redo (R or Ctrl+Y)"
            title="Redo (R or Ctrl+Y)"
            aria-disabled={!canRedo ? "true" : undefined}
            onClick={() => canRedo && onRedo()}
          >
            <Redo2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mf-btn"
            aria-label="Select tool (V)"
            title="Select tool (V)"
            aria-pressed={tool === "select"}
            onClick={() => onSetTool("select")}
          >
            <MousePointer2 size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mf-btn"
            aria-label="Hand pan tool (H)"
            title="Hand pan tool (H)"
            aria-pressed={tool === "hand"}
            onClick={() => onSetTool("hand")}
          >
            <Hand size={16} aria-hidden="true" />
          </button>
        </div>

        <span role="separator" aria-orientation="vertical" className="mf-toolbar-sep" />

        <div role="group" aria-label="Rich content and LLM" className="mf-toolbar-group">
          <button
            type="button"
            className="mf-btn"
            aria-label="Add image to node (I)"
            title="Add photo/image to node (I)"
            onClick={onOpenImageModal}
          >
            <ImagePlus size={16} aria-hidden="true" />
            <span>Photo</span>
          </button>
          <button
            type="button"
            className="mf-btn"
            aria-label="Toggle notes and attachments drawer (A)"
            title="Notes & Attachments drawer (A)"
            aria-pressed={drawerOpen}
            onClick={onToggleDrawer}
          >
            <Paperclip size={16} aria-hidden="true" />
            <span>Notes</span>
          </button>
          <button
            type="button"
            className="mf-btn mf-btn-primary"
            aria-label="Paste LLM Markdown as subtree (Ctrl+Shift+V)"
            title="Paste LLM Markdown as Subtree (Ctrl+Shift+V)"
            onClick={onOpenSubtreePaste}
          >
            <Sparkles size={15} aria-hidden="true" />
            <span>LLM Subtree</span>
          </button>
          <button
            type="button"
            className="mf-btn"
            aria-label="Search nodes (Ctrl+F)"
            title="Search nodes (Ctrl+F)"
            onClick={onOpenSearch}
          >
            <Search size={16} aria-hidden="true" />
          </button>
        </div>

        <span role="separator" aria-orientation="vertical" className="mf-toolbar-sep" />

        <div role="group" aria-label="Layout and style" className="mf-toolbar-group">
          <select
            className="mf-select"
            aria-label="Layout mode"
            value={layout}
            onChange={(e) => onChangeLayout(e.target.value as LayoutMode)}
          >
            <option value="mindmap">Radial Mind Map</option>
            <option value="tree-right">Right Tree</option>
            <option value="org-chart">Org Chart (Top-Down)</option>
          </select>

          <select
            className="mf-select"
            aria-label="Connector style"
            value={connectorStyle}
            onChange={(e) => onChangeConnector(e.target.value as ConnectorStyle)}
          >
            <option value="bezier">Curved</option>
            <option value="orthogonal">Elbow</option>
            <option value="straight">Straight</option>
          </select>

          <select
            className="mf-select"
            aria-label="Color theme (Alt+M)"
            value={theme}
            onChange={(e) => onChangeTheme(e.target.value as ThemeId)}
          >
            {Object.values(MIND_THEMES).map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>

          <button
            type="button"
            className="mf-btn"
            aria-label={isDark ? "Switch to light mode (Alt+D)" : "Switch to dark mode (Alt+D)"}
            title="Toggle Light / Dark theme (Alt+D)"
            aria-pressed={isDark}
            onClick={onToggleDarkLight}
          >
            {isDark ? <Sun size={16} aria-hidden="true" /> : <Moon size={16} aria-hidden="true" />}
          </button>
        </div>

        <span role="separator" aria-orientation="vertical" className="mf-toolbar-sep" />

        <div role="group" aria-label="Import and export" className="mf-toolbar-group">
          <button
            type="button"
            className="mf-btn"
            aria-label="Import JSON, MindMup, or Markdown"
            title="Import (.json, .mup, .md)"
            onClick={onImportFile}
          >
            <Upload size={15} aria-hidden="true" />
          </button>

          <select
            className="mf-select"
            aria-label="Export mind map"
            value=""
            onChange={(e) => {
              if (e.target.value) {
                onExportAction(e.target.value);
              }
            }}
          >
            <option value="">Export…</option>
            <option value="json">Native JSON (.json)</option>
            <option value="md">Markdown + Math (.md)</option>
            <option value="mup">MindMup (.mup)</option>
            <option value="mm">FreeMind (.mm)</option>
            <option value="svg">Vector SVG (.svg)</option>
            <option value="png">High-DPI PNG (.png)</option>
          </select>

          <button
            type="button"
            className="mf-btn"
            aria-label="Keyboard shortcuts cheat sheet (Ctrl+/)"
            title="Keyboard shortcuts (Ctrl+/)"
            onClick={onOpenShortcuts}
          >
            <Keyboard size={16} aria-hidden="true" />
            <HelpCircle size={13} aria-hidden="true" />
          </button>
        </div>
      </div>

      <span className="mf-sync-pill" title="Dual storage: Docker volume + local IndexedDB">
        <Palette size={11} style={{ verticalAlign: "middle", marginRight: 4 }} aria-hidden="true" />
        {syncStatus}
      </span>
      <Download size={0} className="sr-only" aria-hidden="true" />
    </header>
  );
}
