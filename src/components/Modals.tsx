import { useEffect, useState, type ClipboardEvent } from "react";
import type { NodeImage } from "../types/mindmap";
import { extractMarkdownFromClipboard } from "../utils/llmMathNormalizer";
import { NativeDialog } from "./NativeDialog";

export function ShortcutsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const sections = [
    {
      title: "Node Creation & Structure",
      items: [
        ["Tab", "Add child (horizontal) / sibling (org-chart)"],
        ["Enter", "Add sibling below (horizontal) / child (org-chart)"],
        ["Shift + Enter", "Add sibling above"],
        ["Shift + Tab", "Insert parent node"],
        ["Backspace / Delete", "Delete selected node(s)"],
        ["Ctrl/Cmd + D", "Insert detached root node"],
        ["D", "Detach selected node into root"],
        ["Ctrl/Cmd + Up/Down", "Reorder sibling up/down"],
      ],
    },
    {
      title: "Editing, Media & Styling",
      items: [
        ["Space / F2 / DblClick", "Edit node (Markdown + Live Preview)"],
        ["Shift + Enter (editing)", "Insert line break"],
        ["I", "Add / upload photo to node"],
        ["A", "Open Notes & Attachments drawer"],
        ["Shift + Space", "Node color & shape style picker"],
        ["Shift + S", "Add / toggle stickers"],
        ["Alt + X + Click", "Add cross-link arrow to another node"],
        ["T / Shift+T / Alt+T", "Increase / Decrease / Reset font size"],
        ["Shift + Ctrl + L / E / R", "Align Left / Center / Right"],
      ],
    },
    {
      title: "Selection, Navigation & Folding",
      items: [
        ["Ctrl/Cmd + A", "Select all nodes"],
        ["Arrow Keys", "Navigate nodes"],
        ["Shift + Arrow Keys", "Extend multi-selection"],
        ["{  (Shift + [)", "Select node + entire subtree"],
        ["[", "Select subtree only"],
        ["=", "Select all siblings"],
        ["F", "Fold / unfold selected subtree"],
        ["Alt + 1 .. 9", "Collapse/expand map to outline level 1..9"],
        ["Alt + 0 / Shift + F", "Expand all collapsed nodes"],
      ],
    },
    {
      title: "Canvas, Clipboard & Themes",
      items: [
        ["V / H", "Select tool / Hand pan tool"],
        ["Ctrl/Cmd + 0 / 1", "Recenter (100%) / Fit map"],
        ["Scroll / Shift+Scroll / Ctrl+Scroll", "Pan V / Pan H / Zoom"],
        ["U or Ctrl/Cmd + Z", "Undo"],
        ["R / Ctrl+Y / Ctrl+Shift+Z", "Redo"],
        ["Ctrl/Cmd + C / X / V", "Copy / Cut / Smart-Paste node or photo/LLM"],
        ["Ctrl/Cmd + Shift + V", "Parse LLM Markdown into Subtree"],
        ["Alt + D / Alt + M", "Toggle Light-Dark / Cycle Theme"],
        ["Ctrl/Cmd + F / Ctrl/Cmd + S", "Search nodes / Save map"],
      ],
    },
  ];

  return (
    <NativeDialog open={open} onClose={onClose} title="MindMup Keyboard Shortcuts (Ctrl + /)" maxWidth="840px">
      <div className="mf-shortcut-grid">
        {sections.map((sec) => (
          <div key={sec.title} className="mf-shortcut-card">
            <h3>{sec.title}</h3>
            {sec.items.map(([k, desc]) => (
              <div key={k} className="mf-shortcut-row">
                <span>{desc}</span>
                <kbd className="mf-kbd">{k}</kbd>
              </div>
            ))}
          </div>
        ))}
      </div>
    </NativeDialog>
  );
}

