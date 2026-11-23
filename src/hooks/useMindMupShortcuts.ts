import { useEffect } from "react";
import type { CanvasTool, LayoutNodeInfo, MindMapDocument } from "../types/mindmap";
import { findArrowNavigationTarget } from "../utils/layoutEngine";

interface ShortcutHandlers {
  doc: MindMapDocument;
  layouts: Record<string, LayoutNodeInfo>;
  selectedIds: string[];
  primarySelectedId: string;
  editingId: string | null;
  anyDialogOpen: boolean;
  onSelect: (ids: string[]) => void;
  onStartEdit: (id: string) => void;
  onAddChild: () => void;
  onAddSibling: (pos: "below" | "above") => void;
  onInsertParent: () => void;
  onDeleteSelected: () => void;
  onAddDetachedRoot: () => void;
  onDetachSelected: () => void;
  onReorderSibling: (delta: -1 | 1) => void;
  onToggleCollapse: () => void;
  onCollapseToLevel: (level: number) => void;
  onExpandAll: () => void;
  onFontSize: (mode: "inc" | "dec" | "reset") => void;
  onAlign: (align: "left" | "center" | "right") => void;
  onSelectSubtree: (includeRoot: boolean) => void;
  onSelectSiblings: () => void;
  onSelectAll: () => void;
  onEscapeCanvas: () => void;
  onSetTool: (tool: CanvasTool) => void;
  onRecenter: () => void;
  onZoomFit: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCopy: () => void;
  onCut: () => void;
  onTriggerPasteAction: (asSubtree: boolean) => void;
  onSaveNow: () => void;
  onOpenSearch: () => void;
  onOpenImagePicker: () => void;
  onToggleDrawer: () => void;
  onToggleStylePopover: () => void;
  onToggleStickerPopover: () => void;
  onToggleCrossLinkMode: () => void;
  onToggleShortcuts: () => void;
  onToggleDarkLight: () => void;
  onCycleTheme: () => void;
}

