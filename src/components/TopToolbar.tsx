import { useEffect, useId, useRef, useState } from "react";
import { useToolbarFocusGroup } from "../hooks/useToolbarFocusGroup";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  CornerDownRight,
  Download,
  FilePlus2,
  GitBranchPlus,
  GitFork,
  Hand,
  HelpCircle,
  ImagePlus,
  Keyboard,
  Loader2,
  Menu,
  Moon,
  MousePointer2,
  Paperclip,
  PlusSquare,
  Redo2,
  Save,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import type {
  CanvasTool,
  ConnectorStyle,
  LayoutMode,
  MapSummary,
  SaveState,
  ThemeId,
} from "../types/mindmap";
import { MAX_HORIZONTAL_GAP, MIN_HORIZONTAL_GAP } from "../utils/layoutEngine";
import { MIND_THEMES } from "../utils/themes";

type MenuCategory = "all" | "file" | "layout" | "theme" | "tools";

interface TopToolbarProps {
  maps: MapSummary[];
  activeMapId: string;
  hasSelection: boolean;
  canUndo: boolean;
  canRedo: boolean;
  tool: CanvasTool;
  layout: LayoutMode;
  theme: ThemeId;
  connectorStyle: ConnectorStyle;
  horizontalGap: number;
  isDark: boolean;
  saveState: SaveState;
  syncStatus: string;
  saveError: string | null;
  autoSaveIntervalSec: number;
  drawerOpen: boolean;
  onSelectMap: (id: string) => void;
  onCreateNewMap: () => void;
  onDeleteCurrentMap: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSetTool: (tool: CanvasTool) => void;
  onAddChildNode: () => void;
  onAddSiblingNode: () => void;
  onInsertParentNode: () => void;
  onAddDetachedRootNode: () => void;
  onChangeLayout: (layout: LayoutMode) => void;
  onChangeTheme: (theme: ThemeId) => void;
  onChangeConnector: (style: ConnectorStyle) => void;
  onChangeHorizontalGap: (gap: number) => void;
  onChangeAutoSaveInterval: (seconds: number) => void;
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

const EDGE_DISTANCE_PRESETS = [
  { label: "Compact", value: 48 },
  { label: "Standard", value: 80 },
  { label: "MindMup", value: 140 },
  { label: "Wide", value: 200 },
];

const EXPORT_FORMATS = [
  { id: "json", label: "JSON (.json)" },
  { id: "md", label: "Markdown (.md)" },
  { id: "mup", label: "MindMup (.mup)" },
  { id: "mm", label: "FreeMind (.mm)" },
  { id: "svg", label: "Vector (.svg)" },
  { id: "png", label: "Image (.png)" },
];

/**
 * Toolbar adhering to modern-web-guidance `toolbar` rules:
 * - role="toolbar" with focusgroup="toolbar wrap"
 * - Roving-tabindex fallback ONLY when 'focusGroup' is not on HTMLElement.prototype
 * - aria-pressed only on true toggle buttons; aria-disabled instead of disabled
 * - Secondary workspace, layout, spacing, theme, and export settings organized inside a top-right MindMup-style hamburger menu
 */
export function TopToolbar({
  maps,
  activeMapId,
  hasSelection,
  canUndo,
  canRedo,
  tool,
  layout,
  theme,
  connectorStyle,
  horizontalGap,
  isDark,
  saveState,
  syncStatus,
  saveError,
  autoSaveIntervalSec,
  drawerOpen,
  onSelectMap,
  onCreateNewMap,
  onDeleteCurrentMap,
  onUndo,
  onRedo,
  onSetTool,
  onAddChildNode,
  onAddSiblingNode,
  onInsertParentNode,
  onAddDetachedRootNode,
  onChangeLayout,
  onChangeTheme,
  onChangeConnector,
  onChangeHorizontalGap,
  onChangeAutoSaveInterval,
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
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuCategory, setMenuCategory] = useState<MenuCategory>("all");
  const menuId = useId();

  useToolbarFocusGroup(toolbarRef);

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setMenuOpen(false);
        menuTriggerRef.current?.focus();
      }
    };
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [menuOpen]);

  const showSection = (cat: Exclude<MenuCategory, "all">) =>
    menuCategory === "all" || menuCategory === cat;

  const renderSaveIcon = () => {
    if (saveState === "saving") {
      return <Loader2 size={12} className="mf-spin" aria-hidden="true" />;
    }
    if (saveState === "error") {
      return <AlertTriangle size={12} aria-hidden="true" />;
    }
    if (saveState === "unsaved") {
      return <Clock size={12} aria-hidden="true" />;
    }
    return <CheckCircle2 size={12} aria-hidden="true" />;
  };

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
        <div role="group" aria-label="Create nodes" className="mf-toolbar-group">
          <button
            type="button"
            className="mf-btn mf-btn-primary"
            aria-label="Add child node (Tab)"
            title={
              hasSelection
                ? "Add child node to selection (Tab)"
                : "Add new child node to root (Tab)"
            }
            onClick={onAddChildNode}
          >
            <GitBranchPlus size={15} aria-hidden="true" />
            <span>Child</span>
          </button>
          <button
            type="button"
            className="mf-btn"
            aria-label="Add sibling node (Enter)"
            title="Add sibling node (Enter)"
            onClick={onAddSiblingNode}
          >
            <CornerDownRight size={15} aria-hidden="true" />
            <span>Sibling</span>
          </button>
          <button
            type="button"
            className="mf-btn"
            aria-label="Insert parent node (Shift+Tab)"
            title="Insert parent node (Shift+Tab)"
            onClick={onInsertParentNode}
          >
            <GitFork size={15} aria-hidden="true" />
            <span>Parent</span>
          </button>
          <button
            type="button"
            className="mf-btn"
            aria-label="Add detached floating node (Ctrl+D)"
            title="Add detached floating root node (Ctrl+D)"
            onClick={onAddDetachedRootNode}
          >
            <PlusSquare size={15} aria-hidden="true" />
            <span>Floating</span>
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

        <div role="group" aria-label="Rich content and search" className="mf-toolbar-group">
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
            className="mf-btn"
            aria-label="Paste LLM Markdown as subtree (Ctrl+Shift+V)"
            title="Paste LLM Markdown as Subtree (Ctrl+Shift+V)"
            onClick={onOpenSubtreePaste}
          >
            <Sparkles size={15} aria-hidden="true" />
            <span>LLM</span>
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
      </div>

      {/* Right-aligned Save Status + MindMup Categorized Hamburger Menu */}
      <div className="mf-topbar-right" ref={menuWrapRef}>
        <button
          type="button"
          className={`mf-sync-pill is-${saveState}`}
          title={
            saveError
              ? `${saveError} — Click to retry save (Ctrl+S)`
              : `Auto-saves every ${autoSaveIntervalSec}s · Click to save now (Ctrl+S)`
          }
          aria-label={`Save status: ${syncStatus}. Click to save now.`}
          onClick={onSaveNow}
        >
          {renderSaveIcon()}
          <span>{syncStatus}</span>
        </button>

        <button
          ref={menuTriggerRef}
          type="button"
          className="mf-btn mf-hamburger-btn"
          aria-label="Map settings, layout, file and help menu"
          aria-haspopup="true"
          aria-expanded={menuOpen}
          aria-controls={menuId}
          title="Settings, Layout, Export & Help"
          onClick={() => setMenuOpen((o) => !o)}
        >
          {menuOpen ? <X size={17} aria-hidden="true" /> : <Menu size={17} aria-hidden="true" />}
          <span>Menu</span>
        </button>

        {menuOpen && (
          <div
            id={menuId}
            className="mf-hamburger-panel"
            role="region"
            aria-label="Categorized workspace settings"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mf-menu-header">
              <div className="mf-menu-title">
                <SlidersHorizontal size={14} aria-hidden="true" />
                <span>Map Settings &amp; Tools</span>
              </div>
              <button
                type="button"
                className="mf-btn"
                aria-label="Close settings menu"
                onClick={() => setMenuOpen(false)}
              >
                <X size={15} aria-hidden="true" />
              </button>
            </div>

            <div className="mf-menu-tabs" role="tablist" aria-label="Setting categories">
              {(
                [
                  { id: "all", label: "All" },
                  { id: "file", label: "File" },
                  { id: "layout", label: "Layout" },
                  { id: "theme", label: "Theme" },
                  { id: "tools", label: "Tools" },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={menuCategory === tab.id}
                  className={`mf-menu-tab ${menuCategory === tab.id ? "is-active" : ""}`}
                  onClick={() => setMenuCategory(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="mf-menu-body">
              {showSection("file") && (
                <section className="mf-menu-section" aria-label="File and auto-save">
                  <h3 className="mf-menu-section-title">File &amp; Auto-Save</h3>

                  <div className="mf-menu-btn-grid">
                    <button
                      type="button"
                      className="mf-menu-item-btn"
                      onClick={() => {
                        onCreateNewMap();
                        setMenuOpen(false);
                      }}
                    >
                      <FilePlus2 size={14} aria-hidden="true" />
                      <span>New Map</span>
                    </button>
                    <button
                      type="button"
                      className="mf-menu-item-btn"
                      onClick={() => {
                        onSaveNow();
                      }}
                    >
                      <Save size={14} aria-hidden="true" />
                      <span>Save Now</span>
                      <span className="mf-menu-kbd">Ctrl+S</span>
                    </button>
                    <button
                      type="button"
                      className="mf-menu-item-btn"
                      onClick={() => {
                        onImportFile();
                        setMenuOpen(false);
                      }}
                    >
                      <Upload size={14} aria-hidden="true" />
                      <span>Import (.json/.mup/.md)</span>
                    </button>
                    <button
                      type="button"
                      className="mf-menu-item-btn is-danger"
                      onClick={() => {
                        onDeleteCurrentMap();
                        setMenuOpen(false);
                      }}
                    >
                      <Trash2 size={14} aria-hidden="true" />
                      <span>Delete Map</span>
                    </button>
                  </div>

                  <div className="mf-menu-row">
                    <label htmlFor="mf-autosave-interval" className="mf-menu-label">
                      Auto-save interval
                    </label>
                    <select
                      id="mf-autosave-interval"
                      className="mf-select"
                      value={autoSaveIntervalSec}
                      onChange={(e) => onChangeAutoSaveInterval(Number(e.target.value))}
                    >
                      <option value={15}>Every 15s</option>
                      <option value={45}>Every 45s (Best)</option>
                      <option value={90}>Every 90s</option>
                      <option value={180}>Every 180s</option>
                    </select>
                  </div>

                  <div className="mf-menu-sublabel">
                    <Download size={12} aria-hidden="true" />
                    <span>Export Map</span>
                  </div>
                  <div className="mf-menu-chip-grid">
                    {EXPORT_FORMATS.map((fmt) => (
                      <button
                        key={fmt.id}
                        type="button"
                        className="mf-chip-btn"
                        onClick={() => {
                          onExportAction(fmt.id);
                          setMenuOpen(false);
                        }}
                      >
                        {fmt.label}
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {showSection("layout") && (
                <section className="mf-menu-section" aria-label="Layout and edge spacing">
                  <h3 className="mf-menu-section-title">Layout &amp; Edge Spacing</h3>

                  <div className="mf-menu-sublabel">Map Structure</div>
                  <div className="mf-menu-chip-grid">
                    {(
                      [
                        { id: "mindmap", label: "Radial Mind Map" },
                        { id: "tree-right", label: "Right Tree" },
                        { id: "org-chart", label: "Org Chart" },
                      ] as const
                    ).map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        className={`mf-chip-btn ${layout === mode.id ? "is-active" : ""}`}
                        onClick={() => onChangeLayout(mode.id)}
                      >
                        {mode.label}
                      </button>
                    ))}
                  </div>

                  <div className="mf-menu-sublabel">Connector Style</div>
                  <div className="mf-menu-chip-grid">
                    {(
                      [
                        { id: "bezier", label: "Curved" },
                        { id: "orthogonal", label: "Elbow" },
                        { id: "straight", label: "Straight" },
                      ] as const
                    ).map((conn) => (
                      <button
                        key={conn.id}
                        type="button"
                        className={`mf-chip-btn ${connectorStyle === conn.id ? "is-active" : ""}`}
                        onClick={() => onChangeConnector(conn.id)}
                      >
                        {conn.label}
                      </button>
                    ))}
                  </div>

                  <div className="mf-menu-row" style={{ marginTop: 8 }}>
                    <label htmlFor="mf-edge-distance" className="mf-menu-label">
                      Edge Horizontal Distance
                    </label>
                    <span className="mf-menu-value-badge">{horizontalGap}px</span>
                  </div>
                  <input
                    id="mf-edge-distance"
                    type="range"
                    className="mf-range-input"
                    min={MIN_HORIZONTAL_GAP}
                    max={MAX_HORIZONTAL_GAP}
                    step={4}
                    value={horizontalGap}
                    onChange={(e) => onChangeHorizontalGap(Number(e.target.value))}
                  />
                  <div className="mf-menu-chip-grid">
                    {EDGE_DISTANCE_PRESETS.map((preset) => (
                      <button
                        key={preset.value}
                        type="button"
                        className={`mf-chip-btn ${horizontalGap === preset.value ? "is-active" : ""}`}
                        onClick={() => onChangeHorizontalGap(preset.value)}
                      >
                        {preset.label} ({preset.value}px)
                      </button>
                    ))}
                  </div>
                </section>
              )}

              {showSection("theme") && (
                <section className="mf-menu-section" aria-label="Theme and display">
                  <h3 className="mf-menu-section-title">Theme &amp; Appearance</h3>

                  <div className="mf-menu-sublabel">Color Palette (Alt+M)</div>
                  <div className="mf-menu-chip-grid">
                    {Object.values(MIND_THEMES).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        className={`mf-chip-btn ${theme === t.id ? "is-active" : ""}`}
                        onClick={() => onChangeTheme(t.id)}
                      >
                        <span
                          className="mf-theme-dot"
                          style={{ background: t.rootBg }}
                          aria-hidden="true"
                        />
                        {t.name}
                      </button>
                    ))}
                  </div>

                  <div className="mf-menu-row" style={{ marginTop: 8 }}>
                    <span className="mf-menu-label">Color Mode (Alt+D)</span>
                    <button
                      type="button"
                      className="mf-chip-btn"
                      aria-pressed={isDark}
                      onClick={onToggleDarkLight}
                    >
                      {isDark ? (
                        <>
                          <Sun size={13} aria-hidden="true" /> Light Mode
                        </>
                      ) : (
                        <>
                          <Moon size={13} aria-hidden="true" /> Dark Mode
                        </>
                      )}
                    </button>
                  </div>
                </section>
              )}

              {showSection("tools") && (
                <section className="mf-menu-section" aria-label="Tools and shortcuts">
                  <h3 className="mf-menu-section-title">Tools &amp; Help</h3>
                  <div className="mf-menu-btn-grid">
                    <button
                      type="button"
                      className="mf-menu-item-btn"
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenSubtreePaste();
                      }}
                    >
                      <Sparkles size={14} aria-hidden="true" />
                      <span>LLM Subtree Paste</span>
                    </button>
                    <button
                      type="button"
                      className="mf-menu-item-btn"
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenImageModal();
                      }}
                    >
                      <ImagePlus size={14} aria-hidden="true" />
                      <span>Add Photo</span>
                      <span className="mf-menu-kbd">I</span>
                    </button>
                    <button
                      type="button"
                      className="mf-menu-item-btn"
                      onClick={() => {
                        setMenuOpen(false);
                        onToggleDrawer();
                      }}
                    >
                      <Paperclip size={14} aria-hidden="true" />
                      <span>Notes Drawer</span>
                      <span className="mf-menu-kbd">A</span>
                    </button>
                    <button
                      type="button"
                      className="mf-menu-item-btn"
                      onClick={() => {
                        setMenuOpen(false);
                        onOpenShortcuts();
                      }}
                    >
                      <Keyboard size={14} aria-hidden="true" />
                      <span>Shortcuts</span>
                      <HelpCircle size={12} aria-hidden="true" />
                    </button>
                  </div>
                </section>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
