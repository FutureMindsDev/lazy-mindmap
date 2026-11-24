import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { BringToFront, Pencil, SendToBack, Trash2, X } from "lucide-react";
import { useToolbarFocusGroup } from "../hooks/useToolbarFocusGroup";
import type {
  CrossLink,
  CrossLinkHeadType,
  CrossLinkLayer,
  CrossLinkStrokeStyle,
} from "../types/mindmap";
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
  const [activePopover, setActivePopover] = useState<"color" | "edit" | "heads" | null>(
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
  const startHead: CrossLinkHeadType = crossLink.startHead || "none";
  const endHead: CrossLinkHeadType = crossLink.endHead || "arrow";
  const isBothSides = startHead !== "none" && endHead !== "none";
  const primaryHeadShape: Exclude<CrossLinkHeadType, "none"> =
    endHead !== "none" ? endHead : startHead !== "none" ? startHead : "arrow";

  const renderHeadGlyph = (side: "start" | "end", shape: CrossLinkHeadType) => {
    if (shape === "none") return null;
    if (shape === "arrow") {
      return side === "start" ? (
        <polygon points="1,5 7,2 7,8" fill="currentColor" />
      ) : (
        <polygon points="23,5 17,2 17,8" fill="currentColor" />
      );
    }
    const cx = side === "start" ? 4.5 : 19.5;
    if (shape === "circle-filled") {
      return <circle cx={cx} cy="5" r="2.8" fill="currentColor" />;
    }
    return (
      <circle cx={cx} cy="5" r="2.6" fill="#1f242d" stroke="currentColor" strokeWidth="1.6" />
    );
  };

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

  const renderPreviewHead = (side: "start" | "end", shape: CrossLinkHeadType) => {
    if (shape === "none") return null;
    if (shape === "arrow") {
      return side === "start" ? (
        <polygon points="15,12 22,8.5 22,15.5" fill="currentColor" />
      ) : (
        <polygon points="57,12 50,8.5 50,15.5" fill="currentColor" />
      );
    }
    const cx = side === "start" ? 18.5 : 53.5;
    if (shape === "circle-filled") {
      return <circle cx={cx} cy="12" r="3.4" fill="currentColor" />;
    }
    return (
      <circle
        cx={cx}
        cy="12"
        r="3.1"
        fill="var(--bg-surface)"
        stroke="currentColor"
        strokeWidth="1.7"
      />
    );
  };

  const renderOptionPreviewSvg = (
    sHead: CrossLinkHeadType,
    eHead: CrossLinkHeadType,
    dash?: string
  ) => (
    <svg
      className="mf-option-preview-svg"
      viewBox="0 0 72 24"
      width="72"
      height="24"
      aria-hidden="true"
    >
      <rect x="2" y="5" width="13" height="14" rx="3.5" className="mf-svg-node" />
      <rect x="57" y="5" width="13" height="14" rx="3.5" className="mf-svg-node" />
      <line
        x1={sHead === "none" ? 15 : 21}
        y1="12"
        x2={eHead === "none" ? 57 : 51}
        y2="12"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeDasharray={dash}
      />
      {renderPreviewHead("start", sHead)}
      {renderPreviewHead("end", eHead)}
    </svg>
  );

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

        {/* Arrowheads (Pointed / Circular Unfilled / Circular Filled, One / Both Sides) */}
        <div role="group" aria-label="Arrowheads" className="mf-toolbar-group">
          <button
            type="button"
            className="mf-ctx-btn"
            aria-label="Cross-link arrowheads"
            aria-expanded={activePopover === "heads"}
            title="Choose arrowhead shape & one/both sides"
            onClick={() => setActivePopover((o) => (o === "heads" ? null : "heads"))}
          >
            <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
              <line
                x1={startHead === "none" ? 2 : 5}
                y1="5"
                x2={endHead === "none" ? 22 : 19}
                y2="5"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
              {renderHeadGlyph("start", startHead)}
              {renderHeadGlyph("end", endHead)}
            </svg>
            <span className="mf-ctx-label">{isBothSides ? "Both" : "1-Side"}</span>
          </button>
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

      {activePopover === "heads" && (
        <div className="mf-ctx-popover" style={{ minWidth: 330 }}>
          <div className="mf-ctx-popover-title">Arrowheads &amp; Sides</div>

          <div className="mf-ctx-popover-sub">Sides</div>
          <div className="mf-preview-chip-grid mf-preview-chip-grid-2" style={{ marginBottom: 10 }}>
            <button
              type="button"
              className={`mf-chip-btn mf-preview-chip-btn ${!isBothSides && (startHead !== "none" || endHead !== "none") ? "is-active" : ""}`}
              aria-pressed={!isBothSides && (startHead !== "none" || endHead !== "none")}
              onClick={() =>
                onUpdateCrossLink({
                  startHead: "none",
                  endHead: primaryHeadShape,
                })
              }
            >
              {renderOptionPreviewSvg("none", primaryHeadShape)}
              <span className="mf-preview-chip-label">One Side</span>
            </button>
            <button
              type="button"
              className={`mf-chip-btn mf-preview-chip-btn ${isBothSides ? "is-active" : ""}`}
              aria-pressed={isBothSides}
              onClick={() =>
                onUpdateCrossLink({
                  startHead: primaryHeadShape,
                  endHead: primaryHeadShape,
                })
              }
            >
              {renderOptionPreviewSvg(primaryHeadShape, primaryHeadShape)}
              <span className="mf-preview-chip-label">Both Sides</span>
            </button>
          </div>

          <div className="mf-ctx-popover-sub">Arrowhead Style</div>
          <div className="mf-preview-chip-grid" style={{ marginBottom: 10 }}>
            {(
              [
                { id: "arrow", label: "Pointed Arrow" },
                { id: "circle-outline", label: "Circular Unfilled" },
                { id: "circle-filled", label: "Circular Filled" },
              ] as const
            ).map((opt) => {
              const active =
                (startHead !== "none" || endHead !== "none") && primaryHeadShape === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  className={`mf-chip-btn mf-preview-chip-btn ${active ? "is-active" : ""}`}
                  aria-pressed={active}
                  onClick={() => {
                    if (isBothSides) {
                      onUpdateCrossLink({ startHead: opt.id, endHead: opt.id });
                    } else if (startHead !== "none" && endHead === "none") {
                      onUpdateCrossLink({ startHead: opt.id, endHead: "none" });
                    } else {
                      onUpdateCrossLink({ startHead: "none", endHead: opt.id });
                    }
                  }}
                >
                  {renderOptionPreviewSvg(isBothSides ? opt.id : "none", opt.id)}
                  <span className="mf-preview-chip-label">{opt.label}</span>
                </button>
              );
            })}
          </div>

          <div className="mf-ctx-popover-sub">Start Side</div>
          <div className="mf-preview-chip-grid mf-preview-chip-grid-4" style={{ marginBottom: 8 }}>
            {(
              [
                { id: "none", label: "None" },
                { id: "arrow", label: "Pointed" },
                { id: "circle-outline", label: "Unfilled" },
                { id: "circle-filled", label: "Filled" },
              ] as const
            ).map((opt) => (
              <button
                key={`start-${opt.id}`}
                type="button"
                className={`mf-chip-btn mf-preview-chip-btn ${startHead === opt.id ? "is-active" : ""}`}
                aria-pressed={startHead === opt.id}
                onClick={() => onUpdateCrossLink({ startHead: opt.id })}
              >
                {renderOptionPreviewSvg(opt.id, "none")}
                <span className="mf-preview-chip-label">{opt.label}</span>
              </button>
            ))}
          </div>

          <div className="mf-ctx-popover-sub">End Side</div>
          <div className="mf-preview-chip-grid mf-preview-chip-grid-4">
            {(
              [
                { id: "none", label: "None" },
                { id: "arrow", label: "Pointed" },
                { id: "circle-outline", label: "Unfilled" },
                { id: "circle-filled", label: "Filled" },
              ] as const
            ).map((opt) => (
              <button
                key={`end-${opt.id}`}
                type="button"
                className={`mf-chip-btn mf-preview-chip-btn ${endHead === opt.id ? "is-active" : ""}`}
                aria-pressed={endHead === opt.id}
                onClick={() => onUpdateCrossLink({ endHead: opt.id })}
              >
                {renderOptionPreviewSvg("none", opt.id)}
                <span className="mf-preview-chip-label">{opt.label}</span>
              </button>
            ))}
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