export function useMindMupShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (handlers.editingId || handlers.anyDialogOpen) return;

      const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") {
        return;
      }

      const mod = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;
      const alt = e.altKey;
      const key = e.key;
      const lower = key.toLowerCase();

      // --- 1. Global Canvas & Workspace Shortcuts (active even with 0 nodes selected) ---

      // Select All Nodes: Cmd/Ctrl + A
      if (mod && !shift && !alt && lower === "a") {
        e.preventDefault();
        handlers.onSelectAll();
        return;
      }

      // Escape on canvas: clear multi-selection / popovers / cross-link mode / active selection
      if (!mod && !shift && !alt && key === "Escape") {
        e.preventDefault();
        handlers.onEscapeCanvas();
        return;
      }

      // Help modal: Ctrl+/ or ?
      if ((mod && key === "/") || (!mod && !alt && key === "?")) {
        e.preventDefault();
        handlers.onToggleShortcuts();
        return;
      }

      // Save: Ctrl+S
      if (mod && !shift && !alt && lower === "s") {
        e.preventDefault();
        handlers.onSaveNow();
        return;
      }

      // Search: Ctrl+F
      if (mod && !shift && !alt && lower === "f") {
        e.preventDefault();
        handlers.onOpenSearch();
        return;
      }

      // Viewport recenter / fit: Ctrl+0 / Ctrl+1
      if (mod && !shift && !alt && key === "0") {
        e.preventDefault();
        handlers.onRecenter();
        return;
      }
      if (mod && !shift && !alt && key === "1") {
        e.preventDefault();
        handlers.onZoomFit();
        return;
      }

      // Undo / Redo: U, Ctrl+Z, R, Ctrl+Y, Ctrl+Shift+Z
      if (
        (mod && shift && lower === "z") ||
        (mod && !shift && lower === "y") ||
        (!mod && !alt && !shift && lower === "r")
      ) {
        e.preventDefault();
        handlers.onRedo();
        return;
      }
      if ((mod && !shift && lower === "z") || (!mod && !alt && !shift && lower === "u")) {
        e.preventDefault();
        handlers.onUndo();
        return;
      }

      // Paste LLM Subtree: Ctrl+Shift+V
      if (mod && !alt && shift && lower === "v") {
        e.preventDefault();
        handlers.onTriggerPasteAction(true);
        return;
      }

      // Detached root: Ctrl+D
      if (mod && !shift && !alt && lower === "d") {
        e.preventDefault();
        handlers.onAddDetachedRoot();
        return;
      }

      // Alt + D: Toggle Light/Dark theme (use e.code for macOS Option compatibility)
      if (alt && !mod && e.code === "KeyD") {
        e.preventDefault();
        handlers.onToggleDarkLight();
        return;
      }

      // Alt + M: Cycle MindMeister theme
      if (alt && !mod && e.code === "KeyM") {
        e.preventDefault();
        handlers.onCycleTheme();
        return;
      }

      // Alt + 1..9: Collapse/Expand outline level 1..9; Alt + 0 / Shift + F: Expand all
      if (alt && !mod && /^Digit[1-9]$/.test(e.code)) {
        e.preventDefault();
        const level = Number(e.code.replace("Digit", ""));
        handlers.onCollapseToLevel(level);
        return;
      }
      if ((alt && !mod && e.code === "Digit0") || (!mod && !alt && shift && lower === "f")) {
        e.preventDefault();
        handlers.onExpandAll();
        return;
      }

      // Canvas Tools: V / H
      if (!mod && !alt && !shift && lower === "v") {
        e.preventDefault();
        handlers.onSetTool("select");
        return;
      }
      if (!mod && !alt && !shift && lower === "h") {
        e.preventDefault();
        handlers.onSetTool("hand");
        return;
      }

      // --- 2. Guard when no node is selected ---
      const hasSelection = handlers.selectedIds.some((id) => Boolean(handlers.doc.nodes[id]));
      if (!hasSelection) {
        if (
          !mod &&
          !alt &&
          (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight")
        ) {
          e.preventDefault();
          const rootId = handlers.doc.rootIds[0];
          if (rootId) handlers.onSelect([rootId]);
        }
        return;
      }

      // --- 3. Node-Targeted Shortcuts (require >= 1 selected node) ---

      // Copy / Cut
      if (mod && !alt && !shift && lower === "c") {
        e.preventDefault();
        handlers.onCopy();
        return;
      }
      if (mod && !alt && !shift && lower === "x") {
        e.preventDefault();
        handlers.onCut();
        return;
      }

      // Text alignment: Shift+Ctrl+L / E / R
      if (mod && shift && !alt && lower === "l") {
        e.preventDefault();
        handlers.onAlign("left");
        return;
      }
      if (mod && shift && !alt && lower === "e") {
        e.preventDefault();
        handlers.onAlign("center");
        return;
      }
      if (mod && shift && !alt && lower === "r") {
        e.preventDefault();
        handlers.onAlign("right");
        return;
      }

      // Reorder siblings: Ctrl+Up / Ctrl+Down
      if (mod && !shift && !alt && key === "ArrowUp") {
        e.preventDefault();
        handlers.onReorderSibling(-1);
        return;
      }
      if (mod && !shift && !alt && key === "ArrowDown") {
        e.preventDefault();
        handlers.onReorderSibling(1);
        return;
      }

      // Detach: D
      if (!mod && !shift && !alt && lower === "d") {
        e.preventDefault();
        handlers.onDetachSelected();
        return;
      }

      // Alt + X: Cross-link mode
      if (alt && !mod && e.code === "KeyX") {
        e.preventDefault();
        handlers.onToggleCrossLinkMode();
        return;
      }

      // Alt + T: Reset font size
      if (alt && !mod && e.code === "KeyT") {
        e.preventDefault();
        handlers.onFontSize("reset");
        return;
      }

      // Tree Creation: Tab, Shift+Tab, Enter, Shift+Enter
      const isOrg = handlers.doc.layout === "org-chart";
      if (!mod && !alt && key === "Tab") {
        e.preventDefault();
        if (shift) {
          handlers.onInsertParent();
        } else if (isOrg) {
          handlers.onAddSibling("below");
        } else {
          handlers.onAddChild();
        }
        return;
      }
      if (!mod && !alt && key === "Enter") {
        e.preventDefault();
        if (shift) {
          handlers.onAddSibling("above");
        } else if (isOrg) {
          handlers.onAddChild();
        } else {
          handlers.onAddSibling("below");
        }
        return;
      }

      // Delete node(s)
      if (!mod && !alt && (key === "Backspace" || key === "Delete")) {
        e.preventDefault();
        handlers.onDeleteSelected();
        return;
      }

      // Edit & Popovers: Space, F2, Shift+Space, I, A, Shift+S
      if (!mod && !alt && key === " ") {
        e.preventDefault();
        if (shift) {
          handlers.onToggleStylePopover();
        } else {
          handlers.onStartEdit(handlers.primarySelectedId);
        }
        return;
      }
      if (!mod && !alt && key === "F2") {
        e.preventDefault();
        handlers.onStartEdit(handlers.primarySelectedId);
        return;
      }
      if (!mod && !alt && !shift && lower === "i") {
        e.preventDefault();
        handlers.onOpenImagePicker();
        return;
      }
      if (!mod && !alt && !shift && lower === "a") {
        e.preventDefault();
        handlers.onToggleDrawer();
        return;
      }
      if (!mod && !alt && shift && lower === "s") {
        e.preventDefault();
        handlers.onToggleStickerPopover();
        return;
      }

      // Font size: T / Shift+T
      if (!mod && !alt && lower === "t") {
        e.preventDefault();
        handlers.onFontSize(shift ? "dec" : "inc");
        return;
      }

      // Fold / Unfold: F
      if (!mod && !alt && !shift && lower === "f") {
        e.preventDefault();
        handlers.onToggleCollapse();
        return;
      }

      // Multi-select subtree / siblings: {, [, =
      if (!mod && !alt && key === "{") {
        e.preventDefault();
        handlers.onSelectSubtree(true);
        return;
      }
      if (!mod && !alt && key === "[") {
        e.preventDefault();
        handlers.onSelectSubtree(false);
        return;
      }
      if (!mod && !alt && key === "=") {
        e.preventDefault();
        handlers.onSelectSiblings();
        return;
      }

      // Arrow Navigation (and Shift+Arrow multi-select)
      if (
        !mod &&
        !alt &&
        (key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight")
      ) {
        e.preventDefault();
        const nextId = findArrowNavigationTarget(
          handlers.primarySelectedId,
          key,
          handlers.layouts,
          handlers.doc
        );
        if (nextId) {
          if (shift) {
            const set = new Set(handlers.selectedIds);
            set.add(nextId);
            handlers.onSelect(Array.from(set));
          } else {
            handlers.onSelect([nextId]);
          }
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers]);
}
