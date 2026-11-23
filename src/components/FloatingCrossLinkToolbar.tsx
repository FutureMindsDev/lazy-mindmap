import { useEffect, useRef, useState } from "react";
import { BringToFront, SendToBack, Trash2, X } from "lucide-react";
import { useToolbarFocusGroup } from "../hooks/useToolbarFocusGroup";
import type { CrossLink, CrossLinkLayer, CrossLinkStrokeStyle } from "../types/mindmap";
import { NODE_COLOR_SWATCHES } from "../utils/themes";

interface FloatingCrossLinkToolbarProps {
  crossLink: CrossLink;
  anchorPoint: { x: number; y: number };
  viewport: { x: number; y: number; scale: number };
  containerRect: { width: number; height: number };
  onUpdateCrossLink: (patch: Partial<CrossLink>) => void;
  onDeleteCrossLink: () => void;
  onDeselect: () => void;
}

export function FloatingCrossLinkToolbar({
  crossLink,
  anchorPoint,
  viewport,
  containerRect,
  onUpdateCrossLink,
  onDeleteCrossLink,
  onDeselect,
}: FloatingCrossLinkToolbarProps) {
  const [colorPanelOpen, setColorPanelOpen] = useState(false);
  const barRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  useToolbarFocusGroup(toolbarRef);

  const currentColor = crossLink.color || "#f59e0b";
  const currentLayer: CrossLinkLayer = crossLink.layer || "above";
  const currentStyle: CrossLinkStrokeStyle = crossLink.strokeStyle || "dashed";

  useEffect(() => {
    if (!colorPanelOpen) return;
    const onDown = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        setColorPanelOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setColorPanelOpen(false);
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [colorPanelOpen]);

  const screenX = viewport.x + anchorPoint.x * viewport.scale;
  const screenY = viewport.y + anchorPoint.y * viewport.scale;
  const leftPx = Math.min(Math.max(190, screenX), Math.max(190, containerRect.width - 190));
  const topPx = Math.max(60, Math.min(containerRect.height - 96, screenY - 56));

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
      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Cross-link line options"
        className="mf-context-toolbar"
        {...({ focusgroup: "toolbar wrap" } as Record<string, string>)}
      >
        {/* Cross-link Color */}
        <div role="group" aria-label="Line color" className="mf-toolbar-group">
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Cross-link line color"
            aria-expanded={colorPanelOpen}
            title="Change cross-link line color"
            onClick={() => setColorPanelOpen((o) => !o)}
          >
            <span
              className="mf-color-dot mf-color-dot-solo"
              style={{ background: currentColor, borderColor: "#ffffff" }}
            />
          </button>
        </div>

        <span role="separator" aria-orientation="vertical" className="mf-ctx-sep" />

        {/* Layer (Above / Behind Nodes) */}
        <div role="group" aria-label="Cross-link layer order" className="mf-toolbar-group">
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Show cross-link above nodes"
            aria-pressed={currentLayer === "above"}
            title="Show line above all nodes"
            onClick={() => onUpdateCrossLink({ layer: "above" })}
          >
            <BringToFront size={14} aria-hidden="true" />
            <span className="mf-ctx-label">Above</span>
          </button>
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Show cross-link behind nodes"
            aria-pressed={currentLayer === "behind"}
            title="Show line behind nodes"
            onClick={() => onUpdateCrossLink({ layer: "behind" })}
          >
            <SendToBack size={14} aria-hidden="true" />
            <span className="mf-ctx-label">Behind</span>
          </button>
        </div>

        <span role="separator" aria-orientation="vertical" className="mf-ctx-sep" />

        {/* Line Pattern (Dashed / Dotted / Continuous) */}
        <div role="group" aria-label="Line pattern" className="mf-toolbar-group">
          {(
            [
              { id: "dashed", label: "Dashed", dash: "4 3" },
              { id: "dotted", label: "Dotted", dash: "1.5 3" },
              { id: "solid", label: "Solid", dash: undefined },
            ] as const
          ).map((pat) => (
            <button
              key={pat.id}
              type="button"
              className="mf-ctx-btn"
              aria-label={`${pat.label} line`}
              aria-pressed={currentStyle === pat.id}
              title={`${pat.label} line style`}
              onClick={() => onUpdateCrossLink({ strokeStyle: pat.id })}
            >
              <svg width="18" height="10" viewBox="0 0 18 10" aria-hidden="true">
                <line
                  x1="1"
                  y1="5"
                  x2="17"
                  y2="5"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                  strokeDasharray={pat.dash}
                />
              </svg>
              <span className="mf-ctx-label">{pat.label}</span>
            </button>
          ))}
        </div>

        <span role="separator" aria-orientation="vertical" className="mf-ctx-sep" />

        {/* Delete & Deselect */}
        <div role="group" aria-label="Cross-link actions" className="mf-toolbar-group">
          <button
            type="button"
            className="mf-ctx-btn mf-ctx-danger"
            aria-label="Delete cross-link"
            title="Delete cross-link (Backspace)"
            onClick={onDeleteCrossLink}
          >
            <Trash2 size={14} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Deselect cross-link"
            title="Close cross-link toolbar (Esc)"
            onClick={onDeselect}
          >
            <X size={14} aria-hidden="true" />
          </button>
        </div>
      </div>

      {colorPanelOpen && (
        <div className="mf-ctx-popover">
          <div className="mf-ctx-popover-title">Cross-Link Color</div>
          <div className="mf-swatch-grid">
            {NODE_COLOR_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className="mf-swatch"
                aria-label={`Line color ${swatch}`}
                style={{ background: swatch }}
                onClick={() => onUpdateCrossLink({ color: swatch })}
              />
            ))}
          </div>
          <div className="mf-color-inputs-row">
            <label>
              <span>Custom</span>
              <input
                type="color"
                value={currentColor}
                onChange={(e) => onUpdateCrossLink({ color: e.target.value })}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
