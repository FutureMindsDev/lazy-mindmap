import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { BringToFront, Pencil, SendToBack, Trash2, X } from "lucide-react";
import { useToolbarFocusGroup } from "../hooks/useToolbarFocusGroup";
import type { CrossLink, CrossLinkLayer, CrossLinkStrokeStyle } from "../types/mindmap";
import {
  clampCrossLinkLabel,
  countSentences,
  MAX_CROSSLINK_LABEL_CHARS,
  MAX_CROSSLINK_LABEL_SENTENCES,
} from "../utils/layoutEngine";
import { NODE_COLOR_SWATCHES } from "../utils/themes";

interface FloatingCrossLinkToolbarProps {
  crossLink: CrossLink;
  anchorPoint: { x: number; y: number };
  viewport: { x: number; y: number; scale: number };
  containerRect: { width: number; height: number };
  initialEditOpen?: boolean;
  onClearInitialEdit?: () => void;
  onUpdateCrossLink: (patch: Partial<CrossLink>) => void;
  onDeleteCrossLink: () => void;
  onDeselect: () => void;
}

export function FloatingCrossLinkToolbar({
  crossLink,
  anchorPoint,
  viewport,
  containerRect,
  initialEditOpen = false,
  onClearInitialEdit,
  onUpdateCrossLink,
  onDeleteCrossLink,
  onDeselect,
}: FloatingCrossLinkToolbarProps) {
  const [activePopover, setActivePopover] = useState<"color" | "edit" | null>(
    initialEditOpen ? "edit" : null
  );
  const [labelDraft, setLabelDraft] = useState(crossLink.label || "");
  const barRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const labelDraftRef = useRef(labelDraft);
  labelDraftRef.current = labelDraft;
  useToolbarFocusGroup(toolbarRef);

  const currentColor = crossLink.color || "#f59e0b";
  const currentLayer: CrossLinkLayer = crossLink.layer || "above";
  const currentStyle: CrossLinkStrokeStyle = crossLink.strokeStyle || "dashed";

  useEffect(() => {
    setLabelDraft(crossLink.label || "");
  }, [crossLink.id, crossLink.label]);

  useEffect(() => {
    if (initialEditOpen) {
      setLabelDraft(crossLink.label || "");
      setActivePopover("edit");
      onClearInitialEdit?.();
    }
  }, [initialEditOpen, crossLink.id, crossLink.label, onClearInitialEdit]);

  useEffect(() => {
    if (activePopover !== "edit") return;
    const raf = requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(ta.value.length, ta.value.length);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [activePopover, crossLink.id]);

  const commitLabelDraft = (raw: string) => {
    const cleaned = clampCrossLinkLabel(raw).trim();
    const existing = (crossLink.label || "").trim();
    if (cleaned !== existing) {
      onUpdateCrossLink({ label: cleaned || undefined });
    }
  };
  const commitLabelDraftRef = useRef(commitLabelDraft);
  commitLabelDraftRef.current = commitLabelDraft;

  useEffect(() => {
    if (!activePopover) return;
    const onDown = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) {
        if (activePopover === "edit") {
          commitLabelDraftRef.current(labelDraftRef.current);
        }
        setActivePopover(null);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (activePopover === "edit") {
          setLabelDraft(crossLink.label || "");
        }
        setActivePopover(null);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [activePopover, crossLink.label]);

  const screenX = viewport.x + anchorPoint.x * viewport.scale;
  const screenY = viewport.y + anchorPoint.y * viewport.scale;
  const leftPx = Math.min(Math.max(210, screenX), Math.max(210, containerRect.width - 210));
  const topPx = Math.max(60, Math.min(containerRect.height - 96, screenY - 56));

  const sentenceCount = countSentences(labelDraft);

  const handleTextareaKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();
    if (e.key === "Escape") {
      e.preventDefault();
      setLabelDraft(crossLink.label || "");
      setActivePopover(null);
      return;
    }
    if ((e.key === "Enter" && !e.shiftKey) || ((e.metaKey || e.ctrlKey) && e.key === "Enter")) {
      e.preventDefault();
      commitLabelDraft(labelDraft);
      setActivePopover(null);
    }
  };

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
            aria-expanded={activePopover === "color"}
            title="Change cross-link line color"
            onClick={() => setActivePopover((o) => (o === "color" ? null : "color"))}
          >
            <span
              className="mf-color-dot mf-color-dot-solo"
              style={{ background: currentColor, borderColor: "#ffffff" }}
            />
          </button>
        </div>

        <span role="separator" aria-orientation="vertical" className="mf-ctx-sep" />

        {/* Edit Cross-link Label */}
        <div role="group" aria-label="Edit label" className="mf-toolbar-group">
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Edit cross-link text"
            aria-expanded={activePopover === "edit"}
            title="Edit cross-link label text (max 5 sentences)"
            onClick={() => {
              setLabelDraft(crossLink.label || "");
              setActivePopover((o) => (o === "edit" ? null : "edit"));
            }}
          >
            <Pencil size={14} aria-hidden="true" />
            <span className="mf-ctx-label">Edit</span>
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

      {activePopover === "edit" && (
        <div className="mf-ctx-popover" style={{ minWidth: 300 }}>
          <div className="mf-ctx-popover-title">Cross-Link Text Label</div>
          <textarea
            ref={textareaRef}
            className="mf-crosslink-edit-textarea"
            rows={3}
            maxLength={MAX_CROSSLINK_LABEL_CHARS}
            value={labelDraft}
            aria-label="Cross-link label text"
            placeholder="Describe this connection (up to 5 sentences)…"
            onChange={(e) => setLabelDraft(clampCrossLinkLabel(e.target.value))}
            onKeyDown={handleTextareaKeyDown}
          />
          <div className="mf-crosslink-edit-meta">
            <span>
              {labelDraft.length}/{MAX_CROSSLINK_LABEL_CHARS} chars · {sentenceCount}/
              {MAX_CROSSLINK_LABEL_SENTENCES} sentences
            </span>
          </div>
          <div className="mf-crosslink-edit-actions">
            {labelDraft.trim().length > 0 && (
              <button
                type="button"
                className="mf-chip-btn"
                onClick={() => {
                  setLabelDraft("");
                  onUpdateCrossLink({ label: undefined });
                  setActivePopover(null);
                }}
              >
                Clear
              </button>
            )}
            <div style={{ marginLeft: "auto", display: "inline-flex", gap: 6 }}>
              <button
                type="button"
                className="mf-chip-btn"
                onClick={() => {
                  setLabelDraft(crossLink.label || "");
                  setActivePopover(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="mf-chip-btn is-active"
                onClick={() => {
                  commitLabelDraft(labelDraft);
                  setActivePopover(null);
                }}
              >
                Save
              </button>
            </div>
          </div>
        </div>
      )}

      {activePopover === "color" && (
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
