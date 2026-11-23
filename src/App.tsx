import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { AlertTriangle, Crosshair, Maximize2, Minimize2, ZoomIn, ZoomOut } from "lucide-react";
import { FloatingCrossLinkToolbar } from "./components/FloatingCrossLinkToolbar";
import { FloatingNodeToolbar } from "./components/FloatingNodeToolbar";
import { LlmAssistantDrawer } from "./components/LlmAssistantDrawer";
import { ImageLightboxModal, ImagePickerModal, ShortcutsModal, SubtreePasteModal } from "./components/Modals";
import { MindMapNodeCard } from "./components/MindMapNodeCard";
import { NodeSideDrawer } from "./components/NodeSideDrawer";
import { TopToolbar } from "./components/TopToolbar";
import { useColorScheme } from "./hooks/useColorScheme";
import { useMindMupShortcuts } from "./hooks/useMindMupShortcuts";
import type {
  CanvasTool,
  CrossLink,
  CrossLinkHeadType,
  LayoutNodeInfo,
  MapSummary,
  MindMapDocument,
  MindMapNode,
  NodeAttachment,
  NodeImage,
  NodeShape,
  SaveState,
} from "./types/mindmap";
import {
  exportMapAsFreeMind,
  exportMapAsJson,
  exportMapAsMarkdown,
  exportMapAsMindMup,
  exportMapAsPng,
  exportMapAsSvg,
  importMapFromFileContent,
} from "./utils/exporters";
import {
  buildConnectorPath,
  buildCrossLinkPath,
  clampCrossLinkLabel,
  computeMindMapLayout,
  DEFAULT_HORIZONTAL_GAP,
  getNodeEdgeMidpoint,
  wrapCrossLinkLabelLines,
  type SizeMap,
} from "./utils/layoutEngine";
import { getNodeShortLabel } from "./utils/llmMindMapAgent";
import { extractMarkdownFromClipboard } from "./utils/llmMathNormalizer";
import { parseMarkdownToSubtree } from "./utils/markdownToSubtree";
import {
  deleteMapDual,
  getLastOpenedMapId,
  listMapsDual,
  loadMapDual,
  saveMapDual,
  uploadFileDual,
} from "./utils/storage";
import { getContrastTextColor, NODE_COLOR_SWATCHES, STICKER_PRESETS, THEME_ORDER } from "./utils/themes";
import {
  addChildNode,
  addDetachedRootNode,
  addSiblingNode,
  adjustFontSize,
  applyCollapseState,
  cloneDocument,
  collapseToLevel,
  createBlankMap,
  createInitialMap,
  deleteNodes,
  detachNodeToRoot,
  duplicateNodes,
  expandAllNodes,
  getMaxDepth,
  getNodeMoveCapabilities,
  getSiblingIds,
  getSubtreeIds,
  insertParentNode,
  insertSubtreeBranches,
  makeId,
  moveNodeRelative,
  pasteSubtreeNodes,
  removeAllPhotosFromNodes,
  repositionNode,
  resetNodesColor,
  resizeNodesBatch,
  serializeClipboardSubtree,
  setBatchCollapse,
  setNodesAlign,
  setNodesColor,
  setNodesShape,
  toggleAllTasksInNodes,
  toggleBatchFormatting,
  toggleCollapseNode,
  updateBatchPhotoProps,
  updateNodesStyle,
} from "./utils/treeOps";

interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

interface DragDropHint {
  draggedId: string;
  targetId: string;
  placement: "before" | "after" | "inside";
  side?: "left" | "right";
  indicator: {
    kind: "line" | "box";
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
  };
}

function computeDragDropHint(
  draggedId: string,
  worldX: number,
  worldY: number,
  curDoc: MindMapDocument,
  curLayouts: Record<string, LayoutNodeInfo>
): DragDropHint | null {
  const draggedNode = curDoc.nodes[draggedId];
  const draggedLayout = curLayouts[draggedId];
  if (!draggedNode || !draggedLayout || !draggedNode.parentId) return null;

  const excluded = new Set(getSubtreeIds(curDoc, draggedId, true));
  const candidates = Object.values(curLayouts).filter((l) => !excluded.has(l.id));

  let bestCand: LayoutNodeInfo | null = null;
  let bestDist = Infinity;

  for (const cand of candidates) {
    if (
      worldX >= cand.x - 18 &&
      worldX <= cand.x + cand.width + 18 &&
      worldY >= cand.y - 18 &&
      worldY <= cand.y + cand.height + 18
    ) {
      const cx = cand.x + cand.width / 2;
      const cy = cand.y + cand.height / 2;
      const dist = Math.hypot(worldX - cx, worldY - cy);
      if (dist < bestDist) {
        bestDist = dist;
        bestCand = cand;
      }
    }
  }

  if (!bestCand) {
    for (const cand of candidates) {
      if (cand.depth === 0) continue;
      if (curDoc.layout !== "org-chart") {
        if (worldX >= cand.x - 48 && worldX <= cand.x + cand.width + 48) {
          const cy = cand.y + cand.height / 2;
          const vDist = Math.abs(worldY - cy);
          if (vDist <= cand.height / 2 + 56 && vDist < bestDist) {
            bestDist = vDist;
            bestCand = cand;
          }
        }
      } else if (worldY >= cand.y - 48 && worldY <= cand.y + cand.height + 48) {
        const cx = cand.x + cand.width / 2;
        const hDist = Math.abs(worldX - cx);
        if (hDist <= cand.width / 2 + 56 && hDist < bestDist) {
          bestDist = hDist;
          bestCand = cand;
        }
      }
    }
  }

  if (bestCand) {
    if (bestCand.depth === 0) {
      const candCenterX = bestCand.x + bestCand.width / 2;
      const side =
        curDoc.layout === "org-chart"
          ? undefined
          : curDoc.layout === "tree-right"
          ? "right"
          : worldX < candCenterX
          ? "left"
          : "right";
      const label =
        side === "left" ? "Move to Left" : side === "right" ? "Move to Right" : "Attach here";
      return {
        draggedId,
        targetId: bestCand.id,
        placement: "inside",
        side,
        indicator: {
          kind: "box",
          x: bestCand.x,
          y: bestCand.y,
          width: bestCand.width,
          height: bestCand.height,
          label,
        },
      };
    }

    if (curDoc.layout === "org-chart") {
      const relX = (worldX - bestCand.x) / Math.max(1, bestCand.width);
      if (relX < 0.34) {
        return {
          draggedId,
          targetId: bestCand.id,
          placement: "before",
          indicator: {
            kind: "line",
            x: bestCand.x - 10,
            y: bestCand.y - 4,
            width: 4,
            height: bestCand.height + 8,
            label: "Move left",
          },
        };
      }
      if (relX > 0.66) {
        return {
          draggedId,
          targetId: bestCand.id,
          placement: "after",
          indicator: {
            kind: "line",
            x: bestCand.x + bestCand.width + 6,
            y: bestCand.y - 4,
            width: 4,
            height: bestCand.height + 8,
            label: "Move right",
          },
        };
      }
      return {
        draggedId,
        targetId: bestCand.id,
        placement: "inside",
        indicator: {
          kind: "box",
          x: bestCand.x,
          y: bestCand.y,
          width: bestCand.width,
          height: bestCand.height,
          label: "Make child",
        },
      };
    }

    const candSide = bestCand.side === "left" ? "left" : "right";
    const relY = (worldY - bestCand.y) / Math.max(1, bestCand.height);
    if (relY < 0.34) {
      return {
        draggedId,
        targetId: bestCand.id,
        placement: "before",
        side: candSide,
        indicator: {
          kind: "line",
          x: bestCand.x,
          y: bestCand.y - 10,
          width: bestCand.width,
          height: 4,
          label: "Move above",
        },
      };
    }
    if (relY > 0.66) {
      return {
        draggedId,
        targetId: bestCand.id,
        placement: "after",
        side: candSide,
        indicator: {
          kind: "line",
          x: bestCand.x,
          y: bestCand.y + bestCand.height + 6,
          width: bestCand.width,
          height: 4,
          label: "Move below",
        },
      };
    }
    return {
      draggedId,
      targetId: bestCand.id,
      placement: "inside",
      side: candSide,
      indicator: {
        kind: "box",
        x: bestCand.x,
        y: bestCand.y,
        width: bestCand.width,
        height: bestCand.height,
        label: "Make child",
      },
    };
  }

  if (curDoc.layout !== "org-chart") {
    const rootLayout = curLayouts[draggedLayout.rootId];
    if (rootLayout) {
      const rootCenterX = rootLayout.x + rootLayout.width / 2;
      const currentSide = draggedLayout.side === "left" ? "left" : "right";
      if (currentSide === "right" && worldX < rootCenterX - 18) {
        return {
          draggedId,
          targetId: rootLayout.id,
          placement: "inside",
          side: "left",
          indicator: {
            kind: "box",
            x: rootLayout.x,
            y: rootLayout.y,
            width: rootLayout.width,
            height: rootLayout.height,
            label: "Move to Left",
          },
        };
      }
      if (currentSide === "left" && worldX > rootCenterX + 18) {
        return {
          draggedId,
          targetId: rootLayout.id,
          placement: "inside",
          side: "right",
          indicator: {
            kind: "box",
            x: rootLayout.x,
            y: rootLayout.y,
            width: rootLayout.width,
            height: rootLayout.height,
            label: "Move to Right",
          },
        };
      }
    }
  }

  return null;
}