export function ImagePickerModal({
  open,
  onClose,
  onUploadFiles,
  onAddImageUrl,
}: {
  open: boolean;
  onClose: () => void;
  onUploadFiles: (files: FileList) => Promise<void>;
  onAddImageUrl: (url: string, caption?: string) => void;
}) {
  const [url, setUrl] = useState("");
  const [caption, setCaption] = useState("");

  return (
    <NativeDialog open={open} onClose={onClose} title="Add Photo / Image to Node (I)" maxWidth="480px">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div>
          <label htmlFor="mf-upload-photo" style={{ fontWeight: 600, fontSize: "0.85rem" }}>
            Upload from computer (PNG, JPEG, WebP, GIF, SVG)
          </label>
          <input
            id="mf-upload-photo"
            type="file"
            accept="image/*"
            multiple
            style={{ display: "block", marginTop: 8 }}
            onChange={async (e) => {
              if (e.target.files && e.target.files.length > 0) {
                await onUploadFiles(e.target.files);
                e.target.value = "";
                onClose();
              }
            }}
          />
          <p style={{ fontSize: "0.78rem", color: "var(--text-muted)", margin: "6px 0 0" }}>
            Tip: You can also drag &amp; drop an image onto any node or press Ctrl/Cmd+V with a screenshot on your clipboard.
          </p>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--border-color)", width: "100%" }} />

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!url.trim()) return;
            onAddImageUrl(url.trim(), caption.trim() || undefined);
            setUrl("");
            setCaption("");
            onClose();
          }}
          style={{ display: "flex", flexDirection: "column", gap: 8 }}
        >
          <label htmlFor="mf-img-url" style={{ fontWeight: 600, fontSize: "0.85rem" }}>
            Or embed Image URL
          </label>
          <input
            id="mf-img-url"
            type="url"
            placeholder="https://example.com/diagram.png"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            style={{
              padding: "7px 10px",
              borderRadius: 8,
              border: "1px solid var(--border-color)",
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
            }}
          />
          <input
            type="text"
            placeholder="Optional caption / alt text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            style={{
              padding: "7px 10px",
              borderRadius: 8,
              border: "1px solid var(--border-color)",
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
            }}
          />
          <button type="submit" className="mf-btn mf-btn-primary" style={{ alignSelf: "flex-end" }}>
            Insert Image URL
          </button>
        </form>
      </div>
    </NativeDialog>
  );
}

export function SubtreePasteModal({
  open,
  onClose,
  initialMarkdown,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  initialMarkdown: string;
  onConfirm: (markdown: string) => void;
}) {
  const [text, setText] = useState(initialMarkdown);

  useEffect(() => {
    if (open) {
      setText(initialMarkdown);
    }
  }, [open, initialMarkdown]);

  const handlePaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const { text: extracted, hasRichHtmlMath } = extractMarkdownFromClipboard(e.clipboardData);
    if (hasRichHtmlMath && extracted) {
      e.preventDefault();
      setText(extracted);
    }
  };

  return (
    <NativeDialog
      open={open}
      onClose={onClose}
      title="Paste LLM Response as Mind Map Subtree (Ctrl + Shift + V)"
      maxWidth="640px"
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <p style={{ margin: 0, fontSize: "0.84rem", color: "var(--text-muted)" }}>
          Paste structured output from ChatGPT, Claude, Gemini, DeepSeek, or Grok. Headings, nested bullets,
          LaTeX math (<code>$...$</code>, <code>\(...\)</code>, <code>\[...\]</code>, <code>\begin&#123;align&#125;</code>),
          and fenced code blocks are automatically branched under the selected node.
        </p>
        <textarea
          rows={11}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onPaste={handlePaste}
          placeholder={"# Topic\n## Key Equations\n- Inline: \\(E = mc^2\\)\n- Block:\n\\[\n\\sum_{i=1}^n i = \\frac{n(n+1)}{2}\n\\]"}
          style={{
            width: "100%",
            padding: 10,
            borderRadius: 8,
            border: "1px solid var(--border-color)",
            background: "var(--bg-elevated)",
            color: "var(--text-primary)",
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.83rem",
          }}
        />
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button
            type="button"
            className="mf-btn"
            onClick={() => {
              setText("");
              onClose();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="mf-btn mf-btn-primary"
            onClick={() => {
              if (text.trim()) {
                onConfirm(text);
                setText("");
              }
              onClose();
            }}
          >
            Build Subtree Branches
          </button>
        </div>
      </div>
    </NativeDialog>
  );
}

export function ImageLightboxModal({
  image,
  onClose,
}: {
  image: NodeImage | null;
  onClose: () => void;
}) {
  return (
    <NativeDialog
      open={Boolean(image)}
      onClose={onClose}
      title={image?.caption || image?.name || "Photo Preview"}
      maxWidth="90vw"
    >
      {image && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
          <img
            src={image.url}
            alt={image.caption || image.name}
            style={{ maxWidth: "100%", maxHeight: "72vh", borderRadius: 8 }}
          />
          <a href={image.url} download={image.name} className="mf-btn mf-btn-primary">
            Download Original
          </a>
        </div>
      )}
    </NativeDialog>
  );
}
