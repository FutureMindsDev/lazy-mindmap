import { useEffect, useRef, useState } from "react";
import { useToolbarFocusGroup } from "../hooks/useToolbarFocusGroup";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Bold,
  CheckSquare,
  CopyPlus,
  CornerDownRight,
  Eye,
  FolderMinus,
  FolderPlus,
  GitBranchPlus,
  GitFork,
  ImagePlus,
  Italic,
  Maximize2,
  Paperclip,
  Pipette,
  RotateCcw,
  Shapes,
  Smile,
  Spline,
  Trash2,
  Type,
  X,
} from "lucide-react";
import type {
  ColorMode,
  LayoutNodeInfo,
  MindMapNode,
  NodeAlign,
  NodeImage,
  NodeShape,
} from "../types/mindmap";
import { FONT_SIZE_PRESETS, getContrastTextColor, NODE_PALETTE_SWATCHES } from "../utils/themes";

type ActivePanel = "color" | "edge-color" | "font" | "shape" | "photo" | "tasks" | null;

interface FloatingNodeToolbarProps {
  selectedNodes: MindMapNode[];
  totalVisibleCount: number;
  anchorLayout: LayoutNodeInfo | undefined;
  colorMode?: ColorMode;
  viewport: { x: number; y: number; scale: number };
  containerRect: { width: number; height: number };
  onClearMultiSelect: () => void;
  onAddChild: () => void;
  onAddSibling: () => void;
  onInsertParent: () => void;
  moveCapabilities?: {
    canMoveUp: boolean;
    canMoveDown: boolean;
    canMoveLeft: boolean;
    canMoveRight: boolean;
  };
  onMoveNode: (direction: "up" | "down" | "left" | "right") => void;
  onSetColors: (colors: {
    color?: string;
    borderColor?: string;
    edgeColor?: string;
    textColor?: string | null;
  }) => void;
  onResetColors: () => void;
  onSetFontSize: (size: number | "reset") => void;
  onAdjustFontSize: (mode: "inc" | "dec") => void;
  onSetShape: (shape: NodeShape) => void;
  onResizeNodes: (dims: { width?: number; minHeight?: number } | "auto") => void;
  onSetAlign: (align: NodeAlign) => void;
  onToggleFormatting: (wrapper: "**" | "*" | "~~" | "`") => void;
  onToggleAllTasks: (checked: boolean) => void;
  onAddTaskItem: () => void;
  onOpenImagePicker: () => void;
  onUpdatePhotoProps: (patch: Partial<NodeImage>) => void;
  onOpenPhotoLightbox: (img: NodeImage) => void;
  onRemovePhotos: () => void;
  onOpenDrawer: () => void;
  onToggleStickers: () => void;
  isCrossLinkMode?: boolean;
  onToggleCrossLink: () => void;
  onBatchCollapse: (collapsed: boolean) => void;
  onDuplicateNodes: () => void;
  onDeleteNodes: () => void;
}

