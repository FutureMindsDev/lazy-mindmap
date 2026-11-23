import { useEffect, useId, useRef, useState } from "react";
import { useToolbarFocusGroup } from "../hooks/useToolbarFocusGroup";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  FilePlus2,
  Hand,
  HelpCircle,
  Keyboard,
  Loader2,
  Menu,
  Moon,
  MousePointer2,
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
  CanvasBackground,
  CanvasTool,
  ColorMode,
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
  canUndo: boolean;
  canRedo: boolean;
  tool: CanvasTool;
  layout: LayoutMode;
  theme: ThemeId;
  colorMode: ColorMode;
  connectorStyle: ConnectorStyle;
  horizontalGap: number;
  backgroundPattern: CanvasBackground;
  isDark: boolean;
  saveState: SaveState;
  syncStatus: string;
  lastSavedTime: string | null;
  saveError: string | null;
  autoSaveIntervalSec: number;
  onSelectMap: (id: string) => void;
  onCreateNewMap: () => void;
  onDeleteCurrentMap: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onSetTool: (tool: CanvasTool) => void;
  onAddDetachedRootNode: () => void;
  onChangeLayout: (layout: LayoutMode) => void;
  onChangeTheme: (theme: ThemeId) => void;
  onChangeColorMode: (mode: ColorMode) => void;
  onChangeConnector: (style: ConnectorStyle) => void;
  onChangeHorizontalGap: (gap: number) => void;
  onChangeBackgroundPattern: (bg: CanvasBackground) => void;
  onChangeAutoSaveInterval: (seconds: number) => void;
  onToggleDarkLight: () => void;
  onOpenLlmChat: () => void;
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

const BACKGROUND_OPTIONS: { id: CanvasBackground; label: string }[] = [
  { id: "dots", label: "Dots" },
  { id: "grid-sm", label: "Grid Small" },
  { id: "grid-md", label: "Grid Medium" },
  { id: "grid-lg", label: "Grid Large" },
  { id: "plain", label: "Plain" },
];

function renderLayoutPreviewSvg(mode: LayoutMode) {
  if (mode === "tree-right") {
    return (
      <svg className="mf-option-preview-svg" viewBox="0 0 72 38" aria-hidden="true">
        <path d="M22 19 C33 19 35 7 47 7" className="mf-svg-edge" />
        <path d="M22 19 L47 19" className="mf-svg-edge" />
        <path d="M22 19 C33 19 35 31 47 31" className="mf-svg-edge" />
        <rect x="4" y="14" width="18" height="10" rx="3" className="mf-svg-root" />
        <rect x="47" y="3" width="21" height="8" rx="2.5" className="mf-svg-node" />
        <rect x="47" y="15" width="21" height="8" rx="2.5" className="mf-svg-node" />
        <rect x="47" y="27" width="21" height="8" rx="2.5" className="mf-svg-node" />
      </svg>
    );
  }
  if (mode === "org-chart") {
    return (
      <svg className="mf-option-preview-svg" viewBox="0 0 72 38" aria-hidden="true">
        <path
          d="M36 13 L36 19 M13 19 L59 19 M13 19 L13 25 M36 19 L36 25 M59 19 L59 25"
          className="mf-svg-edge"
        />
        <rect x="26" y="3" width="20" height="10" rx="3" className="mf-svg-root" />
        <rect x="4" y="25" width="18" height="9" rx="2.5" className="mf-svg-node" />
        <rect x="27" y="25" width="18" height="9" rx="2.5" className="mf-svg-node" />
        <rect x="50" y="25" width="18" height="9" rx="2.5" className="mf-svg-node" />
      </svg>
    );
  }
  return (
    <svg className="mf-option-preview-svg" viewBox="0 0 72 38" aria-hidden="true">
      <path d="M27 19 C21 19 20 9 14 9" className="mf-svg-edge" />
      <path d="M27 19 C21 19 20 29 14 29" className="mf-svg-edge" />
      <path d="M45 19 C51 19 52 9 58 9" className="mf-svg-edge" />
      <path d="M45 19 C51 19 52 29 58 29" className="mf-svg-edge" />
      <rect x="27" y="14" width="18" height="10" rx="3" className="mf-svg-root" />
      <rect x="3" y="5" width="11" height="8" rx="2.5" className="mf-svg-node" />
      <rect x="3" y="25" width="11" height="8" rx="2.5" className="mf-svg-node" />
      <rect x="58" y="5" width="11" height="8" rx="2.5" className="mf-svg-node" />
      <rect x="58" y="25" width="11" height="8" rx="2.5" className="mf-svg-node" />
    </svg>
  );
}

