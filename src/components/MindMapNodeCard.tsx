import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { Eye, Paperclip, Plus, StickyNote, Trash2 } from "lucide-react";
import type { LayoutNodeInfo, MindMapNode, NodeImage } from "../types/mindmap";
import {
  decodeUtf8Base64,
  extractMarkdownFromClipboard,
  hasRichSyntax,
  renderRichNodeContent,
} from "../utils/llmMathNormalizer";
import { getContrastTextColor } from "../utils/themes";
import { toggleCheckboxLine } from "../utils/treeOps";

interface MindMapNodeCardProps {
  node: MindMapNode;
  layout: LayoutNodeInfo;
  zoomScale: number;
  isSelected: boolean;
  isEditing: boolean;
  isCrossLinkSource: boolean;
  onSelect: (id: string, additive: boolean) => void;
  onStartEdit: (id: string) => void;
  onCommitEdit: (id: string, nextText: string) => void;
  onCancelEdit: () => void;
  onUpdateNodeTextDirect: (id: string, nextText: string) => void;
  onToggleCollapse: (id: string) => void;
  onAddChildQuick: (parentId: string) => void;
  onResizeNode: (nodeId: string, dims: { width?: number; minHeight?: number } | "auto") => void;
  onOpenImageLightbox: (img: NodeImage) => void;
  onResizeImage: (nodeId: string, imgId: string, width: number) => void;
  onUpdateImageProps: (nodeId: string, imgId: string, patch: Partial<NodeImage>) => void;
  onRemoveImage: (nodeId: string, imgId: string) => void;
  onDropFilesOnNode: (nodeId: string, files: FileList | File[]) => void;
  onPasteImageInEditor: (nodeId: string, file: File) => Promise<void>;
  onOpenDrawer: (nodeId: string) => void;
  onSizeChange: (nodeId: string, width: number, height: number) => void;
  onAnnounce: (msg: string) => void;
  onDragNodeStart?: (nodeId: string, e: MouseEvent) => void;
}

