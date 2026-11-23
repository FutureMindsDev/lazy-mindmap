import { useRef } from "react";
import { FileUp, ImagePlus, Trash2, X } from "lucide-react";
import type { MindMapNode } from "../types/mindmap";
import { renderRichNodeContent } from "../utils/llmMathNormalizer";

interface NodeSideDrawerProps {
  node: MindMapNode;
  onClose: () => void;
  onUpdateText: (id: string, text: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
  onRemoveImage: (nodeId: string, imgId: string) => void;
  onUploadAttachment: (nodeId: string, files: FileList) => void;
  onRemoveAttachment: (nodeId: string, attId: string) => void;
  onOpenImagePicker: () => void;
}

export function NodeSideDrawer({
  node,
  onClose,
  onUpdateText,
  onUpdateNotes,
  onRemoveImage,
  onUploadAttachment,
  onRemoveAttachment,
  onOpenImagePicker,
}: NodeSideDrawerProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <aside className="mf-side-drawer" aria-label="Node Notes and Attachments">
      <div className="mf-drawer-header">
        <span>Node Inspector &amp; Attachments (A)</span>
        <button type="button" className="mf-btn" aria-label="Close drawer" onClick={onClose}>
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="mf-drawer-body">
        <div>
          <label htmlFor="drawer-node-md" style={{ fontWeight: 600, fontSize: "0.84rem" }}>
            Node Markdown / Formulas / Code
          </label>
          <textarea
            id="drawer-node-md"
            className="mf-drawer-textarea"
            style={{ marginTop: 6 }}
            value={node.text}
            onChange={(e) => onUpdateText(node.id, e.target.value)}
          />
        </div>

        <div>
          <div style={{ fontWeight: 600, fontSize: "0.84rem", marginBottom: 4 }}>
            Rendered Output
          </div>
          <div
            className="mf-node-content"
            style={{
              border: "1px solid var(--border-color)",
              borderRadius: 8,
              padding: 10,
              background: "var(--bg-elevated)",
              maxHeight: 220,
              overflow: "auto",
            }}
            dangerouslySetInnerHTML={{ __html: renderRichNodeContent(node.text) }}
          />
        </div>

        <div>
          <label htmlFor="drawer-node-notes" style={{ fontWeight: 600, fontSize: "0.84rem" }}>
            Extended Side Notes (Markdown &amp; LaTeX)
          </label>
          <textarea
            id="drawer-node-notes"
            className="mf-drawer-textarea"
            style={{ marginTop: 6, minHeight: 96 }}
            placeholder="Write detailed study notes, derivations, or links here..."
            value={node.notes || ""}
            onChange={(e) => onUpdateNotes(node.id, e.target.value)}
          />
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600, fontSize: "0.84rem" }}>
              Photos ({node.images?.length || 0})
            </span>
            <button type="button" className="mf-chip-btn" onClick={onOpenImagePicker}>
              <ImagePlus size={12} aria-hidden="true" /> Add Photo (I)
            </button>
          </div>
          {node.images && node.images.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {node.images.map((img) => (
                <div
                  key={img.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: 6,
                    border: "1px solid var(--border-color)",
                    borderRadius: 8,
                  }}
                >
                  <img
                    src={img.url}
                    alt={img.name}
                    style={{ width: 42, height: 42, objectFit: "cover", borderRadius: 6 }}
                  />
                  <span style={{ flex: 1, fontSize: "0.78rem", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {img.name}
                  </span>
                  <button
                    type="button"
                    className="mf-btn"
                    aria-label={`Remove image ${img.name}`}
                    onClick={() => onRemoveImage(node.id, img.id)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ fontWeight: 600, fontSize: "0.84rem" }}>
              File Attachments ({node.attachments?.length || 0})
            </span>
            <button
              type="button"
              className="mf-chip-btn"
              onClick={() => fileInputRef.current?.click()}
            >
              <FileUp size={12} aria-hidden="true" /> Attach File
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  onUploadAttachment(node.id, e.target.files);
                  e.target.value = "";
                }
              }}
            />
          </div>
          {node.attachments && node.attachments.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
              {node.attachments.map((att) => (
                <div
                  key={att.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
                    padding: "6px 8px",
                    border: "1px solid var(--border-color)",
                    borderRadius: 8,
                    fontSize: "0.78rem",
                  }}
                >
                  <a href={att.url} download={att.name} target="_blank" rel="noreferrer" style={{ flex: 1 }}>
                    {att.name} ({Math.max(1, Math.round(att.size / 1024))} KB)
                  </a>
                  <button
                    type="button"
                    className="mf-btn"
                    aria-label={`Remove attachment ${att.name}`}
                    onClick={() => onRemoveAttachment(node.id, att.id)}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