function renderConnectorPreviewSvg(style: ConnectorStyle) {
  let paths: [string, string];
  if (style === "orthogonal") {
    paths = ["M18 17 L34 17 L34 8 L50 8", "M18 17 L34 17 L34 26 L50 26"];
  } else if (style === "straight") {
    paths = ["M18 17 L50 8", "M18 17 L50 26"];
  } else {
    paths = ["M18 17 C33 17 34 8 50 8", "M18 17 C33 17 34 26 50 26"];
  }
  return (
    <svg className="mf-option-preview-svg" viewBox="0 0 72 34" aria-hidden="true">
      <path d={paths[0]} className="mf-svg-edge" />
      <path d={paths[1]} className="mf-svg-edge" />
      <rect x="4" y="12" width="14" height="10" rx="3" className="mf-svg-root" />
      <rect x="50" y="4" width="18" height="8" rx="2.5" className="mf-svg-node" />
      <rect x="50" y="22" width="18" height="8" rx="2.5" className="mf-svg-node" />
    </svg>
  );
}

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
  canUndo,
  canRedo,
  tool,
  layout,
  theme,
  colorMode,
  connectorStyle,
  horizontalGap,
  backgroundPattern,
  isDark,
  saveState,
  syncStatus,
  lastSavedTime,
  saveError,
  autoSaveIntervalSec,
  onSelectMap,
  onCreateNewMap,
  onDeleteCurrentMap,
  onUndo,
  onRedo,
  onSetTool,
  onAddDetachedRootNode,
  onChangeLayout,
  onChangeTheme,
  onChangeColorMode,
  onChangeConnector,
  onChangeHorizontalGap,
  onChangeBackgroundPattern,
  onChangeAutoSaveInterval,
  onToggleDarkLight,
  onOpenLlmChat,
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
    const onPointerDown = (e: PointerEvent) => {
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
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
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

        <div role="group" aria-label="Search" className="mf-toolbar-group">
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
          aria-label={`Save status: ${syncStatus}${
            saveState === "saved" && lastSavedTime ? ` at ${lastSavedTime}` : ""
          }. Click to save now.`}
          onClick={onSaveNow}
        >
          {renderSaveIcon()}
          <span>{syncStatus}</span>
          {saveState === "saved" && lastSavedTime && (
            <span className="mf-sync-time">· {lastSavedTime}</span>
          )}
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

                  <div className="mf-menu-row">
                    <label htmlFor="mf-map-switcher" className="mf-menu-label">
                      Current map
                    </label>
                    <select
                      id="mf-map-switcher"
                      className="mf-select mf-map-switcher"
                      value={activeMapId}
                      onChange={(e) => {
                        onSelectMap(e.target.value);
                        setMenuOpen(false);
                      }}
                    >
                      {maps.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.title} ({m.nodeCount})
                        </option>
                      ))}
                    </select>
                  </div>

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
                  <div className="mf-preview-chip-grid">
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
                        aria-pressed={layout === mode.id}
                        className={`mf-chip-btn mf-preview-chip-btn ${layout === mode.id ? "is-active" : ""}`}
                        onClick={() => onChangeLayout(mode.id)}
                      >
                        <span className="mf-preview-chip-label">{mode.label}</span>
                        {renderLayoutPreviewSvg(mode.id)}
                      </button>
                    ))}
                  </div>

                  <div className="mf-menu-sublabel">Connector Style</div>
                  <div className="mf-preview-chip-grid">
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
                        aria-pressed={connectorStyle === conn.id}
                        className={`mf-chip-btn mf-preview-chip-btn ${connectorStyle === conn.id ? "is-active" : ""}`}
                        onClick={() => onChangeConnector(conn.id)}
                      >
                        <span className="mf-preview-chip-label">{conn.label}</span>
                        {renderConnectorPreviewSvg(conn.id)}
                      </button>
                    ))}
                  </div>

                  <div className="mf-menu-sublabel">Background</div>
                  <div className="mf-menu-chip-grid">
                    {BACKGROUND_OPTIONS.map((bg) => (
                      <button
                        key={bg.id}
                        type="button"
                        aria-pressed={backgroundPattern === bg.id}
                        className={`mf-chip-btn ${backgroundPattern === bg.id ? "is-active" : ""}`}
                        onClick={() => onChangeBackgroundPattern(bg.id)}
                      >
                        {bg.label}
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

                  <div className="mf-menu-sublabel">Node &amp; Edge Color Mode</div>
                  <div className="mf-menu-chip-grid">
                    {(
                      [
                        {
                          id: "contrast",
                          label: isDark ? "Contrast (Light)" : "Contrast (Dark)",
                        },
                        { id: "colorful", label: "Colorful" },
                        { id: "custom", label: "Custom" },
                      ] as const
                    ).map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className={`mf-chip-btn ${colorMode === m.id ? "is-active" : ""}`}
                        onClick={() => onChangeColorMode(m.id)}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>

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
                        onOpenLlmChat();
                      }}
                    >
                      <Sparkles size={14} aria-hidden="true" />
                      <span>AI Assistant Chat</span>
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