function isInsideUnclosedBlock(text: string, cursorPos: number): boolean {
  const before = text.slice(0, cursorPos);
  const fences = (before.match(/^\s*```/gm) || []).length;
  if (fences % 2 === 1) return true;
  const doubleDollars = (before.match(/\$\$/g) || []).length;
  if (doubleDollars % 2 === 1) return true;
  return false;
}

const DEFAULT_PLACEHOLDER_TEXTS = new Set(["New Idea", "New Sibling", "Floating Topic"]);

export function MindMapNodeCard({
  node,
  layout,
  zoomScale,
  isSelected,
  isEditing,
  isCrossLinkSource,
  onSelect,
  onStartEdit,
  onCommitEdit,
  onCancelEdit,
  onUpdateNodeTextDirect,
  onToggleCollapse,
  onAddChildQuick,
  onResizeNode,
  onOpenImageLightbox,
  onResizeImage,
  onUpdateImageProps,
  onRemoveImage,
  onDropFilesOnNode,
  onPasteImageInEditor,
  onOpenDrawer,
  onSizeChange,
  onAnnounce,
  onDragNodeStart,
}: MindMapNodeCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const editorWrapRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(node.text);
  const [isDropTarget, setIsDropTarget] = useState(false);

  useEffect(() => {
    if (isEditing) {
      setDraft(node.text);
      requestAnimationFrame(() => {
        const ta = textareaRef.current;
        if (ta) {
          ta.focus();
          if (DEFAULT_PLACEHOLDER_TEXTS.has(node.text.trim())) {
            ta.select();
          } else {
            const len = ta.value.length;
            ta.setSelectionRange(len, len);
          }
          ta.style.height = "auto";
          ta.style.height = `${Math.max(60, ta.scrollHeight)}px`;
        }
      });
    }
  }, [isEditing, node.text]);

  useEffect(() => {
    const el = cardRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const box = entry.borderBoxSize?.[0];
        const w = box ? Math.ceil(box.inlineSize) : Math.ceil(el.offsetWidth);
        const h = box ? Math.ceil(box.blockSize) : Math.ceil(el.offsetHeight);
        if (w > 10 && h > 10) {
          onSizeChange(node.id, w, h);
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [node.id, onSizeChange]);

  const renderedHtml = useMemo(() => renderRichNodeContent(node.text), [node.text]);
  const livePreviewHtml = useMemo(
    () => (isEditing && hasRichSyntax(draft) ? renderRichNodeContent(draft) : ""),
    [isEditing, draft]
  );

  const isRoot = layout.depth === 0;
  const shape = node.style?.shape || "rounded";
  const fontSize = node.style?.fontSize ?? (isRoot ? 16 : 14);
  const textAlign = node.style?.align || (isRoot ? "center" : "left");

  const customStyle: React.CSSProperties = {
    transform: `translate(${layout.x}px, ${layout.y}px)`,
    fontSize: `${fontSize}px`,
    textAlign,
    "--node-border": node.style?.borderColor || layout.branchColor,
  } as React.CSSProperties;

  if (node.style?.width) {
    customStyle.width = `${node.style.width}px`;
    customStyle.maxWidth = "none";
  }
  if (node.style?.minHeight) {
    customStyle.minHeight = `${node.style.minHeight}px`;
  }

  if (isRoot && !node.style?.color) {
    customStyle.background = layout.branchColor;
    customStyle.color = node.style?.textColor || getContrastTextColor(layout.branchColor);
  } else if (node.style?.color) {
    customStyle.background = node.style.color;
    customStyle.color = node.style.textColor || getContrastTextColor(node.style.color);
  } else if (node.style?.textColor) {
    customStyle.color = node.style.textColor;
  }

  const handleEditorKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    e.stopPropagation();

    if (e.key === "Escape") {
      e.preventDefault();
      onCancelEdit();
      return;
    }

    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      onCommitEdit(node.id, draft);
      return;
    }

    if (e.key === "Enter" && !e.shiftKey) {
      const ta = e.currentTarget;
      if (isInsideUnclosedBlock(draft, ta.selectionStart)) {
        return;
      }
      e.preventDefault();
      onCommitEdit(node.id, draft);
    }
  };

  const handleEditorBlur = (e: FocusEvent<HTMLTextAreaElement>) => {
    const related = e.relatedTarget as Node | null;
    if (related && editorWrapRef.current?.contains(related)) {
      return;
    }
    onCommitEdit(node.id, draft);
  };

  const handleEditorPaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const items = Array.from(e.clipboardData.items || []);
    const imgItem = items.find((it) => it.type.startsWith("image/"));
    if (imgItem) {
      const file = imgItem.getAsFile();
      if (file) {
        e.preventDefault();
        await onPasteImageInEditor(node.id, file);
        return;
      }
    }

    const { text: extracted, hasRichHtmlMath } = extractMarkdownFromClipboard(e.clipboardData);
    if (hasRichHtmlMath && extracted) {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const updated = draft.slice(0, start) + extracted + draft.slice(end);
      setDraft(updated);
      onAnnounce("Extracted clean LLM LaTeX formulas on paste");
    }
  };

  const insertSnippet = (kind: "math" | "block" | "code" | "task" | "table" | "callout") => {
    const ta = textareaRef.current;
    const templates: Record<typeof kind, string> = {
      math: "$x^2$",
      block: "$$\n\\int_a^b f(x)\\,dx\n$$",
      code: "```python\nprint('hello')\n```",
      task: "- [ ] Task item",
      table: "| Col A | Col B |\n| --- | --- |\n| 1 | 2 |",
      callout: "> [!NOTE]\n> Key insight here",
    };

    if (!ta) {
      setDraft((d) => `${d}${d ? "\n" : ""}${templates[kind]}`);
      return;
    }

    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    const selected = draft.slice(start, end);
    const fullSelected = start === 0 && end === draft.length && draft.length > 0;

    let nextVal = draft;
    let selStart = start;
    let selEnd = start;

    if (selected && !fullSelected && (kind === "math" || kind === "block" || kind === "code")) {
      const wrapped =
        kind === "math"
          ? `$${selected}$`
          : kind === "block"
          ? `\n$$\n${selected}\n$$\n`
          : `\n\`\`\`\n${selected}\n\`\`\`\n`;
      nextVal = draft.slice(0, start) + wrapped + draft.slice(end);
      selStart = start + wrapped.length;
      selEnd = selStart;
    } else if (fullSelected && kind !== "math") {
      // Never wipe out a whole node when clicking block helpers while all text is selected
      const sep = draft.endsWith("\n") ? "" : "\n";
      const suffix = `${sep}${templates[kind]}`;
      nextVal = draft + suffix;
      selStart = draft.length + sep.length;
      selEnd = nextVal.length;
    } else {
      const prefix =
        kind !== "math" && start > 0 && draft[start - 1] !== "\n" ? "\n" : "";
      const ins = `${prefix}${templates[kind]}`;
      nextVal = draft.slice(0, start) + ins + draft.slice(end);
      if (kind === "math") {
        selStart = start + prefix.length + 1;
        selEnd = selStart + 3; // highlights "x^2" for instant typing
      } else {
        selStart = start + ins.length;
        selEnd = selStart;
      }
    }

    setDraft(nextVal);
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(selStart, selEnd);
      ta.style.height = "auto";
      ta.style.height = `${Math.max(60, ta.scrollHeight)}px`;
    });
  };

  const handleRenderedClick = async (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;

    const copyBtn = target.closest(".mf-copy-code-btn") as HTMLElement | null;
    if (copyBtn) {
      e.stopPropagation();
      const b64 = copyBtn.getAttribute("data-code-b64") || "";
      const code = decodeUtf8Base64(b64);
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.textContent = "Copied!";
        setTimeout(() => {
          copyBtn.textContent = "Copy";
        }, 1200);
        onAnnounce("Code copied to clipboard");
      } catch {
        onAnnounce("Copy failed — clipboard permission denied");
      }
      return;
    }

    if (target instanceof HTMLInputElement && target.classList.contains("mf-task-checkbox")) {
      e.stopPropagation();
      const lineStr = target.getAttribute("data-checkbox-line");
      const lineIdx = lineStr ? Number(lineStr) : -1;
      if (lineIdx >= 0) {
        onUpdateNodeTextDirect(node.id, toggleCheckboxLine(node.text, lineIdx));
      }
      return;
    }

    if (target.closest("a")) {
      e.stopPropagation();
    }
  };

  const startImageResize = (e: MouseEvent, img: NodeImage) => {
    e.stopPropagation();
    e.preventDefault();
    const startX = e.clientX;
    const startW = img.width || 180;
    const onMove = (moveEv: globalThis.MouseEvent) => {
      const delta = (moveEv.clientX - startX) / Math.max(0.2, zoomScale);
      const nextW = Math.max(64, Math.min(700, Math.round(startW + delta)));
      onResizeImage(node.id, img.id, nextW);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const startNodeResize = (e: MouseEvent, axes: "e" | "s" | "se") => {
    e.stopPropagation();
    e.preventDefault();
    const el = cardRef.current;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = el ? el.offsetWidth : layout.width;
    const startH = el ? el.offsetHeight : layout.height;

    const onMove = (moveEv: globalThis.MouseEvent) => {
      const dx = (moveEv.clientX - startX) / Math.max(0.2, zoomScale);
      const dy = (moveEv.clientY - startY) / Math.max(0.2, zoomScale);
      const patch: { width?: number; minHeight?: number } = {};
      if (axes === "e" || axes === "se") {
        patch.width = Math.max(120, Math.min(860, Math.round(startW + dx)));
      }
      if (axes === "s" || axes === "se") {
        patch.minHeight = Math.max(42, Math.min(800, Math.round(startH + dy)));
      }
      onResizeNode(node.id, patch);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDropTarget(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onDropFilesOnNode(node.id, e.dataTransfer.files);
    }
  };

  const foldSideClass =
    layout.side === "left" ? "side-left" : layout.side === "down" ? "side-down" : "side-right";

  const topImages = (node.images || []).filter((img) => img.position !== "bottom");
  const bottomImages = (node.images || []).filter((img) => img.position === "bottom");

  const renderImageGallery = (list: NodeImage[]) => {
    if (list.length === 0) return null;
    return (
      <div className="mf-node-images">
        {list.map((img) => {
          const alignStyle =
            img.align === "center"
              ? { alignSelf: "center" as const }
              : img.align === "right"
              ? { alignSelf: "flex-end" as const }
              : { alignSelf: "flex-start" as const };
          return (
            <figure
              key={img.id}
              className="mf-node-img-wrap"
              style={{
                width: `${img.width || 180}px`,
                margin: 0,
                ...alignStyle,
              }}
            >
              <img
                src={img.url}
                alt={img.caption || img.name}
                draggable={false}
                style={{
                  objectFit: img.fit || "contain",
                  height: img.height ? `${img.height}px` : "auto",
                  width: "100%",
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onOpenImageLightbox(img);
                }}
              />
              {isSelected && !isEditing && (
                <div className="mf-img-actions" onMouseDown={(e) => e.stopPropagation()}>
                  <button
                    type="button"
                    title="View full photo"
                    aria-label="Preview photo"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenImageLightbox(img);
                    }}
                  >
                    <Eye size={11} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    title="Small photo (120px)"
                    onClick={(e) => {
                      e.stopPropagation();
                      onResizeImage(node.id, img.id, 120);
                    }}
                  >
                    S
                  </button>
                  <button
                    type="button"
                    title="Medium photo (210px)"
                    onClick={(e) => {
                      e.stopPropagation();
                      onResizeImage(node.id, img.id, 210);
                    }}
                  >
                    M
                  </button>
                  <button
                    type="button"
                    title="Large photo (320px)"
                    onClick={(e) => {
                      e.stopPropagation();
                      onResizeImage(node.id, img.id, 320);
                    }}
                  >
                    L
                  </button>
                  <button
                    type="button"
                    title="Flip Top / Bottom"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUpdateImageProps(node.id, img.id, {
                        position: img.position === "bottom" ? "top" : "bottom",
                      });
                    }}
                  >
                    {img.position === "bottom" ? "↑" : "↓"}
                  </button>
                  <button
                    type="button"
                    title="Remove photo"
                    aria-label="Remove photo"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveImage(node.id, img.id);
                    }}
                  >
                    <Trash2 size={11} aria-hidden="true" />
                  </button>
                </div>
              )}
              <span
                className="mf-img-resize-handle"
                title="Drag to resize photo"
                onMouseDown={(e) => startImageResize(e, img)}
              >
                ↔
              </span>
              {img.caption && <figcaption className="mf-img-caption">{img.caption}</figcaption>}
            </figure>
          );
        })}
      </div>
    );
  };

  return (
    <div
      ref={cardRef}
      data-node-id={node.id}
      className={[
        "mf-node",
        `shape-${shape}`,
        isRoot ? "is-root" : "",
        isSelected ? "is-selected" : "",
        isEditing ? "is-editing" : "",
        isDropTarget ? "is-drop-target" : "",
        isCrossLinkSource ? "is-crosslink-source" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      style={customStyle}
      onMouseDown={(e) => {
        if (isEditing) {
          e.stopPropagation();
          return;
        }
        e.stopPropagation();
        onSelect(node.id, e.shiftKey || e.metaKey || e.ctrlKey);
        if (isRoot && onDragNodeStart) {
          onDragNodeStart(node.id, e);
        }
      }}
      onDoubleClick={(e) => {
        e.stopPropagation();
        onStartEdit(node.id);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDropTarget(true);
      }}
      onDragLeave={() => setIsDropTarget(false)}
      onDrop={handleDrop}
    >
      {node.stickers && node.stickers.length > 0 && (
        <div className="mf-node-stickers" aria-label="Stickers">
          {node.stickers.map((st, idx) => (
            <span key={`${st}-${idx}`}>{st}</span>
          ))}
        </div>
      )}

      {renderImageGallery(topImages)}

      {isEditing ? (
        <div
          ref={editorWrapRef}
          className="mf-inline-editor-wrap"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mf-editor-quickbar">
            <button
              type="button"
              className="mf-chip-btn"
              title="Insert or wrap inline LaTeX math ($...$)"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertSnippet("math")}
            >
              $Math$
            </button>
            <button
              type="button"
              className="mf-chip-btn"
              title="Insert or wrap display LaTeX equation block ($$...$$)"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertSnippet("block")}
            >
              $$Block$$
            </button>
            <button
              type="button"
              className="mf-chip-btn"
              title="Insert or wrap syntax-highlighted code block"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertSnippet("code")}
            >
              Code
            </button>
            <button
              type="button"
              className="mf-chip-btn"
              title="Insert interactive task checkbox (- [ ])"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertSnippet("task")}
            >
              Task
            </button>
            <button
              type="button"
              className="mf-chip-btn"
              title="Insert 2x2 Markdown table"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertSnippet("table")}
            >
              Table
            </button>
            <button
              type="button"
              className="mf-chip-btn"
              title="Insert callout note block"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => insertSnippet("callout")}
            >
              Note
            </button>
          </div>

          <textarea
            ref={textareaRef}
            className="mf-inline-textarea"
            value={draft}
            aria-label="Edit node markdown content"
            onChange={(e) => {
              setDraft(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.max(60, e.target.scrollHeight)}px`;
            }}
            onKeyDown={handleEditorKeyDown}
            onPaste={handleEditorPaste}
            onBlur={handleEditorBlur}
          />

          {livePreviewHtml && (
            <div className="mf-live-preview">
              <div className="mf-live-preview-label">Live Preview</div>
              <div
                className="mf-node-content"
                dangerouslySetInnerHTML={{ __html: livePreviewHtml }}
              />
            </div>
          )}

          <div className="mf-editor-hint">
            Enter to save · Shift+Enter newline · Ctrl/Cmd+Enter save code/math · Esc cancel
          </div>
        </div>
      ) : (
        <div
          className="mf-node-content"
          onClick={handleRenderedClick}
          dangerouslySetInnerHTML={{ __html: renderedHtml || "<span>&nbsp;</span>" }}
        />
      )}

      {renderImageGallery(bottomImages)}

      {((node.notes && node.notes.trim().length > 0) ||
        (node.attachments && node.attachments.length > 0)) && (
        <div className="mf-node-meta-row">
          {node.notes && node.notes.trim() && (
            <button
              type="button"
              className="mf-chip-btn"
              title="Open extended notes (A)"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDrawer(node.id);
              }}
            >
              <StickyNote size={11} aria-hidden="true" /> Notes
            </button>
          )}
          {node.attachments && node.attachments.length > 0 && (
            <button
              type="button"
              className="mf-chip-btn"
              title="Open attachments (A)"
              onClick={(e) => {
                e.stopPropagation();
                onOpenDrawer(node.id);
              }}
            >
              <Paperclip size={11} aria-hidden="true" /> {node.attachments.length}
            </button>
          )}
        </div>
      )}

      {node.childrenIds.length > 0 && (
        <button
          type="button"
          className={`mf-fold-badge ${foldSideClass}`}
          title={node.collapsed ? "Unfold subtree (F)" : "Fold subtree (F)"}
          aria-label={
            node.collapsed
              ? `Expand ${node.childrenIds.length} hidden child nodes`
              : "Collapse subtree"
          }
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse(node.id);
          }}
        >
          {node.collapsed ? `+${node.childrenIds.length}` : "−"}
        </button>
      )}

      {/* Quick add-child handle & MindMeister-style node resize handles when selected */}
      {isSelected && !isEditing && (
        <>
          <button
            type="button"
            className={`mf-quick-add-btn ${layout.side === "left" ? "side-left" : "side-right"}`}
            title="Add child node (Tab)"
            aria-label="Add child node"
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              onAddChildQuick(node.id);
            }}
          >
            <Plus size={12} aria-hidden="true" />
          </button>

          <span
            className="mf-node-resize-e"
            title="Drag to resize node width (double-click to reset)"
            onMouseDown={(e) => startNodeResize(e, "e")}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onResizeNode(node.id, "auto");
            }}
          />
          <span
            className="mf-node-resize-s"
            title="Drag to resize node height (double-click to reset)"
            onMouseDown={(e) => startNodeResize(e, "s")}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onResizeNode(node.id, "auto");
            }}
          />
          <span
            className="mf-node-resize-se"
            title="Drag to resize node width & height (double-click to reset)"
            onMouseDown={(e) => startNodeResize(e, "se")}
            onDoubleClick={(e) => {
              e.stopPropagation();
              onResizeNode(node.id, "auto");
            }}
          />
        </>
      )}
    </div>
  );
}