export function App() {
  const [doc, setDoc] = useState<MindMapDocument>(() => createInitialMap());
  const [maps, setMaps] = useState<MapSummary[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [syncStatus, setSyncStatus] = useState("Loading…");
  const [lastSavedTime, setLastSavedTime] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveErrorDismissed, setSaveErrorDismissed] = useState(false);
  const [autoSaveIntervalSec, setAutoSaveIntervalSec] = useState<number>(45);
  const [past, setPast] = useState<MindMapDocument[]>([]);
  const [future, setFuture] = useState<MindMapDocument[]>([]);

  const [selectedIds, setSelectedIds] = useState<string[]>(() => [doc.rootIds[0]]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tool, setTool] = useState<CanvasTool>("select");
  const [measuredSizes, setMeasuredSizes] = useState<SizeMap>({});

  const [viewport, setViewport] = useState<ViewportTransform>({ x: 520, y: 320, scale: 1 });
  const [containerRect, setContainerRect] = useState<{ width: number; height: number }>({
    width: 1200,
    height: 800,
  });
  const [isPanning, setIsPanning] = useState(false);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [imageModalOpen, setImageModalOpen] = useState(false);
  const [subtreeModalOpen, setSubtreeModalOpen] = useState(false);
  const [subtreePrefill, setSubtreePrefill] = useState("");
  const [lightboxImage, setLightboxImage] = useState<NodeImage | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [llmChatOpen, setLlmChatOpen] = useState(false);
  const [stylePopoverOpen, setStylePopoverOpen] = useState(false);
  const [stickerPopoverOpen, setStickerPopoverOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [crossLinkSourceId, setCrossLinkSourceId] = useState<string | null>(null);
  const [crossLinkPointer, setCrossLinkPointer] = useState<{ x: number; y: number } | null>(null);
  const [selectedCrossLinkId, setSelectedCrossLinkId] = useState<string | null>(null);
  const [autoEditCrossLinkId, setAutoEditCrossLinkId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<{ nodeId: string; dx: number; dy: number } | null>(null);
  const [dragDropHint, setDragDropHint] = useState<DragDropHint | null>(null);

  const [liveStatus, setLiveStatus] = useState("");
  const [toast, setToast] = useState<{ msg: string; actionLabel?: string; onAction?: () => void } | null>(null);

  const viewportRef = useRef<HTMLDivElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const internalClipboardRef = useRef<{ nodes: MindMapNode[]; plainFingerprint: string } | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const toastTimerRef = useRef<number | null>(null);
  const initializedRef = useRef(false);
  const docRef = useRef<MindMapDocument>(doc);
  docRef.current = doc;
  const dirtyRef = useRef(false);
  const saveSeqRef = useRef(0);

  const { isDark, toggleDarkLight } = useColorScheme();

  const announce = useCallback((msg: string, actionLabel?: string, onAction?: () => void) => {
    setLiveStatus(msg);
    setToast({ msg, actionLabel, onAction });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), actionLabel ? 5500 : 2400);
  }, []);

  const hasSelection = useMemo(
    () => selectedIds.some((id) => Boolean(doc.nodes[id])),
    [selectedIds, doc.nodes]
  );

  const primarySelectedId = useMemo(() => {
    const valid = selectedIds.find((id) => doc.nodes[id]);
    return valid || doc.rootIds[0];
  }, [selectedIds, doc.nodes, doc.rootIds]);

  const layouts = useMemo(
    () => computeMindMapLayout(doc, measuredSizes, isDark),
    [doc, measuredSizes, isDark]
  );
  const layoutsRef = useRef(layouts);
  layoutsRef.current = layouts;
  const viewportStateRef = useRef(viewport);
  viewportStateRef.current = viewport;

  const maxDepth = useMemo(() => getMaxDepth(doc), [doc]);
  const levelOptions = useMemo(
    () => Array.from({ length: Math.max(1, maxDepth) }, (_, i) => i + 1),
    [maxDepth]
  );

  const commitDoc = useCallback((nextDoc: MindMapDocument, recordHistory = true) => {
    setDoc((prev) => {
      if (nextDoc === prev) return prev;
      if (recordHistory) {
        setPast((p) => [...p.slice(-79), prev]);
        setFuture([]);
      }
      return nextDoc;
    });
  }, []);

  const collapseMapToLevel = useCallback(
    (level: number) => {
      commitDoc(collapseToLevel(doc, level), false);
      announce(`Collapsed map to level ${level}`);
    },
    [doc, commitDoc, announce]
  );

  const expandAll = useCallback(() => {
    commitDoc(expandAllNodes(doc), false);
    announce("Expanded all nodes");
  }, [doc, commitDoc, announce]);

  const refreshMapList = useCallback(async (currentDoc: MindMapDocument) => {
    const { summaries } = await listMapsDual();
    const hasCurrent = summaries.some((s) => s.id === currentDoc.id);
    if (!hasCurrent) {
      summaries.unshift({
        id: currentDoc.id,
        title: currentDoc.title,
        updatedAt: currentDoc.updatedAt,
        nodeCount: Object.keys(currentDoc.nodes).length,
      });
    }
    setMaps(summaries);
  }, []);

  const performSave = useCallback(
    async (targetDoc: MindMapDocument, isManual = false) => {
      const seq = ++saveSeqRef.current;
      setSaveState("saving");
      setSyncStatus("Saving…");

      const res = await saveMapDual(targetDoc);
      if (seq !== saveSeqRef.current) return res;

      if (res.ok) {
        dirtyRef.current = false;
        setSaveState("saved");
        setSaveError(null);
        setSaveErrorDismissed(false);
        const timeStr = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        setSyncStatus("Saved");
        setLastSavedTime(timeStr);
        void refreshMapList(targetDoc);
        if (isManual) announce("Map saved");
      } else {
        setSaveState("error");
        const errMsg =
          res.error || "Auto-save failed. Check server connection or browser storage.";
        setSaveError(errMsg);
        setSaveErrorDismissed(false);
        setSyncStatus("Save failed");
        if (isManual) announce(errMsg);
      }
      return res;
    },
    [refreshMapList, announce]
  );

  // Load initial workspace from backend/IndexedDB on mount
  useEffect(() => {
    let active = true;
    (async () => {
      const { summaries, backendOnline } = await listMapsDual();
      const lastId = getLastOpenedMapId();
      const targetId =
        (lastId && summaries.some((s) => s.id === lastId) ? lastId : summaries[0]?.id) || null;

      let loaded: MindMapDocument | null = null;
      if (targetId) {
        loaded = await loadMapDual(targetId);
      }

      let initialSaveOk = backendOnline;
      let initialSaveErr: string | undefined = backendOnline
        ? undefined
        : "Server unreachable — loaded from local browser cache.";

      if (!loaded) {
        loaded = createInitialMap();
        const saveRes = await saveMapDual(loaded);
        initialSaveOk = saveRes.ok;
        initialSaveErr = saveRes.error;
      }

      if (!active) return;
      setDoc(loaded);
      setSelectedIds([loaded.rootIds[0]]);
      await refreshMapList(loaded);

      if (initialSaveOk) {
        setSaveState("saved");
        setSaveError(null);
        setSaveErrorDismissed(false);
        const timeStr = new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        });
        setSyncStatus("Saved");
        setLastSavedTime(timeStr);
      } else {
        setSaveState("error");
        setSaveError(initialSaveErr || "Server unreachable — working locally.");
        setSaveErrorDismissed(false);
        setSyncStatus("Save failed");
      }

      initializedRef.current = true;

      requestAnimationFrame(() => {
        const el = viewportRef.current;
        if (el) {
          setViewport({
            x: el.clientWidth / 2,
            y: el.clientHeight / 2,
            scale: 1,
          });
        }
      });
    })();
    return () => {
      active = false;
    };
  }, [refreshMapList]);

  // Debounced dual persistence whenever doc updates
  useEffect(() => {
    if (!initializedRef.current) return;
    dirtyRef.current = true;
    setSaveState((prev) => (prev === "error" ? "error" : "unsaved"));
    setSyncStatus((prev) => (prev === "Save failed" ? prev : "Unsaved changes"));

    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void performSave(doc, false);
    }, 4500);

    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    };
  }, [doc, performSave]);

  // Regular interval auto-save (default 45s) + visibilitychange safeguard
  useEffect(() => {
    const intervalMs = Math.max(15, autoSaveIntervalSec) * 1000;
    const id = window.setInterval(() => {
      if (!initializedRef.current) return;
      void performSave(docRef.current, false);
    }, intervalMs);

    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden" && initializedRef.current && dirtyRef.current) {
        void performSave(docRef.current, false);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [autoSaveIntervalSec, performSave]);

  const handleSizeChange = useCallback((nodeId: string, width: number, height: number) => {
    setMeasuredSizes((prev) => {
      const cur = prev[nodeId];
      if (cur && Math.abs(cur.width - width) < 2 && Math.abs(cur.height - height) < 2) {
        return prev;
      }
      return { ...prev, [nodeId]: { width, height } };
    });
  }, []);

  const recenterView = useCallback(() => {
    const el = viewportRef.current;
    if (!el) return;
    const rootLayout = layouts[doc.rootIds[0]];
    const cx = rootLayout ? rootLayout.x + rootLayout.width / 2 : 0;
    const cy = rootLayout ? rootLayout.y + rootLayout.height / 2 : 0;
    setViewport({
      x: el.clientWidth / 2 - cx,
      y: el.clientHeight / 2 - cy,
      scale: 1,
    });
  }, [layouts, doc.rootIds]);

  const zoomToFit = useCallback(() => {
    const el = viewportRef.current;
    const items = Object.values(layouts);
    if (!el || items.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const item of items) {
      minX = Math.min(minX, item.x);
      minY = Math.min(minY, item.y);
      maxX = Math.max(maxX, item.x + item.width);
      maxY = Math.max(maxY, item.y + item.height);
    }

    const boxW = Math.max(200, maxX - minX);
    const boxH = Math.max(150, maxY - minY);
    const pad = 72;
    const scale = Math.min(
      1.35,
      Math.max(0.25, Math.min((el.clientWidth - pad) / boxW, (el.clientHeight - pad) / boxH))
    );
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    setViewport({
      x: el.clientWidth / 2 - cx * scale,
      y: el.clientHeight / 2 - cy * scale,
      scale,
    });
  }, [layouts]);

  const centerOnNode = useCallback(
    (nodeId: string, rightOverlayWidth = 0) => {
      const el = viewportRef.current;
      const info = layouts[nodeId];
      if (!el || !info) return;
      const cx = info.x + info.width / 2;
      const cy = info.y + info.height / 2;
      const usableWidth = Math.max(220, el.clientWidth - rightOverlayWidth);
      setViewport((v) => ({
        ...v,
        x: usableWidth / 2 - cx * v.scale,
        y: el.clientHeight / 2 - cy * v.scale,
      }));
    },
    [layouts]
  );

  // Measure canvas container dimensions for floating contextual toolbar clamping
  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerRect({
          width: Math.round(entry.contentRect.width),
          height: Math.round(entry.contentRect.height),
        });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Wheel pan & cursor-centered zoom (Ctrl+Scroll / Shift+Scroll / Scroll)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    let rafId: number | null = null;
    let pendingZoomDelta = 0;
    let pendingPanX = 0;
    let pendingPanY = 0;
    let lastCursorX = 0;
    let lastCursorY = 0;

    const flushWheel = () => {
      rafId = null;
      const zoomDelta = pendingZoomDelta;
      const panX = pendingPanX;
      const panY = pendingPanY;
      const cx = lastCursorX;
      const cy = lastCursorY;
      pendingZoomDelta = 0;
      pendingPanX = 0;
      pendingPanY = 0;

      setViewport((v) => {
        let nextX = v.x - panX;
        let nextY = v.y - panY;
        let nextScale = v.scale;
        if (zoomDelta !== 0) {
          const factor = Math.exp(-zoomDelta * 0.00495);
          nextScale = Math.min(2.6, Math.max(0.2, v.scale * factor));
          const ratio = nextScale / v.scale;
          nextX = cx - (cx - nextX) * ratio;
          nextY = cy - (cy - nextY) * ratio;
        }
        return { x: nextX, y: nextY, scale: nextScale };
      });
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        lastCursorX = e.clientX - rect.left;
        lastCursorY = e.clientY - rect.top;
        const rawDelta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
        pendingZoomDelta += Math.max(-60, Math.min(60, rawDelta));
      } else if (e.shiftKey) {
        pendingPanX += e.deltaY || e.deltaX;
      } else {
        pendingPanX += e.deltaX;
        pendingPanY += e.deltaY;
      }
      if (rafId === null) {
        rafId = window.requestAnimationFrame(flushWheel);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", onWheel);
      if (rafId !== null) window.cancelAnimationFrame(rafId);
    };
  }, []);

  const attachFilesToNode = useCallback(
    async (nodeId: string, files: FileList | File[]) => {
      const list = Array.from(files);
      if (list.length === 0) return;

      const addedImages: NodeImage[] = [];
      const addedAttachments: NodeAttachment[] = [];

      for (const file of list) {
        const uploaded = await uploadFileDual(file);
        if (uploaded.mimeType.startsWith("image/")) {
          addedImages.push({
            id: makeId("img"),
            url: uploaded.url,
            name: uploaded.name,
            width: 210,
          });
        } else {
          addedAttachments.push({
            id: makeId("att"),
            url: uploaded.url,
            name: uploaded.name,
            mimeType: uploaded.mimeType,
            size: uploaded.size,
          });
        }
      }

      commitDoc(
        updateNodesStyle(doc, [nodeId], (n) => {
          if (addedImages.length > 0) {
            n.images = [...(n.images || []), ...addedImages];
          }
          if (addedAttachments.length > 0) {
            n.attachments = [...(n.attachments || []), ...addedAttachments];
          }
        })
      );
      announce(`Attached ${list.length} file(s) to node`);
    },
    [doc, commitDoc, announce]
  );

  // Global canvas Paste handler (Ctrl/Cmd+V outside editor)
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      if (editingId || shortcutsOpen || imageModalOpen || subtreeModalOpen) return;
      const activeEl = document.activeElement as HTMLElement | null;
      const activeTag = activeEl?.tagName;
      if (
        activeTag === "INPUT" ||
        activeTag === "TEXTAREA" ||
        activeEl?.closest?.(".mf-llm-drawer")
      ) {
        return;
      }
      if (!e.clipboardData) return;
      if (!hasSelection) {
        announce("Select a node first before pasting");
        return;
      }

      // 1. Check pasted image files/screenshots
      const items = Array.from(e.clipboardData.items || []);
      const imgItem = items.find((it) => it.type.startsWith("image/"));
      if (imgItem) {
        const file = imgItem.getAsFile();
        if (file) {
          e.preventDefault();
          await attachFilesToNode(primarySelectedId, [file]);
          return;
        }
      }

      // 2. Check internal mind map node clipboard vs new external LLM text
      const { text: extracted, hasRichHtmlMath } = extractMarkdownFromClipboard(e.clipboardData);
      const internal = internalClipboardRef.current;
      if (internal && (!extracted || extracted === internal.plainFingerprint)) {
        e.preventDefault();
        const { doc: nextDoc, pastedRootIds } = pasteSubtreeNodes(
          doc,
          primarySelectedId,
          internal.nodes
        );
        commitDoc(nextDoc);
        if (pastedRootIds.length > 0) setSelectedIds(pastedRootIds);
        announce(`Pasted ${internal.nodes.length} node(s)`);
        return;
      }

      // 3. External text / LLM Markdown pasted onto selected node
      if (extracted.trim()) {
        e.preventDefault();
        const current = doc.nodes[primarySelectedId];
        if (!current) return;
        const shouldReplace = current.text === "New Idea" || current.text === "New Sibling";
        const mergedText = shouldReplace ? extracted : `${current.text}\n\n${extracted}`;
        commitDoc(
          updateNodesStyle(doc, [primarySelectedId], (n) => {
            n.text = mergedText;
          })
        );
        const looksStructured = /(?:^#{1,6}\s|^\s*[-*+]\s+)/m.test(extracted);
        announce(
          hasRichHtmlMath ? "Pasted LLM Markdown + math into node" : "Pasted text into node",
          looksStructured ? "Split into Subtree" : undefined,
          looksStructured
            ? () => {
                setSubtreePrefill(extracted);
                setSubtreeModalOpen(true);
              }
            : undefined
        );
      }
    };

    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  }, [
    editingId,
    shortcutsOpen,
    imageModalOpen,
    subtreeModalOpen,
    doc,
    primarySelectedId,
    attachFilesToNode,
    commitDoc,
    announce,
    hasSelection,
  ]);

  useEffect(() => {
    if (!crossLinkSourceId) {
      setCrossLinkPointer(null);
    }
  }, [crossLinkSourceId]);

  const connectNodesWithCrossLink = useCallback(
    (fromId: string, toId: string) => {
      if (!fromId || !toId || fromId === toId) return;
      const existing = doc.crossLinks.find(
        (xl) => xl.fromId === fromId && xl.toId === toId
      );
      if (existing) {
        setSelectedIds([]);
        setSelectedCrossLinkId(existing.id);
        setAutoEditCrossLinkId(existing.id);
        announce("Selected existing cross-link — edit text or style");
        return;
      }
      const next = cloneDocument(doc);
      const newId = makeId("xl");
      next.crossLinks.push({ id: newId, fromId, toId });
      next.updatedAt = new Date().toISOString();
      commitDoc(next);
      setSelectedIds([]);
      setSelectedCrossLinkId(newId);
      setAutoEditCrossLinkId(newId);
      announce("Added cross-link — enter label text or press Esc");
    },
    [doc, commitDoc, announce]
  );

  const handleToggleCrossLinkMode = useCallback(() => {
    setStylePopoverOpen(false);
    setStickerPopoverOpen(false);
    if (selectedIds.length === 2 && doc.nodes[selectedIds[0]] && doc.nodes[selectedIds[1]]) {
      setCrossLinkSourceId(null);
      connectNodesWithCrossLink(selectedIds[0], selectedIds[1]);
      return;
    }
    if (crossLinkSourceId) {
      setCrossLinkSourceId(null);
      announce("Cross-link canceled");
      return;
    }
    if (primarySelectedId && doc.nodes[primarySelectedId]) {
      setSelectedCrossLinkId(null);
      setCrossLinkSourceId(primarySelectedId);
      announce("Cross-link mode: click target node to connect (Esc to cancel)");
    }
  }, [
    selectedIds,
    doc.nodes,
    crossLinkSourceId,
    primarySelectedId,
    connectNodesWithCrossLink,
    announce,
  ]);

  const handleSelectNode = useCallback(
    (id: string, additive: boolean) => {
      setSelectedCrossLinkId(null);
      if (crossLinkSourceId) {
        if (crossLinkSourceId !== id) {
          connectNodesWithCrossLink(crossLinkSourceId, id);
        } else {
          announce("Cross-link canceled");
        }
        setCrossLinkSourceId(null);
        return;
      }

      if (additive) {
        setSelectedIds((prev) =>
          prev.includes(id) ? (prev.length > 1 ? prev.filter((x) => x !== id) : prev) : [...prev, id]
        );
      } else {
        setSelectedIds([id]);
      }
    },
    [crossLinkSourceId, connectNodesWithCrossLink, announce]
  );

  const handleUndo = useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const previous = p[p.length - 1];
      setFuture((f) => [doc, ...f.slice(0, 79)]);
      setDoc(applyCollapseState(previous, doc));
      announce("Undo");
      return p.slice(0, -1);
    });
  }, [doc, announce]);

  const handleRedo = useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const [nextDoc, ...rest] = f;
      setPast((p) => [...p, doc]);
      setDoc(applyCollapseState(nextDoc, doc));
      announce("Redo");
      return rest;
    });
  }, [doc, announce]);

  const handleCopy = useCallback(() => {
    const copied = serializeClipboardSubtree(doc, selectedIds);
    const plain = copied.map((n) => n.text).join("\n");
    internalClipboardRef.current = { nodes: copied, plainFingerprint: plain };
    navigator.clipboard?.writeText(plain).catch(() => {});
    announce(`Copied ${copied.length} node(s)`);
  }, [doc, selectedIds, announce]);

  const handleCut = useCallback(() => {
    const copied = serializeClipboardSubtree(doc, selectedIds);
    const plain = copied.map((n) => n.text).join("\n");
    internalClipboardRef.current = { nodes: copied, plainFingerprint: plain };
    navigator.clipboard?.writeText(plain).catch(() => {});
    const { doc: nextDoc, nextSelectedId } = deleteNodes(doc, selectedIds);
    commitDoc(nextDoc);
    if (nextSelectedId) setSelectedIds([nextSelectedId]);
    announce(`Cut ${copied.length} node(s)`);
  }, [doc, selectedIds, commitDoc, announce]);

  const handleTriggerSubtreeModal = useCallback(async () => {
    try {
      const clipText = await navigator.clipboard.readText();
      if (clipText) setSubtreePrefill(clipText);
    } catch {
      setSubtreePrefill("");
    }
    setSubtreeModalOpen(true);
  }, []);

  const handleAddChildNode = useCallback(() => {
    const targetId = hasSelection ? primarySelectedId : doc.rootIds[0];
    if (!targetId || !doc.nodes[targetId]) return;
    const { doc: next, newId } = addChildNode(doc, targetId);
    commitDoc(next);
    setSelectedIds([newId]);
    setEditingId(newId);
  }, [doc, hasSelection, primarySelectedId, commitDoc]);

  const handleAddSiblingNode = useCallback(
    (pos: "below" | "above" = "below") => {
      const targetId = hasSelection ? primarySelectedId : doc.rootIds[0];
      if (!targetId || !doc.nodes[targetId]) return;
      const { doc: next, newId } = addSiblingNode(doc, targetId, pos);
      commitDoc(next);
      setSelectedIds([newId]);
      setEditingId(newId);
    },
    [doc, hasSelection, primarySelectedId, commitDoc]
  );

  const handleInsertParentNode = useCallback(() => {
    const targetId = hasSelection ? primarySelectedId : doc.rootIds[0];
    if (!targetId || !doc.nodes[targetId]) return;
    const { doc: next, newId } = insertParentNode(doc, targetId);
    commitDoc(next);
    setSelectedIds([newId]);
    setEditingId(newId);
  }, [doc, hasSelection, primarySelectedId, commitDoc]);

  const handleAddDetachedRootNode = useCallback(() => {
    const cur = hasSelection ? layouts[primarySelectedId] : layouts[doc.rootIds[0]];
    const pos = cur ? { x: cur.x + cur.width / 2, y: cur.y + cur.height + 110 } : { x: 0, y: 180 };
    const { doc: next, newId } = addDetachedRootNode(doc, pos);
    commitDoc(next);
    setSelectedIds([newId]);
    setEditingId(newId);
    announce("Added detached root node");
  }, [doc, hasSelection, layouts, primarySelectedId, commitDoc, announce]);

  const handleMoveNode = useCallback(
    (direction: "up" | "down" | "left" | "right") => {
      if (!hasSelection) return;
      const next = moveNodeRelative(doc, primarySelectedId, direction);
      if (next !== doc) {
        commitDoc(next);
        const msg =
          direction === "up"
            ? "Moved node up"
            : direction === "down"
            ? "Moved node down"
            : direction === "left"
            ? "Moved node to left side"
            : "Moved node to right side";
        announce(msg);
      }
    },
    [hasSelection, doc, primarySelectedId, commitDoc, announce]
  );

  const primaryMoveCapabilities = useMemo(() => {
    if (!hasSelection || selectedIds.length !== 1) return undefined;
    return getNodeMoveCapabilities(doc, primarySelectedId);
  }, [hasSelection, selectedIds.length, doc, primarySelectedId]);

  const anyDialogOpen =
    shortcutsOpen || imageModalOpen || subtreeModalOpen || Boolean(lightboxImage);

  useMindMupShortcuts({
    doc,
    layouts,
    selectedIds,
    primarySelectedId,
    editingId,
    anyDialogOpen,
    onSelect: setSelectedIds,
    onStartEdit: setEditingId,
    onAddChild: handleAddChildNode,
    onAddSibling: handleAddSiblingNode,
    onInsertParent: handleInsertParentNode,
    onDeleteSelected: () => {
      const { doc: next, nextSelectedId } = deleteNodes(doc, selectedIds);
      commitDoc(next);
      if (nextSelectedId) setSelectedIds([nextSelectedId]);
      announce("Deleted selected node(s)");
    },
    onAddDetachedRoot: handleAddDetachedRootNode,
    onDetachSelected: () => {
      const cur = layouts[primarySelectedId];
      const pos = cur ? { x: cur.x + cur.width / 2, y: cur.y + cur.height / 2 } : undefined;
      const next = detachNodeToRoot(doc, primarySelectedId, pos);
      if (next !== doc) {
        commitDoc(next);
        announce("Detached node into independent root");
      }
    },
    onMoveNode: handleMoveNode,
    onToggleCollapse: () => {
      commitDoc(toggleCollapseNode(doc, primarySelectedId), false);
    },
    onCollapseToLevel: collapseMapToLevel,
    onExpandAll: expandAll,
    onFontSize: (mode) => {
      commitDoc(adjustFontSize(doc, selectedIds, mode));
    },
    onAlign: (align) => {
      commitDoc(setNodesAlign(doc, selectedIds, align));
    },
    onSelectSubtree: (includeRoot) => {
      const ids = getSubtreeIds(doc, primarySelectedId, includeRoot);
      if (ids.length > 0) setSelectedIds(ids);
    },
    onSelectSiblings: () => {
      const ids = getSiblingIds(doc, primarySelectedId);
      if (ids.length > 0) setSelectedIds(ids);
    },
    onSelectAll: () => {
      setSelectedCrossLinkId(null);
      const visibleIds = Object.keys(layouts);
      const allIds = Object.keys(doc.nodes);
      const nextIds =
        selectedIds.length >= visibleIds.length && allIds.length > visibleIds.length
          ? allIds
          : visibleIds;
      setSelectedIds(nextIds);
      announce(`Selected all ${nextIds.length} nodes`);
    },
    onEscapeCanvas: () => {
      const hadUiOpen =
        stylePopoverOpen ||
        stickerPopoverOpen ||
        searchOpen ||
        Boolean(crossLinkSourceId) ||
        Boolean(selectedCrossLinkId);
      setStylePopoverOpen(false);
      setStickerPopoverOpen(false);
      setSearchOpen(false);
      setCrossLinkSourceId(null);
      setSelectedCrossLinkId(null);
      setAutoEditCrossLinkId(null);
      if (selectedIds.length > 1) {
        setSelectedIds([primarySelectedId]);
        announce("Cleared multi-selection");
      } else if (selectedIds.length === 1 && !hadUiOpen) {
        setSelectedIds([]);
        setDrawerOpen(false);
        announce("Deselected node");
      }
    },
    onSetTool: (t) => {
      setTool(t);
      announce(t === "hand" ? "Hand pan tool active" : "Select tool active");
    },
    onRecenter: recenterView,
    onZoomFit: zoomToFit,
    onUndo: handleUndo,
    onRedo: handleRedo,
    onCopy: handleCopy,
    onCut: handleCut,
    onTriggerPasteAction: (asSubtree) => {
      if (asSubtree) setLlmChatOpen((o) => !o);
    },
    onSaveNow: () => {
      void performSave(doc, true);
    },
    onOpenSearch: () => {
      setSearchOpen(true);
      requestAnimationFrame(() => searchInputRef.current?.focus());
    },
    onOpenImagePicker: () => setImageModalOpen(true),
    onToggleDrawer: () => setDrawerOpen((o) => !o),
    onToggleStylePopover: () => {
      setStickerPopoverOpen(false);
      setStylePopoverOpen((o) => !o);
    },
    onToggleStickerPopover: () => {
      setStylePopoverOpen(false);
      setStickerPopoverOpen((o) => !o);
    },
    onToggleCrossLinkMode: handleToggleCrossLinkMode,
    onToggleShortcuts: () => setShortcutsOpen((o) => !o),
    onToggleDarkLight: () => {
      const target = toggleDarkLight();
      announce(`Switched to ${target} theme`);
    },
    onCycleTheme: () => {
      const idx = THEME_ORDER.indexOf(doc.theme);
      const nextTheme = THEME_ORDER[(idx + 1) % THEME_ORDER.length];
      commitDoc({ ...doc, theme: nextTheme, updatedAt: new Date().toISOString() });
      announce(`Theme changed to ${nextTheme}`);
    },
  });

  // Canvas pointer pan / marquee select
  const handleCanvasMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    setStylePopoverOpen(false);
    setStickerPopoverOpen(false);

    if (editingId) {
      setEditingId(null);
      return;
    }

    const usePan = tool === "hand" || e.button === 1;
    if (usePan) {
      setIsPanning(true);
      const startX = e.clientX;
      const startY = e.clientY;
      const origX = viewport.x;
      const origY = viewport.y;

      const onMove = (ev: MouseEvent) => {
        setViewport((v) => ({
          ...v,
          x: origX + (ev.clientX - startX),
          y: origY + (ev.clientY - startY),
        }));
      };
      const onUp = () => {
        setIsPanning(false);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      return;
    }

    // Marquee selection in Select tool
    const rect = viewportRef.current?.getBoundingClientRect();
    if (!rect) return;
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    let moved = false;

    const onMove = (ev: MouseEvent) => {
      const curX = ev.clientX - rect.left;
      const curY = ev.clientY - rect.top;
      if (Math.abs(curX - startX) > 4 || Math.abs(curY - startY) > 4) {
        moved = true;
        setSelectedCrossLinkId(null);
        setAutoEditCrossLinkId(null);
      }
      if (!moved) return;
      const box = {
        x: Math.min(startX, curX),
        y: Math.min(startY, curY),
        w: Math.abs(curX - startX),
        h: Math.abs(curY - startY),
      };
      setMarquee(box);

      const wx1 = (box.x - viewport.x) / viewport.scale;
      const wy1 = (box.y - viewport.y) / viewport.scale;
      const wx2 = (box.x + box.w - viewport.x) / viewport.scale;
      const wy2 = (box.y + box.h - viewport.y) / viewport.scale;

      const hits = Object.values(layouts)
        .filter((n) => n.x < wx2 && n.x + n.width > wx1 && n.y < wy2 && n.y + n.height > wy1)
        .map((n) => n.id);
      setSelectedIds(hits);
    };

    const onUp = () => {
      if (!moved) {
        setSelectedIds([]);
        setCrossLinkSourceId(null);
        setSelectedCrossLinkId(null);
        setAutoEditCrossLinkId(null);
        setDrawerOpen(false);
      }
      setMarquee(null);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  // Drag root nodes freely in 2D, or drag non-root nodes to reorder/flip sides/reparent
  const handleDragNodeStart = useCallback(
    (nodeId: string, e: ReactMouseEvent) => {
      if (e.button !== 0 || crossLinkSourceId) return;
      const node = docRef.current.nodes[nodeId];
      const layoutInfo = layoutsRef.current[nodeId];
      if (!node || !layoutInfo) return;

      const startClientX = e.clientX;
      const startClientY = e.clientY;

      if (node.parentId === null) {
        const origCenterX = layoutInfo.x + layoutInfo.width / 2;
        const origCenterY = layoutInfo.y + layoutInfo.height / 2;
        let moved = false;

        const onMove = (ev: MouseEvent) => {
          const scale = viewportStateRef.current.scale;
          const dx = (ev.clientX - startClientX) / scale;
          const dy = (ev.clientY - startClientY) / scale;
          if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
          if (!moved) return;

          setDoc((prev) => {
            const next = cloneDocument(prev);
            if (next.nodes[nodeId]) {
              next.nodes[nodeId].position = {
                x: Math.round(origCenterX + dx),
                y: Math.round(origCenterY + dy),
              };
            }
            return next;
          });
        };

        const onUp = () => {
          window.removeEventListener("mousemove", onMove);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
        return;
      }

      let moved = false;
      let cancelled = false;
      let latestHint: DragDropHint | null = null;

      const cleanup = () => {
        setDragState(null);
        setDragDropHint(null);
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("keydown", onKeyDown, true);
      };

      const onKeyDown = (kev: KeyboardEvent) => {
        if (kev.key === "Escape") {
          kev.preventDefault();
          kev.stopPropagation();
          cancelled = true;
          cleanup();
          announce("Node move cancelled");
        }
      };

      const onMove = (ev: MouseEvent) => {
        if (cancelled) return;
        const vp = viewportStateRef.current;
        const dx = (ev.clientX - startClientX) / vp.scale;
        const dy = (ev.clientY - startClientY) / vp.scale;
        if (!moved && Math.hypot(dx, dy) > 6) {
          moved = true;
        }
        if (!moved) return;

        setDragState({ nodeId, dx, dy });

        const rect = viewportRef.current?.getBoundingClientRect();
        if (!rect) return;
        const worldX = (ev.clientX - rect.left - vp.x) / vp.scale;
        const worldY = (ev.clientY - rect.top - vp.y) / vp.scale;
        const hint = computeDragDropHint(
          nodeId,
          worldX,
          worldY,
          docRef.current,
          layoutsRef.current
        );
        latestHint = hint;
        setDragDropHint(hint);
      };

      const onUp = () => {
        const hintToApply = moved && !cancelled ? latestHint : null;
        cleanup();
        if (hintToApply) {
          const curDoc = docRef.current;
          const nextDoc = repositionNode(
            curDoc,
            hintToApply.draggedId,
            hintToApply.targetId,
            hintToApply.placement,
            hintToApply.side
          );
          if (nextDoc !== curDoc) {
            commitDoc(nextDoc);
            announce(hintToApply.indicator.label || "Repositioned node");
          }
        }
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("keydown", onKeyDown, true);
    },
    [crossLinkSourceId, commitDoc, announce]
  );

  const searchMatches = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return Object.values(doc.nodes).filter(
      (n) =>
        n.text.toLowerCase().includes(q) || (n.notes && n.notes.toLowerCase().includes(q))
    );
  }, [doc.nodes, searchQuery]);

  const primaryNode = hasSelection ? doc.nodes[primarySelectedId] || null : null;

  const updateCrossLink = useCallback(
    (id: string, patch: Partial<CrossLink>) => {
      const next = cloneDocument(doc);
      const target = next.crossLinks.find((xl) => xl.id === id);
      if (!target) return;
      const normalizedPatch = { ...patch };
      if (typeof normalizedPatch.label === "string") {
        const clamped = clampCrossLinkLabel(normalizedPatch.label).trim();
        normalizedPatch.label = clamped || undefined;
      }
      Object.assign(target, normalizedPatch);
      next.updatedAt = new Date().toISOString();
      commitDoc(next);
    },
    [doc, commitDoc]
  );

  const deleteCrossLink = useCallback(
    (id: string) => {
      const next = cloneDocument(doc);
      const beforeLen = next.crossLinks.length;
      next.crossLinks = next.crossLinks.filter((xl) => xl.id !== id);
      if (next.crossLinks.length !== beforeLen) {
        next.updatedAt = new Date().toISOString();
        commitDoc(next);
        setSelectedCrossLinkId(null);
        setAutoEditCrossLinkId(null);
        announce("Deleted cross-link");
      }
    },
    [doc, commitDoc, announce]
  );

  useEffect(() => {
    if (!selectedCrossLinkId || selectedIds.length > 0 || editingId || anyDialogOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement as HTMLElement | null)?.tagName;
      if (activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT") return;
      if (e.key === "Backspace" || e.key === "Delete") {
        e.preventDefault();
        deleteCrossLink(selectedCrossLinkId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedCrossLinkId, selectedIds.length, editingId, anyDialogOpen, deleteCrossLink]);

  const activeCrossLinkData = useMemo(() => {
    if (!selectedCrossLinkId || selectedIds.length > 0) return null;
    const xl = doc.crossLinks.find((item) => item.id === selectedCrossLinkId);
    if (!xl) return null;
    const fromL = layouts[xl.fromId];
    const toL = layouts[xl.toId];
    if (!fromL || !toL) return null;
    const { labelX, labelY } = buildCrossLinkPath(fromL, toL, {
      layouts,
      label: xl.label,
      layer: xl.layer || "above",
    });
    return { crossLink: xl, anchorPoint: { x: labelX, y: labelY } };
  }, [selectedCrossLinkId, selectedIds.length, doc.crossLinks, layouts]);

  const renderCrossLinkSvgLayer = (layerFilter: "behind" | "above") => {
    const filtered = doc.crossLinks.filter((xl) => (xl.layer || "above") === layerFilter);
    const elevatedBehindLabels =
      layerFilter === "above"
        ? doc.crossLinks.filter(
            (xl) => (xl.layer || "above") === "behind" && Boolean(xl.label?.trim())
          )
        : [];

    const makeSelectHandlers = (xlId: string) => ({
      onMouseDown: (e: ReactMouseEvent) => {
        if (e.button !== 0 || editingId || crossLinkSourceId) return;
        e.stopPropagation();
        setStylePopoverOpen(false);
        setStickerPopoverOpen(false);
        setSelectedIds([]);
        setSelectedCrossLinkId(xlId);
      },
      onDoubleClick: (e: ReactMouseEvent) => {
        if (editingId || crossLinkSourceId) return;
        e.stopPropagation();
        setStylePopoverOpen(false);
        setStickerPopoverOpen(false);
        setSelectedIds([]);
        setSelectedCrossLinkId(xlId);
        setAutoEditCrossLinkId(xlId);
      },
    });

    const renderLabelText = (
      xl: CrossLink,
      labelX: number,
      labelY: number,
      color: string,
      handlers: ReturnType<typeof makeSelectHandlers>
    ) => {
      const lines = xl.label ? wrapCrossLinkLabelLines(xl.label, 42) : [];
      if (lines.length === 0) return null;
      const lineHeight = 15;
      const startY = labelY - ((lines.length - 1) * lineHeight) / 2 + 4;
      return (
        <text
          x={labelX}
          y={startY}
          textAnchor="middle"
          fill={color}
          fontSize="12"
          fontWeight="700"
          className="mf-crosslink-label mf-crosslink-label-hit"
          onMouseDown={handlers.onMouseDown}
          onDoubleClick={handlers.onDoubleClick}
        >
          {lines.map((line, idx) => (
            <tspan key={idx} x={labelX} dy={idx === 0 ? 0 : lineHeight}>
              {line}
            </tspan>
          ))}
        </text>
      );
    };

    const renderCrossLinkMarker = (id: string, headType: CrossLinkHeadType, color: string) => {
      if (headType === "none") return null;
      if (headType === "circle-filled") {
        return (
          <marker
            key={id}
            id={id}
            viewBox="0 0 10 10"
            refX="8.2"
            refY="5"
            markerWidth="6.2"
            markerHeight="6.2"
            orient="auto-start-reverse"
          >
            <circle cx="5" cy="5" r="3.6" fill={color} />
          </marker>
        );
      }
      if (headType === "circle-outline") {
        return (
          <marker
            key={id}
            id={id}
            viewBox="0 0 10 10"
            refX="8.2"
            refY="5"
            markerWidth="6.5"
            markerHeight="6.5"
            orient="auto-start-reverse"
          >
            <circle
              cx="5"
              cy="5"
              r="3.3"
              fill="var(--bg-surface)"
              stroke={color}
              strokeWidth="1.8"
            />
          </marker>
        );
      }
      return (
        <marker
          key={id}
          id={id}
          viewBox="0 0 10 10"
          refX="9"
          refY="5"
          markerWidth="6.5"
          markerHeight="6.5"
          orient="auto-start-reverse"
        >
          <path d="M 0 1 L 10 5 L 0 9 z" fill={color} />
        </marker>
      );
    };

    return (
      <>
        <defs>
          {layerFilter === "above" && (
            <marker
              id="mf-xl-preview-arrow"
              viewBox="0 0 10 10"
              refX="8"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M 0 1 L 10 5 L 0 9 z" fill="#f59e0b" />
            </marker>
          )}
          {filtered.flatMap((xl) => {
            const color = xl.color || "#f59e0b";
            const startHead = xl.startHead || "none";
            const endHead = xl.endHead || "arrow";
            return [
              renderCrossLinkMarker(`mf-xl-start-${xl.id}`, startHead, color),
              renderCrossLinkMarker(`mf-xl-end-${xl.id}`, endHead, color),
            ];
          })}
        </defs>
        {filtered.map((xl) => {
          const fromL = layouts[xl.fromId];
          const toL = layouts[xl.toId];
          if (!fromL || !toL) return null;
          const layer = xl.layer || "above";
          const { path, labelX, labelY, forceLabelAbove } = buildCrossLinkPath(fromL, toL, {
            layouts,
            label: xl.label,
            layer,
          });
          const color = xl.color || "#f59e0b";
          const isSelected = selectedCrossLinkId === xl.id && selectedIds.length === 0;
          const startHead = xl.startHead || "none";
          const endHead = xl.endHead || "arrow";
          const dashArray =
            xl.strokeStyle === "solid"
              ? undefined
              : xl.strokeStyle === "dotted"
              ? "2 6"
              : "6 5";
          const handlers = makeSelectHandlers(xl.id);

          return (
            <g key={xl.id}>
              {isSelected && (
                <path
                  d={path}
                  fill="none"
                  stroke={color}
                  strokeWidth={7}
                  opacity={0.24}
                  strokeLinecap="round"
                />
              )}
              <path
                d={path}
                fill="none"
                stroke="transparent"
                strokeWidth={16}
                className="mf-crosslink-hit"
                onMouseDown={handlers.onMouseDown}
                onDoubleClick={handlers.onDoubleClick}
              />
              <path
                d={path}
                fill="none"
                stroke={color}
                strokeWidth={isSelected ? 2.8 : 2}
                strokeDasharray={dashArray}
                strokeLinecap="round"
                markerStart={startHead !== "none" ? `url(#mf-xl-start-${xl.id})` : undefined}
                markerEnd={endHead !== "none" ? `url(#mf-xl-end-${xl.id})` : undefined}
              />
              {!forceLabelAbove && renderLabelText(xl, labelX, labelY, color, handlers)}
            </g>
          );
        })}
        {elevatedBehindLabels.map((xl) => {
          const fromL = layouts[xl.fromId];
          const toL = layouts[xl.toId];
          if (!fromL || !toL) return null;
          const { labelX, labelY, forceLabelAbove } = buildCrossLinkPath(fromL, toL, {
            layouts,
            label: xl.label,
            layer: "behind",
          });
          if (!forceLabelAbove) return null;
          const color = xl.color || "#f59e0b";
          const handlers = makeSelectHandlers(xl.id);
          return <g key={`elevated-lbl-${xl.id}`}>{renderLabelText(xl, labelX, labelY, color, handlers)}</g>;
        })}
        {layerFilter === "above" &&
          crossLinkSourceId &&
          layouts[crossLinkSourceId] &&
          crossLinkPointer &&
          (() => {
            const src = layouts[crossLinkSourceId];
            const startEdge = getNodeEdgeMidpoint(src, crossLinkPointer.x, crossLinkPointer.y);
            const sx = startEdge.x;
            const sy = startEdge.y;
            const tx = crossLinkPointer.x;
            const ty = crossLinkPointer.y;
            const dx = tx - sx;
            const dy = ty - sy;
            const cx = (sx + tx) / 2 - dy * 0.14;
            const cy = (sy + ty) / 2 + dx * 0.14 - 16;
            return (
              <path
                d={`M ${sx} ${sy} Q ${cx} ${cy} ${tx} ${ty}`}
                fill="none"
                stroke="#f59e0b"
                strokeWidth={2.4}
                strokeDasharray="6 5"
                strokeLinecap="round"
                markerEnd="url(#mf-xl-preview-arrow)"
                style={{ pointerEvents: "none" }}
              />
            );
          })()}
      </>
    );
  };

  return (
    <div className="mf-app">
      {saveState === "error" && saveError && !saveErrorDismissed && (
        <div className="mf-save-error-banner" role="alert">
          <div className="mf-save-error-msg">
            <AlertTriangle size={16} aria-hidden="true" />
            <span>
              <strong>Saving failed:</strong> {saveError}
            </span>
          </div>
          <div className="mf-save-error-actions">
            <button
              type="button"
              className="mf-chip-btn mf-save-retry-btn"
              onClick={() => void performSave(doc, true)}
            >
              Retry Now
            </button>
            <button
              type="button"
              className="mf-chip-btn mf-save-dismiss-btn"
              onClick={() => setSaveErrorDismissed(true)}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <TopToolbar
        maps={maps}
        activeMapId={doc.id}
        canUndo={past.length > 0}
        canRedo={future.length > 0}
        tool={tool}
        layout={doc.layout}
        theme={doc.theme}
        colorMode={doc.colorMode || "colorful"}
        connectorStyle={doc.connectorStyle}
        horizontalGap={doc.horizontalGap ?? DEFAULT_HORIZONTAL_GAP}
        backgroundPattern={doc.backgroundPattern || "dots"}
        isDark={isDark}
        saveState={saveState}
        syncStatus={syncStatus}
        lastSavedTime={lastSavedTime}
        saveError={saveError}
        autoSaveIntervalSec={autoSaveIntervalSec}
        onSelectMap={async (id) => {
          const loaded = await loadMapDual(id);
          if (loaded) {
            setDoc(loaded);
            setPast([]);
            setFuture([]);
            setSelectedIds([loaded.rootIds[0]]);
            setSelectedCrossLinkId(null);
            setEditingId(null);
            announce(`Loaded "${loaded.title}"`);
          }
        }}
        onCreateNewMap={async () => {
          const title = `Mind Map ${maps.length + 1}`;
          const fresh = createBlankMap(title);
          await performSave(fresh, false);
          setDoc(fresh);
          setPast([]);
          setFuture([]);
          setSelectedIds([fresh.rootIds[0]]);
          setSelectedCrossLinkId(null);
          setEditingId(fresh.rootIds[0]);
          await refreshMapList(fresh);
          announce(`Created "${title}"`);
        }}
        onDeleteCurrentMap={async () => {
          if (maps.length <= 1) {
            const fresh = createInitialMap();
            await deleteMapDual(doc.id);
            await performSave(fresh, false);
            setDoc(fresh);
            setSelectedIds([fresh.rootIds[0]]);
            setSelectedCrossLinkId(null);
            await refreshMapList(fresh);
            announce("Reset workspace to starter map");
            return;
          }
          await deleteMapDual(doc.id);
          const remaining = maps.filter((m) => m.id !== doc.id);
          const next = (remaining[0] && (await loadMapDual(remaining[0].id))) || createInitialMap();
          setDoc(next);
          setSelectedIds([next.rootIds[0]]);
          setSelectedCrossLinkId(null);
          await refreshMapList(next);
          announce("Deleted mind map");
        }}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onSetTool={setTool}
        onAddDetachedRootNode={handleAddDetachedRootNode}
        onChangeLayout={(layout) => commitDoc({ ...doc, layout, updatedAt: new Date().toISOString() })}
        onChangeTheme={(theme) => commitDoc({ ...doc, theme, updatedAt: new Date().toISOString() })}
        onChangeColorMode={(colorMode) => {
          commitDoc({ ...doc, colorMode, updatedAt: new Date().toISOString() });
          announce(`Color mode: ${colorMode}`);
        }}
        onChangeConnector={(connectorStyle) =>
          commitDoc({ ...doc, connectorStyle, updatedAt: new Date().toISOString() })
        }
        onChangeHorizontalGap={(horizontalGap) =>
          commitDoc({ ...doc, horizontalGap, updatedAt: new Date().toISOString() })
        }
        onChangeBackgroundPattern={(backgroundPattern) => {
          commitDoc({ ...doc, backgroundPattern, updatedAt: new Date().toISOString() });
          announce(`Background changed to ${backgroundPattern}`);
        }}
        onChangeAutoSaveInterval={(sec) => {
          setAutoSaveIntervalSec(sec);
          announce(`Auto-save interval set to ${sec}s`);
        }}
        onToggleDarkLight={() => {
          const target = toggleDarkLight();
          announce(`Switched to ${target} theme`);
        }}
        onOpenLlmChat={() => setLlmChatOpen(true)}
        onOpenSearch={() => {
          setSearchOpen(true);
          requestAnimationFrame(() => searchInputRef.current?.focus());
        }}
        onSaveNow={() => {
          void performSave(doc, true);
        }}
        onExportAction={async (fmt) => {
          if (fmt === "json") exportMapAsJson(doc);
          else if (fmt === "md") exportMapAsMarkdown(doc);
          else if (fmt === "mup") exportMapAsMindMup(doc);
          else if (fmt === "mm") exportMapAsFreeMind(doc);
          else if (fmt === "svg") exportMapAsSvg(doc, layouts, isDark);
          else if (fmt === "png") await exportMapAsPng(doc, layouts, isDark);
          announce(`Exported map as .${fmt}`);
        }}
        onImportFile={() => importInputRef.current?.click()}
        onOpenShortcuts={() => setShortcutsOpen(true)}
      />

      <input
        ref={importInputRef}
        type="file"
        accept=".json,.mup,.md,.markdown,.txt"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          try {
            const raw = await file.text();
            const imported = importMapFromFileContent(file.name, raw);
            await performSave(imported, false);
            setDoc(imported);
            setPast([]);
            setFuture([]);
            setSelectedIds([imported.rootIds[0]]);
            await refreshMapList(imported);
            announce(`Imported "${imported.title}"`);
          } catch (err) {
            announce(err instanceof Error ? err.message : "Failed to import file");
          }
          e.target.value = "";
        }}
      />

      <div className="mf-workspace">
        <div
          ref={viewportRef}
          className={[
            "mf-canvas-viewport",
            `bg-${doc.backgroundPattern || "dots"}`,
            tool === "hand" ? "tool-hand" : "",
            isPanning ? "is-panning" : "",
            crossLinkSourceId ? "tool-crosslink" : "",
          ]
            .filter(Boolean)
            .join(" ")}
          onMouseDown={handleCanvasMouseDown}
          onMouseMove={(e) => {
            if (!crossLinkSourceId) return;
            const rect = viewportRef.current?.getBoundingClientRect();
            if (!rect) return;
            setCrossLinkPointer({
              x: (e.clientX - rect.left - viewport.x) / viewport.scale,
              y: (e.clientY - rect.top - viewport.y) / viewport.scale,
            });
          }}
        >
          <div
            className="mf-canvas-world"
            style={{
              transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
            }}
          >
            {/* Back SVG layer: tree branch connectors + cross-links layered behind nodes */}
            <svg className="mf-svg-layer mf-svg-branches">
              {Object.values(doc.nodes).map((node) => {
                const pLayout = layouts[node.id];
                if (!pLayout || node.collapsed) return null;
                return node.childrenIds.map((cid) => {
                  const cLayout = layouts[cid];
                  if (!cLayout) return null;
                  const path = buildConnectorPath(pLayout, cLayout, doc.connectorStyle, doc.layout);
                  return (
                    <path
                      key={`${node.id}-${cid}`}
                      d={path}
                      fill="none"
                      stroke={cLayout.branchColor}
                      strokeWidth={Math.max(1.8, 3.2 - cLayout.depth * 0.4)}
                      strokeLinecap="round"
                    />
                  );
                });
              })}
              {renderCrossLinkSvgLayer("behind")}
            </svg>

            {Object.values(layouts).map((info: LayoutNodeInfo) => {
              const node = doc.nodes[info.id];
              if (!node) return null;
              return (
                <MindMapNodeCard
                  key={node.id}
                  node={node}
                  layout={info}
                  colorMode={doc.colorMode || "colorful"}
                  zoomScale={viewport.scale}
                  isSelected={selectedIds.includes(node.id)}
                  isEditing={editingId === node.id}
                  isCrossLinkSource={crossLinkSourceId === node.id}
                  isDragging={dragState?.nodeId === node.id}
                  dragOffset={
                    dragState?.nodeId === node.id
                      ? { dx: dragState.dx, dy: dragState.dy }
                      : null
                  }
                  onSelect={handleSelectNode}
                  onStartEdit={setEditingId}
                  onCommitEdit={(id, nextText) => {
                    setEditingId(null);
                    const cur = doc.nodes[id];
                    if (cur && cur.text !== nextText) {
                      const nextDoc = updateNodesStyle(doc, [id], (n) => {
                        n.text = nextText;
                      });
                      if (doc.rootIds[0] === id) {
                        nextDoc.title = nextText.split("\n")[0].replace(/[*#`]/g, "").trim() || nextDoc.title;
                      }
                      commitDoc(nextDoc);
                    }
                  }}
                  onCancelEdit={() => setEditingId(null)}
                  onUpdateNodeTextDirect={(id, nextText) => {
                    commitDoc(
                      updateNodesStyle(doc, [id], (n) => {
                        n.text = nextText;
                      })
                    );
                  }}
                  onToggleCollapse={(id) => commitDoc(toggleCollapseNode(doc, id), false)}
                  onAddChildQuick={(parentId) => {
                    const { doc: next, newId } = addChildNode(doc, parentId);
                    commitDoc(next);
                    setSelectedIds([newId]);
                    setEditingId(newId);
                  }}
                  onResizeNode={(nodeId, dims) => {
                    commitDoc(resizeNodesBatch(doc, [nodeId], dims), false);
                  }}
                  onOpenImageLightbox={setLightboxImage}
                  onResizeImage={(nodeId, imgId, width) => {
                    commitDoc(
                      updateNodesStyle(doc, [nodeId], (n) => {
                        n.images = (n.images || []).map((img) =>
                          img.id === imgId ? { ...img, width } : img
                        );
                      }),
                      false
                    );
                  }}
                  onUpdateImageProps={(nodeId, imgId, patch) => {
                    commitDoc(
                      updateNodesStyle(doc, [nodeId], (n) => {
                        n.images = (n.images || []).map((img) =>
                          img.id === imgId ? { ...img, ...patch } : img
                        );
                      })
                    );
                  }}
                  onRemoveImage={(nodeId, imgId) => {
                    commitDoc(
                      updateNodesStyle(doc, [nodeId], (n) => {
                        n.images = (n.images || []).filter((img) => img.id !== imgId);
                      })
                    );
                    announce("Removed photo from node");
                  }}
                  onDropFilesOnNode={attachFilesToNode}
                  onPasteImageInEditor={async (nodeId, file) => {
                    await attachFilesToNode(nodeId, [file]);
                  }}
                  onOpenDrawer={(id) => {
                    setSelectedIds([id]);
                    setDrawerOpen(true);
                  }}
                  onSizeChange={handleSizeChange}
                  onAnnounce={announce}
                  onDragNodeStart={handleDragNodeStart}
                />
              );
            })}

            {dragDropHint && (
              <div
                className={
                  dragDropHint.indicator.kind === "line"
                    ? "mf-drop-indicator-line"
                    : "mf-drop-indicator-box"
                }
                style={{
                  transform: `translate(${dragDropHint.indicator.x}px, ${dragDropHint.indicator.y}px)`,
                  width: `${dragDropHint.indicator.width}px`,
                  height: `${dragDropHint.indicator.height}px`,
                }}
              >
                {dragDropHint.indicator.label && (
                  <span className="mf-drop-indicator-badge">
                    {dragDropHint.indicator.label}
                  </span>
                )}
              </div>
            )}

            {/* Front SVG layer: cross-link lines layered above all node cards */}
            <svg className="mf-svg-layer mf-svg-crosslinks">
              {renderCrossLinkSvgLayer("above")}
            </svg>
          </div>

          {crossLinkSourceId && doc.nodes[crossLinkSourceId] && (
            <div
              className="mf-crosslink-mode-banner"
              role="status"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <span>
                Click any target node to connect from{" "}
                <strong>“{getNodeShortLabel(doc.nodes[crossLinkSourceId])}”</strong>
              </span>
              <button
                type="button"
                className="mf-chip-btn"
                onClick={() => {
                  setCrossLinkSourceId(null);
                  announce("Cross-link canceled");
                }}
              >
                Cancel (Esc)
              </button>
            </div>
          )}

          {!editingId && !anyDialogOpen && activeCrossLinkData && (
            <FloatingCrossLinkToolbar
              crossLink={activeCrossLinkData.crossLink}
              anchorPoint={activeCrossLinkData.anchorPoint}
              viewport={viewport}
              containerRect={containerRect}
              initialEditOpen={autoEditCrossLinkId === activeCrossLinkData.crossLink.id}
              onClearInitialEdit={() => setAutoEditCrossLinkId(null)}
              onUpdateCrossLink={(patch) =>
                updateCrossLink(activeCrossLinkData.crossLink.id, patch)
              }
              onDeleteCrossLink={() => deleteCrossLink(activeCrossLinkData.crossLink.id)}
              onDeselect={() => {
                setSelectedCrossLinkId(null);
                setAutoEditCrossLinkId(null);
              }}
            />
          )}

          {!editingId && !anyDialogOpen && !dragState && selectedIds.length > 0 && (
            <FloatingNodeToolbar
              selectedNodes={selectedIds
                .map((id) => doc.nodes[id])
                .filter((n): n is MindMapNode => Boolean(n))}
              totalVisibleCount={Object.keys(layouts).length}
              anchorLayout={layouts[primarySelectedId]}
              viewport={viewport}
              containerRect={containerRect}
              onClearMultiSelect={() => setSelectedIds([primarySelectedId])}
              onAddChild={handleAddChildNode}
              onAddSibling={() => handleAddSiblingNode("below")}
              onInsertParent={handleInsertParentNode}
              moveCapabilities={primaryMoveCapabilities}
              onMoveNode={handleMoveNode}
              onSetColors={(colors) => commitDoc(setNodesColor(doc, selectedIds, colors))}
              onResetColors={() => {
                commitDoc(resetNodesColor(doc, selectedIds));
                announce("Reset selected node colors to theme default");
              }}
              onSetFontSize={(size) => {
                if (size === "reset") {
                  commitDoc(adjustFontSize(doc, selectedIds, "reset"));
                } else {
                  commitDoc(
                    updateNodesStyle(doc, selectedIds, (n) => {
                      n.style = { ...(n.style || {}), fontSize: size };
                    })
                  );
                }
              }}
              onAdjustFontSize={(mode) => commitDoc(adjustFontSize(doc, selectedIds, mode))}
              onSetShape={(sh) => commitDoc(setNodesShape(doc, selectedIds, sh))}
              onResizeNodes={(dims) => {
                commitDoc(resizeNodesBatch(doc, selectedIds, dims));
                announce(dims === "auto" ? "Reset node size to auto" : "Resized selected node(s)");
              }}
              onSetAlign={(al) => commitDoc(setNodesAlign(doc, selectedIds, al))}
              onToggleFormatting={(wrapper) =>
                commitDoc(toggleBatchFormatting(doc, selectedIds, wrapper))
              }
              onToggleAllTasks={(checked) => {
                commitDoc(toggleAllTasksInNodes(doc, selectedIds, checked));
                announce(checked ? "Checked all tasks in selection" : "Unchecked all tasks in selection");
              }}
              onAddTaskItem={() => {
                commitDoc(
                  updateNodesStyle(doc, selectedIds, (n) => {
                    n.text = `${n.text.trimEnd()}\n- [ ] New task`;
                  })
                );
              }}
              onOpenImagePicker={() => setImageModalOpen(true)}
              onUpdatePhotoProps={(patch) =>
                commitDoc(updateBatchPhotoProps(doc, selectedIds, patch))
              }
              onOpenPhotoLightbox={setLightboxImage}
              onRemovePhotos={() => {
                commitDoc(removeAllPhotosFromNodes(doc, selectedIds));
                announce("Removed photo(s) from selected node(s)");
              }}
              onOpenDrawer={() => setDrawerOpen(true)}
              onToggleStickers={() => {
                setStylePopoverOpen(false);
                setStickerPopoverOpen((o) => !o);
              }}
              isCrossLinkMode={Boolean(crossLinkSourceId)}
              onToggleCrossLink={handleToggleCrossLinkMode}
              onBatchCollapse={(collapsed) => {
                commitDoc(setBatchCollapse(doc, selectedIds, collapsed), false);
                announce(collapsed ? "Collapsed selected branches" : "Expanded selected branches");
              }}
              onDuplicateNodes={() => {
                const { doc: next, newIds } = duplicateNodes(doc, selectedIds);
                commitDoc(next);
                if (newIds.length > 0) setSelectedIds(newIds);
                announce(`Duplicated ${selectedIds.length} node(s)`);
              }}
              onDeleteNodes={() => {
                const { doc: next, nextSelectedId } = deleteNodes(doc, selectedIds);
                commitDoc(next);
                if (nextSelectedId) setSelectedIds([nextSelectedId]);
                announce("Deleted selected node(s)");
              }}
            />
          )}

          {marquee && (
            <div
              className="mf-marquee"
              style={{
                left: marquee.x,
                top: marquee.y,
                width: marquee.w,
                height: marquee.h,
              }}
            />
          )}
        </div>

        {drawerOpen && primaryNode && (
          <NodeSideDrawer
            node={primaryNode}
            onClose={() => setDrawerOpen(false)}
            onUpdateText={(id, text) =>
              commitDoc(
                updateNodesStyle(doc, [id], (n) => {
                  n.text = text;
                }),
                false
              )
            }
            onUpdateNotes={(id, notes) =>
              commitDoc(
                updateNodesStyle(doc, [id], (n) => {
                  n.notes = notes;
                }),
                false
              )
            }
            onRemoveImage={(nodeId, imgId) =>
              commitDoc(
                updateNodesStyle(doc, [nodeId], (n) => {
                  n.images = (n.images || []).filter((i) => i.id !== imgId);
                })
              )
            }
            onUploadAttachment={(nodeId, files) => attachFilesToNode(nodeId, files)}
            onRemoveAttachment={(nodeId, attId) =>
              commitDoc(
                updateNodesStyle(doc, [nodeId], (n) => {
                  n.attachments = (n.attachments || []).filter((a) => a.id !== attId);
                })
              )
            }
            onOpenImagePicker={() => setImageModalOpen(true)}
          />
        )}

        <LlmAssistantDrawer
          open={llmChatOpen}
          doc={doc}
          selectedIds={selectedIds}
          primarySelectedId={primarySelectedId}
          onToggleOpen={() => setLlmChatOpen((o) => !o)}
          onClose={() => setLlmChatOpen(false)}
          onApplyDocChange={(nextDoc, focusNodeId) => {
            commitDoc(nextDoc);
            if (focusNodeId && nextDoc.nodes[focusNodeId]) {
              setSelectedIds([focusNodeId]);
            }
          }}
          onFocusNode={(nodeId) => {
            if (!doc.nodes[nodeId]) return;
            setSelectedIds([nodeId]);
            const panelW = llmChatOpen ? Math.min(420, containerRect.width * 0.94) : 0;
            centerOnNode(nodeId, panelW);
          }}
          onOpenClassicMarkdownPaste={handleTriggerSubtreeModal}
          onAnnounce={announce}
        />
      </div>

      {/* Floating Style Popover (Shift+Space) */}
      {stylePopoverOpen && (
        <div className="mf-floating-popover" role="region" aria-label="Node color and shape">
          <div style={{ fontWeight: 650, fontSize: "0.86rem" }}>Node Style (Shift + Space)</div>
          <div className="mf-swatch-grid">
            {NODE_COLOR_SWATCHES.map((swatch) => (
              <button
                key={swatch}
                type="button"
                className="mf-swatch"
                aria-label={`Set color ${swatch}`}
                style={{ background: swatch }}
                onClick={() =>
                  commitDoc(
                    setNodesColor(doc, selectedIds, {
                      color: swatch,
                      borderColor: swatch,
                      textColor: getContrastTextColor(swatch),
                    })
                  )
                }
              />
            ))}
          </div>
          <div className="mf-color-inputs-row">
            <label>
              <span>Fill</span>
              <input
                type="color"
                value={primaryNode?.style?.color || layouts[primarySelectedId]?.branchColor || "#2563eb"}
                onChange={(e) =>
                  commitDoc(
                    setNodesColor(doc, selectedIds, {
                      color: e.target.value,
                      textColor: getContrastTextColor(e.target.value),
                    })
                  )
                }
              />
            </label>
            <label>
              <span>Border</span>
              <input
                type="color"
                value={primaryNode?.style?.borderColor || layouts[primarySelectedId]?.branchColor || "#2563eb"}
                onChange={(e) =>
                  commitDoc(setNodesColor(doc, selectedIds, { borderColor: e.target.value }))
                }
              />
            </label>
            <label>
              <span>Text</span>
              <input
                type="color"
                value={primaryNode?.style?.textColor || "#0f172a"}
                onChange={(e) =>
                  commitDoc(setNodesColor(doc, selectedIds, { textColor: e.target.value }))
                }
              />
            </label>
            <button
              type="button"
              className="mf-chip-btn"
              onClick={() => commitDoc(resetNodesColor(doc, selectedIds))}
            >
              Auto
            </button>
          </div>
          <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginTop: 6 }}>
            {(["rounded", "card", "underline", "cloud"] as NodeShape[]).map((sh) => (
              <button
                key={sh}
                type="button"
                className="mf-chip-btn"
                onClick={() => commitDoc(setNodesShape(doc, selectedIds, sh))}
              >
                {sh}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Floating Stickers Popover (Shift+S) */}
      {stickerPopoverOpen && (
        <div className="mf-floating-popover" role="region" aria-label="Node stickers">
          <div style={{ fontWeight: 650, fontSize: "0.86rem", marginBottom: 8 }}>
            Node Stickers (Shift + S)
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {STICKER_PRESETS.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="mf-btn"
                style={{ fontSize: "1.1rem" }}
                onClick={() =>
                  commitDoc(
                    updateNodesStyle(doc, selectedIds, (n) => {
                      const cur = n.stickers || [];
                      n.stickers = cur.includes(emoji)
                        ? cur.filter((s) => s !== emoji)
                        : [...cur, emoji];
                    })
                  )
                }
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Search Bar (Ctrl+F) */}
      {searchOpen && (
        <div className="mf-search-bar" role="search">
          <input
            ref={searchInputRef}
            type="search"
            placeholder="Search nodes, formulas, or code…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchOpen(false);
              } else if (e.key === "Enter" && searchMatches.length > 0) {
                const targetId = searchMatches[0].id;
                setSelectedIds([targetId]);
                centerOnNode(targetId);
              }
            }}
          />
          <span style={{ fontSize: "0.78rem", color: "var(--text-muted)" }}>
            {searchMatches.length} match(es)
          </span>
          {searchMatches.slice(0, 3).map((m) => (
            <button
              key={m.id}
              type="button"
              className="mf-chip-btn"
              onClick={() => {
                setSelectedIds([m.id]);
                centerOnNode(m.id);
              }}
            >
              {m.text.split("\n")[0].slice(0, 18)}
            </button>
          ))}
          <button type="button" className="mf-chip-btn" onClick={() => setSearchOpen(false)}>
            Close
          </button>
        </div>
      )}

      {/* Bottom Zoom & Outline Level HUD */}
      <div className="mf-bottom-hud">
        <button
          type="button"
          className="mf-btn"
          aria-label="Zoom out"
          onClick={() => setViewport((v) => ({ ...v, scale: Math.max(0.2, v.scale - 0.15) }))}
        >
          <ZoomOut size={15} aria-hidden="true" />
        </button>
        <span>{Math.round(viewport.scale * 100)}%</span>
        <button
          type="button"
          className="mf-btn"
          aria-label="Zoom in"
          onClick={() => setViewport((v) => ({ ...v, scale: Math.min(2.6, v.scale + 0.15) }))}
        >
          <ZoomIn size={15} aria-hidden="true" />
        </button>
        <button type="button" className="mf-btn" title="Recenter (Ctrl+0)" onClick={recenterView}>
          <Crosshair size={14} aria-hidden="true" />
        </button>
        <button type="button" className="mf-btn" title="Zoom to fit (Ctrl+1)" onClick={zoomToFit}>
          <Maximize2 size={14} aria-hidden="true" />
        </button>
        <div className="mf-level-menu">
          <button
            type="button"
            className="mf-btn"
            aria-haspopup="menu"
            title="Outline level (Alt+1..9)"
            onClick={() => collapseMapToLevel(1)}
          >
            <Minimize2 size={14} aria-hidden="true" /> Expand Level
          </button>
          <div className="mf-level-menu-list" role="menu" aria-label="Collapse to level">
            {levelOptions.map((lvl) => (
              <button
                key={lvl}
                type="button"
                role="menuitem"
                className="mf-level-menu-item"
                onClick={() => collapseMapToLevel(lvl)}
              >
                Level {lvl}
                {lvl <= 9 ? <kbd>Alt+{lvl}</kbd> : null}
              </button>
            ))}
            <button
              type="button"
              role="menuitem"
              className="mf-level-menu-item"
              onClick={expandAll}
            >
              Expand all <kbd>Alt+0</kbd>
            </button>
          </div>
        </div>
      </div>

      {/* Live region & Toast */}
      <p role="status" className="sr-only">
        {liveStatus}
      </p>

      {toast && (
        <div className="mf-toast">
          <span>{toast.msg}</span>
          {toast.actionLabel && toast.onAction && (
            <button
              type="button"
              className="mf-chip-btn"
              onClick={() => {
                toast.onAction?.();
                setToast(null);
              }}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}

      {/* Native Top-Layer <dialog> Modals */}
      <ShortcutsModal open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ImagePickerModal
        open={imageModalOpen}
        onClose={() => setImageModalOpen(false)}
        onUploadFiles={(files) => attachFilesToNode(primarySelectedId, files)}
        onAddImageUrl={(url, caption) => {
          commitDoc(
            updateNodesStyle(doc, [primarySelectedId], (n) => {
              n.images = [
                ...(n.images || []),
                { id: makeId("img"), url, name: caption || "image", width: 210, caption },
              ];
            })
          );
          announce("Added image URL to node");
        }}
      />
      <SubtreePasteModal
        open={subtreeModalOpen}
        onClose={() => setSubtreeModalOpen(false)}
        initialMarkdown={subtreePrefill}
        onConfirm={(md) => {
          const branches = parseMarkdownToSubtree(md);
          const { doc: nextDoc, firstAddedId } = insertSubtreeBranches(
            doc,
            primarySelectedId,
            branches
          );
          commitDoc(nextDoc);
          if (firstAddedId) setSelectedIds([firstAddedId]);
          announce(`Inserted ${branches.length} top-level LLM branch(es)`);
        }}
      />
      <ImageLightboxModal image={lightboxImage} onClose={() => setLightboxImage(null)} />
    </div>
  );
}

export default App;