export function FloatingNodeToolbar({
  selectedNodes,
  totalVisibleCount,
  anchorLayout,
  colorMode = "colorful",
  viewport,
  containerRect,
  onClearMultiSelect,
  onAddChild,
  onAddSibling,
  onInsertParent,
  moveCapabilities,
  onMoveNode,
  onSetColors,
  onResetColors,
  onSetFontSize,
  onAdjustFontSize,
  onSetShape,
  onResizeNodes,
  onSetAlign,
  onToggleFormatting,
  onToggleAllTasks,
  onAddTaskItem,
  onOpenImagePicker,
  onUpdatePhotoProps,
  onOpenPhotoLightbox,
  onRemovePhotos,
  onOpenDrawer,
  onToggleStickers,
  isCrossLinkMode = false,
  onToggleCrossLink,
  onBatchCollapse,
  onDuplicateNodes,
  onDeleteNodes,
}: FloatingNodeToolbarProps) {
  const [panel, setPanel] = useState<ActivePanel>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useToolbarFocusGroup(toolbarRef);

  const primary = selectedNodes[0];
  const isMulti = selectedNodes.length > 1;
  const isAll = isMulti && selectedNodes.length >= totalVisibleCount;
  const isRoot = primary?.parentId === null;
  const useCustomColors = colorMode === "custom";
  const rawCustomFill = primary?.style?.color;
  const hasExplicitNoFill = useCustomColors && rawCustomFill === "none";
  const effectiveFill: string | null = hasExplicitNoFill
    ? null
    : useCustomColors && rawCustomFill
    ? rawCustomFill
    : isRoot
    ? anchorLayout?.branchColor || "#2563eb"
    : null;
  const pickerFillValue =
    effectiveFill && /^#[0-9a-f]{6}$/i.test(effectiveFill) ? effectiveFill : "#2563eb";
  const currentEdge = primary?.style?.edgeColor || anchorLayout?.branchColor || "#2563eb";
  const pickerEdgeValue = /^#[0-9a-f]{6}$/i.test(currentEdge) ? currentEdge : "#2563eb";
  const currentFont = primary?.style?.fontSize ?? (primary?.parentId === null ? 16 : 14);
  const currentShape = primary?.style?.shape || "rounded";

  const nodesWithImages = selectedNodes.filter((n) => n.images && n.images.length > 0);
  const totalPhotos = nodesWithImages.reduce((acc, n) => acc + (n.images?.length || 0), 0);
  const firstPhoto = nodesWithImages[0]?.images?.[0];

  const [captionDraft, setCaptionDraft] = useState(firstPhoto?.caption || "");
  useEffect(() => {
    setCaptionDraft(firstPhoto?.caption || "");
  }, [firstPhoto?.id, firstPhoto?.caption]);

  // Close open sub-panel on Escape or outside click
  useEffect(() => {
    if (!panel) return;
    const onDown = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setPanel(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPanel(null);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [panel]);

  if (!primary) return null;

  // Position toolbar cleanly above the selected node, or top-center when multiple nodes selected
  let leftPx = Math.max(16, containerRect.width / 2);
  let topPx = 64;
  if (!isMulti && anchorLayout) {
    const screenCenterX = viewport.x + (anchorLayout.x + anchorLayout.width / 2) * viewport.scale;
    const screenTopY = viewport.y + anchorLayout.y * viewport.scale;
    leftPx = Math.min(Math.max(240, screenCenterX), Math.max(240, containerRect.width - 240));
    topPx = Math.max(60, Math.min(containerRect.height - 96, screenTopY - 56));
    if (screenTopY < 110) {
      topPx = Math.min(
        containerRect.height - 80,
        viewport.y + (anchorLayout.y + anchorLayout.height) * viewport.scale + 16
      );
    }
  }

  const togglePanel = (target: ActivePanel) => setPanel((p) => (p === target ? null : target));

  return (
    <div
      ref={barRef}
      className="mf-context-toolbar-wrap"
      style={{
        left: `${leftPx}px`,
        top: `${topPx}px`,
        transform: "translateX(-50%)",
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {isMulti && (
        <div className="mf-selection-pill">
          <span>
            {isAll
              ? `All ${selectedNodes.length} nodes selected`
              : `${selectedNodes.length} nodes selected`}
          </span>
          <button
            type="button"
            className="mf-selection-clear"
            title="Clear multi-selection (Esc)"
            onClick={onClearMultiSelect}
          >
            <X size={12} aria-hidden="true" /> Esc
          </button>
        </div>
      )}

      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Selected node styling and photo actions"
        className="mf-context-toolbar"
        {...({ focusgroup: "toolbar wrap" } as Record<string, string>)}
      >
        {/* Node Creation */}
        {!isMulti && (
          <>
            <div role="group" aria-label="Create nodes" className="mf-toolbar-group">
              <button
                type="button"
                className="mf-ctx-btn"
                aria-label="Add child node (Tab)"
                title="Add child node (Tab)"
                onClick={onAddChild}
              >
                <GitBranchPlus size={14} aria-hidden="true" />
                <span className="mf-ctx-label">Child</span>
              </button>
              <button
                type="button"
                className="mf-ctx-btn"
                aria-label="Add sibling node (Enter)"
                title="Add sibling node (Enter)"
                onClick={onAddSibling}
              >
                <CornerDownRight size={14} aria-hidden="true" />
                <span className="mf-ctx-label">Sibling</span>
              </button>
              <button
                type="button"
                className="mf-ctx-btn"
                aria-label="Insert parent node (Shift+Tab)"
                title="Insert parent node (Shift+Tab)"
                onClick={onInsertParent}
              >
                <GitFork size={14} aria-hidden="true" />
              </button>
            </div>
            {primary.parentId !== null && moveCapabilities && (
              <>
                <span role="separator" aria-orientation="vertical" className="mf-ctx-sep" />
                <div role="group" aria-label="Move node position" className="mf-toolbar-group">
                  <button
                    type="button"
                    className="mf-ctx-btn"
                    aria-label="Move node up among siblings (Ctrl+Up)"
                    title="Move node up (Ctrl+Up)"
                    aria-disabled={!moveCapabilities.canMoveUp ? "true" : undefined}
                    onClick={() => moveCapabilities.canMoveUp && onMoveNode("up")}
                  >
                    <ArrowUp size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="mf-ctx-btn"
                    aria-label="Move node down among siblings (Ctrl+Down)"
                    title="Move node down (Ctrl+Down)"
                    aria-disabled={!moveCapabilities.canMoveDown ? "true" : undefined}
                    onClick={() => moveCapabilities.canMoveDown && onMoveNode("down")}
                  >
                    <ArrowDown size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="mf-ctx-btn"
                    aria-label="Move node left of parent (Ctrl+Left)"
                    title="Move left (Ctrl+Left)"
                    aria-disabled={!moveCapabilities.canMoveLeft ? "true" : undefined}
                    onClick={() => moveCapabilities.canMoveLeft && onMoveNode("left")}
                  >
                    <ArrowLeft size={14} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="mf-ctx-btn"
                    aria-label="Move node right of parent (Ctrl+Right)"
                    title="Move right (Ctrl+Right)"
                    aria-disabled={!moveCapabilities.canMoveRight ? "true" : undefined}
                    onClick={() => moveCapabilities.canMoveRight && onMoveNode("right")}
                  >
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </div>
              </>
            )}
            <span role="separator" aria-orientation="vertical" className="mf-ctx-sep" />
          </>
        )}

        {/* Color & Node+Edge Color */}
        <div role="group" aria-label="Colors" className="mf-toolbar-group">
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label={effectiveFill ? "Node fill color picker" : "Node fill color picker (No fill)"}
            aria-expanded={panel === "color"}
            title={effectiveFill ? "Choose node fill color" : "Node fill color (No fill)"}
            onClick={() => togglePanel("color")}
          >
            <span
              className={`mf-color-dot mf-color-dot-solo ${effectiveFill ? "" : "is-no-fill"}`}
              style={effectiveFill ? { background: effectiveFill } : undefined}
            />
          </button>
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Node and edge color picker"
            aria-expanded={panel === "edge-color"}
            title="Change node & connected edge color"
            onClick={() => togglePanel("edge-color")}
          >
            <span
              className="mf-edge-color-line"
              style={{ background: currentEdge }}
              aria-hidden="true"
            />
          </button>
        </div>

        <span role="separator" aria-orientation="vertical" className="mf-ctx-sep" />

        {/* Typography & Font Size */}
        <div role="group" aria-label="Typography" className="mf-toolbar-group">
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Font size and text formatting"
            aria-expanded={panel === "font"}
            title="Font size & text formatting"
            onClick={() => togglePanel("font")}
          >
            <Type size={15} aria-hidden="true" />
            <span className="mf-ctx-label">{currentFont}px</span>
          </button>
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Bold"
            title="Toggle Bold (**text**)"
            onClick={() => onToggleFormatting("**")}
          >
            <Bold size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Italic"
            title="Toggle Italic (*text*)"
            onClick={() => onToggleFormatting("*")}
          >
            <Italic size={14} aria-hidden="true" />
          </button>
        </div>

        <span role="separator" aria-orientation="vertical" className="mf-ctx-sep" />

        {/* Shape, Size & Alignment */}
        <div role="group" aria-label="Shape, size and alignment" className="mf-toolbar-group">
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Node shape and dimensions"
            aria-expanded={panel === "shape"}
            title="Node shape & resize presets"
            onClick={() => togglePanel("shape")}
          >
            <Shapes size={15} aria-hidden="true" />
            <span className="mf-ctx-label">{currentShape}</span>
          </button>
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Align left"
            title="Align Left (Shift+Ctrl+L)"
            onClick={() => onSetAlign("left")}
          >
            <AlignLeft size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Align center"
            title="Align Center (Shift+Ctrl+E)"
            onClick={() => onSetAlign("center")}
          >
            <AlignCenter size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Align right"
            title="Align Right (Shift+Ctrl+R)"
            onClick={() => onSetAlign("right")}
          >
            <AlignRight size={14} aria-hidden="true" />
          </button>
        </div>

        <span role="separator" aria-orientation="vertical" className="mf-ctx-sep" />

        {/* Photo Actions, Tasks, Notes & Node Actions */}
        <div role="group" aria-label="Photos, tasks and actions" className="mf-toolbar-group">
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Photo actions"
            aria-expanded={panel === "photo"}
            title="Photo upload, resize, placement & actions"
            onClick={() => togglePanel("photo")}
          >
            <ImagePlus size={15} aria-hidden="true" />
            {totalPhotos > 0 && <span className="mf-ctx-badge">{totalPhotos}</span>}
          </button>
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Checklist actions"
            aria-expanded={panel === "tasks"}
            title="Checklist & task actions"
            onClick={() => togglePanel("tasks")}
          >
            <CheckSquare size={15} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Notes and attachments (A)"
            title="Notes & Attachments (A)"
            onClick={onOpenDrawer}
          >
            <Paperclip size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Stickers (Shift+S)"
            title="Add stickers (Shift+S)"
            onClick={onToggleStickers}
          >
            <Smile size={14} aria-hidden="true" />
          </button>
          {selectedNodes.length <= 2 && (
            <button
              type="button"
              className="mf-ctx-btn"
              aria-label={
                selectedNodes.length === 2
                  ? "Connect selected nodes with cross-link (Alt+X)"
                  : isCrossLinkMode
                  ? "Cancel cross-link mode (Esc)"
                  : "Draw cross-link (Alt+X)"
              }
              aria-pressed={selectedNodes.length === 1 ? isCrossLinkMode : undefined}
              title={
                selectedNodes.length === 2
                  ? "Connect these 2 nodes with cross-link (Alt+X)"
                  : isCrossLinkMode
                  ? "Cancel cross-link mode (Esc)"
                  : "Draw cross-link arrow (Alt+X)"
              }
              onClick={onToggleCrossLink}
            >
              <Spline size={14} aria-hidden="true" />
              <span className="mf-ctx-label">Link</span>
            </button>
          )}
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Fold selected branches"
            title="Collapse selected branches"
            onClick={() => onBatchCollapse(true)}
          >
            <FolderMinus size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Unfold selected branches"
            title="Expand selected branches"
            onClick={() => onBatchCollapse(false)}
          >
            <FolderPlus size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Duplicate selected node(s)"
            title="Duplicate selected node(s)"
            onClick={onDuplicateNodes}
          >
            <CopyPlus size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mf-ctx-btn mf-ctx-danger"
            aria-label="Delete selected node(s)"
            title="Delete selected node(s) (Backspace)"
            onClick={onDeleteNodes}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Sub-Panels */}
      {panel === "color" && (
        <div className="mf-ctx-popover">
          <div className="mf-ctx-popover-title">
            <span>{isMulti ? `Color for ${selectedNodes.length} Selected Nodes` : "Node Colors"}</span>
            <button
              type="button"
              className="mf-chip-btn mf-popover-reset"
              title="Reset to theme branch color"
              onClick={onResetColors}
            >
              <RotateCcw size={12} aria-hidden="true" /> Auto
            </button>
          </div>

          <div className="mf-swatch-grid mf-swatch-grid-fill">
            <label className="mf-swatch mf-swatch-picker" title="Custom color">
              <Pipette size={14} aria-hidden="true" />
              <input
                type="color"
                aria-label="Custom fill color"
                value={pickerFillValue}
                onChange={(e) =>
                  onSetColors({
                    color: e.target.value,
                    textColor: getContrastTextColor(e.target.value),
                  })
                }
              />
            </label>
            <button
              type="button"
              className={`mf-swatch mf-swatch-no-fill ${!effectiveFill ? "is-selected" : ""}`}
              aria-label="No fill"
              aria-pressed={!effectiveFill}
              title="No fill"
              onClick={() => onSetColors({ color: "none" })}
            />
            {NODE_PALETTE_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className={`mf-swatch ${
                  effectiveFill?.toLowerCase() === swatch.toLowerCase() ? "is-selected" : ""
                }`}
                aria-label={`Fill color ${swatch}`}
                style={{ background: swatch }}
                onClick={() =>
                  onSetColors({
                    color: swatch,
                    borderColor: swatch,
                    textColor: getContrastTextColor(swatch),
                  })
                }
              />
            ))}
          </div>
        </div>
      )}

      {panel === "edge-color" && (
        <div className="mf-ctx-popover">
          <div className="mf-ctx-popover-title">
            <span>
              {isMulti
                ? `Node + Edge Color (${selectedNodes.length} Nodes)`
                : "Node & Connected Edge Color"}
            </span>
            <button
              type="button"
              className="mf-chip-btn mf-popover-reset"
              title="Reset to theme branch color"
              onClick={onResetColors}
            >
              <RotateCcw size={12} aria-hidden="true" /> Auto
            </button>
          </div>

          <div className="mf-swatch-grid">
            <label className="mf-swatch mf-swatch-picker" title="Custom color">
              <Pipette size={14} aria-hidden="true" />
              <input
                type="color"
                aria-label="Custom border and edge color"
                value={pickerEdgeValue}
                onChange={(e) => {
                  const v = e.target.value;
                  onSetColors({ edgeColor: v, borderColor: v });
                }}
              />
            </label>
            {NODE_PALETTE_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className="mf-swatch"
                aria-label={`Border and edge color ${swatch}`}
                style={{ background: swatch }}
                onClick={() =>
                  onSetColors({
                    edgeColor: swatch,
                    borderColor: swatch,
                  })
                }
              />
            ))}
          </div>
        </div>
      )}

      {panel === "font" && (
        <div className="mf-ctx-popover">
          <div className="mf-ctx-popover-title">Font Size</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            {FONT_SIZE_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className={`mf-chip-btn ${currentFont === preset.size ? "is-active" : ""}`}
                onClick={() => onSetFontSize(preset.size)}
              >
                {preset.label} ({preset.size}px)
              </button>
            ))}
            <button type="button" className="mf-chip-btn" onClick={() => onAdjustFontSize("dec")}>
              A-
            </button>
            <button type="button" className="mf-chip-btn" onClick={() => onAdjustFontSize("inc")}>
              A+
            </button>
            <button type="button" className="mf-chip-btn" onClick={() => onSetFontSize("reset")}>
              Reset
            </button>
          </div>
        </div>
      )}

      {panel === "shape" && (
        <div className="mf-ctx-popover">
          <div className="mf-ctx-popover-title">Shape &amp; Node Dimensions</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
            {(["rounded", "card", "underline", "cloud"] as NodeShape[]).map((sh) => (
              <button
                key={sh}
                type="button"
                className={`mf-chip-btn ${currentShape === sh ? "is-active" : ""}`}
                onClick={() => onSetShape(sh)}
              >
                {sh}
              </button>
            ))}
          </div>

          <div className="mf-ctx-popover-title">
            <Maximize2 size={11} style={{ marginRight: 4 }} aria-hidden="true" />
            Node Width (or drag corner handle)
          </div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" className="mf-chip-btn" onClick={() => onResizeNodes("auto")}>
              Auto Fit
            </button>
            <button
              type="button"
              className="mf-chip-btn"
              onClick={() => onResizeNodes({ width: 180 })}
            >
              Compact (180px)
            </button>
            <button
              type="button"
              className="mf-chip-btn"
              onClick={() => onResizeNodes({ width: 280 })}
            >
              Medium (280px)
            </button>
            <button
              type="button"
              className="mf-chip-btn"
              onClick={() => onResizeNodes({ width: 400 })}
            >
              Wide (400px)
            </button>
          </div>
        </div>
      )}

      {panel === "tasks" && (
        <div className="mf-ctx-popover">
          <div className="mf-ctx-popover-title">Checklist Actions</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <button type="button" className="mf-chip-btn" onClick={onAddTaskItem}>
              + Add Task Line
            </button>
            <button
              type="button"
              className="mf-chip-btn"
              onClick={() => onToggleAllTasks(true)}
            >
              Check All Tasks
            </button>
            <button
              type="button"
              className="mf-chip-btn"
              onClick={() => onToggleAllTasks(false)}
            >
              Uncheck All Tasks
            </button>
          </div>
        </div>
      )}

      {panel === "photo" && (
        <div className="mf-ctx-popover" style={{ minWidth: 290 }}>
          <div className="mf-ctx-popover-title">
            Photo Actions ({totalPhotos} on {isMulti ? `${selectedNodes.length} nodes` : "node"})
          </div>

          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
            <button
              type="button"
              className="mf-chip-btn"
              onClick={() => {
                setPanel(null);
                onOpenImagePicker();
              }}
            >
              <ImagePlus size={12} aria-hidden="true" /> Add / Upload Photo (I)
            </button>
            {firstPhoto && !isMulti && (
              <button
                type="button"
                className="mf-chip-btn"
                onClick={() => {
                  setPanel(null);
                  onOpenPhotoLightbox(firstPhoto);
                }}
              >
                <Eye size={12} aria-hidden="true" /> Full Preview
              </button>
            )}
          </div>

          {totalPhotos > 0 && (
            <>
              <div className="mf-ctx-popover-sub">Photo Size</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                {[120, 200, 280, 380].map((w) => (
                  <button
                    key={w}
                    type="button"
                    className={`mf-chip-btn ${firstPhoto?.width === w ? "is-active" : ""}`}
                    onClick={() => onUpdatePhotoProps({ width: w })}
                  >
                    {w}px
                  </button>
                ))}
              </div>

              <div className="mf-ctx-popover-sub">Placement &amp; Fit</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                <button
                  type="button"
                  className={`mf-chip-btn ${firstPhoto?.position !== "bottom" ? "is-active" : ""}`}
                  onClick={() => onUpdatePhotoProps({ position: "top" })}
                >
                  Above Text
                </button>
                <button
                  type="button"
                  className={`mf-chip-btn ${firstPhoto?.position === "bottom" ? "is-active" : ""}`}
                  onClick={() => onUpdatePhotoProps({ position: "bottom" })}
                >
                  Below Text
                </button>
                <button
                  type="button"
                  className={`mf-chip-btn ${firstPhoto?.fit !== "cover" ? "is-active" : ""}`}
                  onClick={() => onUpdatePhotoProps({ fit: "contain" })}
                >
                  Contain
                </button>
                <button
                  type="button"
                  className={`mf-chip-btn ${firstPhoto?.fit === "cover" ? "is-active" : ""}`}
                  onClick={() => onUpdatePhotoProps({ fit: "cover", height: 140 })}
                >
                  Crop Cover
                </button>
              </div>

              <div className="mf-ctx-popover-sub">Photo Alignment</div>
              <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginBottom: 8 }}>
                {(["left", "center", "right"] as const).map((al) => (
                  <button
                    key={al}
                    type="button"
                    className={`mf-chip-btn ${(firstPhoto?.align || "left") === al ? "is-active" : ""}`}
                    onClick={() => onUpdatePhotoProps({ align: al })}
                  >
                    {al}
                  </button>
                ))}
              </div>

              <div className="mf-ctx-popover-sub">Caption</div>
              <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
                <input
                  type="text"
                  value={captionDraft}
                  placeholder="Photo caption…"
                  onChange={(e) => setCaptionDraft(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === "Enter") {
                      onUpdatePhotoProps({ caption: captionDraft.trim() || undefined });
                    }
                  }}
                  style={{
                    flex: 1,
                    padding: "4px 7px",
                    borderRadius: 6,
                    border: "1px solid var(--border-color)",
                    background: "var(--bg-elevated)",
                    color: "var(--text-primary)",
                    fontSize: "0.78rem",
                  }}
                />
                <button
                  type="button"
                  className="mf-chip-btn"
                  onClick={() =>
                    onUpdatePhotoProps({ caption: captionDraft.trim() || undefined })
                  }
                >
                  Save
                </button>
              </div>

              <button
                type="button"
                className="mf-chip-btn mf-ctx-danger-btn"
                onClick={() => {
                  onRemovePhotos();
                  setPanel(null);
                }}
              >
                <Trash2 size={12} aria-hidden="true" /> Remove Photo(s)
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
