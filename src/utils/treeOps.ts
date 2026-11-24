import type {
  LayoutNodeInfo,
  MindMapDocument,
  MindMapNode,
  NodeAlign,
  NodeImage,
  NodeShape,
} from "../types/mindmap";
import {
  DEFAULT_HORIZONTAL_GAP,
  MAX_HORIZONTAL_GAP,
  MIN_HORIZONTAL_GAP,
} from "./layoutEngine";
import type { SubtreeBranch } from "./markdownToSubtree";

export function makeId(prefix = "n"): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}-${crypto.randomUUID().slice(0, 8)}`;
  }
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

export function cloneDocument(doc: MindMapDocument): MindMapDocument {
  return structuredClone(doc);
}

export function createInitialMap(): MindMapDocument {
  const now = new Date().toISOString();
  const rootId = "root-1";
  const b1 = "node-math";
  const b1a = "node-math-chatgpt";
  const b1b = "node-math-claude";
  const b2 = "node-code";
  const b2a = "node-code-ts";
  const b2b = "node-code-mermaid";
  const b3 = "node-shortcuts";
  const b3a = "node-shortcuts-create";
  const b3b = "node-shortcuts-select";
  const b4 = "node-media";
  const b4a = "node-media-check";

  const nodes: Record<string, MindMapNode> = {
    [rootId]: {
      id: rootId,
      parentId: null,
      childrenIds: [b1, b2, b3, b4],
      text: "🧠 **LazyMindmap Workspace**\nPress `Ctrl + /` for MindMup Shortcuts",
      stickers: ["🚀"],
      style: { shape: "rounded", fontSize: 16 },
    },
    [b1]: {
      id: b1,
      parentId: rootId,
      childrenIds: [b1a, b1b],
      side: "right",
      text: "Universal LLM Math\nInline: $E = mc^2$ and \\(\\nabla \\cdot \\mathbf{E} = \\frac{\\rho}{\\varepsilon_0}\\)",
      stickers: ["🧮"],
    },
    [b1a]: {
      id: b1a,
      parentId: b1,
      childrenIds: [],
      text: "ChatGPT & DeepSeek Blocks:\n\\[\n\\int_{-\\infty}^{\\infty} e^{-x^2}\\,dx = \\sqrt{\\pi}\n\\]",
    },
    [b1b]: {
      id: b1b,
      parentId: b1,
      childrenIds: [],
      text: "Claude Bare Matrix & Chemistry:\n\\begin{pmatrix} \\cos\\theta & -\\sin\\theta \\\\ \\sin\\theta & \\cos\\theta \\end{pmatrix}\n\n$\\ce{2H2 + O2 -> 2H2O}$",
    },
    [b2]: {
      id: b2,
      parentId: rootId,
      childrenIds: [b2a, b2b],
      side: "left",
      text: "Code, Diagrams & Tables\n| Shortcut | Action |\n|---|---|\n| `Tab` | Add Child |\n| `Enter` | Add Sibling |",
      stickers: ["💻"],
    },
    [b2a]: {
      id: b2a,
      parentId: b2,
      childrenIds: [],
      text: "Syntax Highlighting:\n```typescript\nexport const fib = (n: number): number =>\n  n <= 1 ? n : fib(n - 1) + fib(n - 2);\n```",
    },
    [b2b]: {
      id: b2b,
      parentId: b2,
      childrenIds: [],
      text: "Mermaid Diagram:\n```mermaid\nflowchart LR\n  LLM[Copy AI Answer] --> Paste[Ctrl+Shift+V]\n  Paste --> Tree[Rich Subtree]\n```",
    },
    [b3]: {
      id: b3,
      parentId: rootId,
      childrenIds: [b3a, b3b],
      side: "right",
      text: "MindMup Shortcuts\n`Space` Edit · `F` Fold · `Alt+1..9` Levels",
      stickers: ["⚡"],
    },
    [b3a]: {
      id: b3a,
      parentId: b3,
      childrenIds: [],
      text: "`Shift+Enter` Sibling Above\n`Shift+Tab` Insert Parent\n`D` Detach · `Ctrl+D` New Root",
    },
    [b3b]: {
      id: b3b,
      parentId: b3,
      childrenIds: [],
      text: "`{` Node + Subtree · `[` Subtree\n`=` All Siblings · `Alt+D` Dark Mode",
    },
    [b4]: {
      id: b4,
      parentId: rootId,
      childrenIds: [b4a],
      side: "left",
      text: "Photos, Notes & Checklists\nPress `I` for photos · `A` for notes drawer",
      stickers: ["📸"],
    },
    [b4a]: {
      id: b4a,
      parentId: b4,
      childrenIds: [],
      text: "Interactive Tasks (click directly!):\n- [x] Universal LLM math pipeline\n- [x] MindMup shortcut parity\n- [ ] Press `Space` to edit me",
    },
  };

  return {
    id: makeId("map"),
    title: "LazyMindmap Starter Map",
    rootIds: [rootId],
    nodes,
    crossLinks: [
      {
        id: "xl-1",
        fromId: b2b,
        toId: b1,
        label: "supports math",
      },
    ],
    layout: "mindmap",
    theme: "ocean",
    connectorStyle: "bezier",
    createdAt: now,
    updatedAt: now,
  };
}

export function createBlankMap(title = "Untitled Mind Map"): MindMapDocument {
  const now = new Date().toISOString();
  const rootId = makeId("root");
  return {
    id: makeId("map"),
    title,
    rootIds: [rootId],
    nodes: {
      [rootId]: {
        id: rootId,
        parentId: null,
        childrenIds: [],
        text: title,
        style: { shape: "rounded", fontSize: 16 },
      },
    },
    crossLinks: [],
    layout: "mindmap",
    theme: "ocean",
    connectorStyle: "bezier",
    createdAt: now,
    updatedAt: now,
  };
}

export function addChildNode(
  doc: MindMapDocument,
  parentId: string,
  text = "New Idea"
): { doc: MindMapDocument; newId: string } {
  const next = cloneDocument(doc);
  const parent = next.nodes[parentId];
  if (!parent) return { doc, newId: parentId };

  const newId = makeId("node");
  let side: "left" | "right" | undefined;
  if (parent.parentId === null && next.layout === "mindmap") {
    const rightCount = parent.childrenIds.filter((id) => next.nodes[id]?.side === "right").length;
    const leftCount = parent.childrenIds.filter((id) => next.nodes[id]?.side === "left").length;
    side = rightCount <= leftCount ? "right" : "left";
  } else if (parent.side) {
    side = parent.side;
  }

  next.nodes[newId] = {
    id: newId,
    parentId,
    childrenIds: [],
    text,
    side,
  };
  parent.collapsed = false;
  parent.childrenIds.push(newId);
  next.updatedAt = new Date().toISOString();
  return { doc: next, newId };
}

export function addSiblingNode(
  doc: MindMapDocument,
  targetId: string,
  position: "below" | "above" = "below",
  text = "New Sibling"
): { doc: MindMapDocument; newId: string } {
  const target = doc.nodes[targetId];
  if (!target) return { doc, newId: targetId };

  // In MindMup, pressing Enter on a root node adds a child node
  if (!target.parentId) {
    return addChildNode(doc, targetId, text);
  }

  const next = cloneDocument(doc);
  const parent = next.nodes[target.parentId];
  if (!parent) return { doc, newId: targetId };

  const newId = makeId("node");
  next.nodes[newId] = {
    id: newId,
    parentId: parent.id,
    childrenIds: [],
    text,
    side: target.side,
  };

  const idx = parent.childrenIds.indexOf(targetId);
  const insertAt = position === "above" ? Math.max(0, idx) : idx + 1;
  parent.childrenIds.splice(insertAt, 0, newId);
  next.updatedAt = new Date().toISOString();
  return { doc: next, newId };
}

export function insertParentNode(
  doc: MindMapDocument,
  targetId: string,
  text = "Parent Topic"
): { doc: MindMapDocument; newId: string } {
  const target = doc.nodes[targetId];
  if (!target) return { doc, newId: targetId };

  const next = cloneDocument(doc);
  const node = next.nodes[targetId];
  const newId = makeId("node");

  if (!node.parentId) {
    // Wrap root node with a new parent root
    const rootIdx = next.rootIds.indexOf(targetId);
    next.nodes[newId] = {
      id: newId,
      parentId: null,
      childrenIds: [targetId],
      text,
      position: node.position ? { ...node.position } : undefined,
      style: { shape: "rounded", fontSize: 16 },
    };
    node.parentId = newId;
    delete node.position;
    if (rootIdx >= 0) {
      next.rootIds[rootIdx] = newId;
    }
  } else {
    const oldParent = next.nodes[node.parentId];
    if (!oldParent) return { doc, newId: targetId };
    const idx = oldParent.childrenIds.indexOf(targetId);
    next.nodes[newId] = {
      id: newId,
      parentId: oldParent.id,
      childrenIds: [targetId],
      text,
      side: node.side,
    };
    node.parentId = newId;
    if (idx >= 0) {
      oldParent.childrenIds[idx] = newId;
    } else {
      oldParent.childrenIds.push(newId);
    }
  }

  next.updatedAt = new Date().toISOString();
  return { doc: next, newId };
}

export function addDetachedRootNode(
  doc: MindMapDocument,
  position?: { x: number; y: number },
  text = "Floating Topic"
): { doc: MindMapDocument; newId: string } {
  const next = cloneDocument(doc);
  const newId = makeId("root");
  next.nodes[newId] = {
    id: newId,
    parentId: null,
    childrenIds: [],
    text,
    position,
    style: { shape: "rounded", fontSize: 15 },
  };
  next.rootIds.push(newId);
  next.updatedAt = new Date().toISOString();
  return { doc: next, newId };
}

export function detachNodeToRoot(
  doc: MindMapDocument,
  targetId: string,
  position?: { x: number; y: number }
): MindMapDocument {
  const target = doc.nodes[targetId];
  if (!target || !target.parentId) return doc;

  const next = cloneDocument(doc);
  const node = next.nodes[targetId];
  const parent = next.nodes[node.parentId!];
  if (parent) {
    parent.childrenIds = parent.childrenIds.filter((id) => id !== targetId);
  }
  node.parentId = null;
  delete node.side;
  if (position) {
    node.position = position;
  }
  if (!next.rootIds.includes(targetId)) {
    next.rootIds.push(targetId);
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

export function detachNodesToRoots(
  doc: MindMapDocument,
  targetIds: string[],
  positions?: Record<string, { x: number; y: number }>
): { doc: MindMapDocument; detachedIds: string[] } {
  const uniqueNonRoots = Array.from(new Set(targetIds)).filter((id) => {
    const n = doc.nodes[id];
    return Boolean(n && n.parentId !== null);
  });
  if (uniqueNonRoots.length === 0) return { doc, detachedIds: [] };

  const selectedSet = new Set(uniqueNonRoots);
  // Only detach top-most selected non-root nodes so selected subtrees remain intact
  const topDetachable = uniqueNonRoots.filter((id) => {
    let cur = doc.nodes[id]?.parentId ?? null;
    while (cur) {
      if (selectedSet.has(cur)) return false;
      cur = doc.nodes[cur]?.parentId ?? null;
    }
    return true;
  });

  if (topDetachable.length === 0) return { doc, detachedIds: [] };

  let next = doc;
  for (const id of topDetachable) {
    next = detachNodeToRoot(next, id, positions?.[id]);
  }
  return { doc: next, detachedIds: topDetachable };
}

export interface DragDropHint {
  draggedId: string;
  targetId: string;
  placement: "before" | "after" | "inside" | "detach";
  side?: "left" | "right";
  detachPosition?: { x: number; y: number };
  indicator: {
    kind: "line" | "box" | "detach";
    x: number;
    y: number;
    width: number;
    height: number;
    label?: string;
  };
}

function rectEdgeDistance(
  ax: number,
  ay: number,
  aw: number,
  ah: number,
  bx: number,
  by: number,
  bw: number,
  bh: number
): number {
  const gapX = Math.max(0, ax - (bx + bw), bx - (ax + aw));
  const gapY = Math.max(0, ay - (by + bh), by - (ay + ah));
  return Math.hypot(gapX, gapY);
}

export function computeDragDropHint(
  draggedId: string,
  worldX: number,
  worldY: number,
  curDoc: MindMapDocument,
  curLayouts: Record<string, LayoutNodeInfo>,
  dragOffset?: { dx: number; dy: number }
): DragDropHint | null {
  const draggedNode = curDoc.nodes[draggedId];
  const draggedLayout = curLayouts[draggedId];
  if (!draggedNode || !draggedLayout) return null;

  const isDraggedRoot = draggedNode.parentId === null;
  if (isDraggedRoot && curDoc.rootIds.length <= 1) return null;

  const excluded = new Set(getSubtreeIds(curDoc, draggedId, true));
  const candidates = Object.values(curLayouts).filter((l) => !excluded.has(l.id));

  let bestCand: LayoutNodeInfo | null = null;
  let bestDist = Infinity;
  const hitMargin = isDraggedRoot ? 12 : 18;

  for (const cand of candidates) {
    if (
      worldX >= cand.x - hitMargin &&
      worldX <= cand.x + cand.width + hitMargin &&
      worldY >= cand.y - hitMargin &&
      worldY <= cand.y + cand.height + hitMargin
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

  if (!bestCand && !isDraggedRoot) {
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
      const label = isDraggedRoot
        ? side === "left"
          ? "Attach to Left"
          : side === "right"
          ? "Attach to Right"
          : "Attach here"
        : side === "left"
        ? "Move to Left"
        : side === "right"
        ? "Move to Right"
        : "Attach here";
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

    const edgeRatio = isDraggedRoot ? 0.28 : 0.34;
    if (curDoc.layout === "org-chart") {
      const relX = (worldX - bestCand.x) / Math.max(1, bestCand.width);
      if (relX < edgeRatio) {
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
            label: isDraggedRoot ? "Insert left" : "Move left",
          },
        };
      }
      if (relX > 1 - edgeRatio) {
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
            label: isDraggedRoot ? "Insert right" : "Move right",
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
    if (relY < edgeRatio) {
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
          label: isDraggedRoot ? "Insert above" : "Move above",
        },
      };
    }
    if (relY > 1 - edgeRatio) {
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
          label: isDraggedRoot ? "Insert below" : "Move below",
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

  if (draggedNode.parentId === null) {
    return null;
  }

  // Dragging far away from the parent into empty canvas space detaches the node into its own root
  const parentLayout = curLayouts[draggedNode.parentId];
  if (parentLayout) {
    const dragX = dragOffset ? draggedLayout.x + dragOffset.dx : worldX - draggedLayout.width / 2;
    const dragY = dragOffset ? draggedLayout.y + dragOffset.dy : worldY - draggedLayout.height / 2;
    const dragDist = dragOffset
      ? Math.hypot(dragOffset.dx, dragOffset.dy)
      : Math.hypot(dragX - draggedLayout.x, dragY - draggedLayout.y);
    const initialEdgeDist = rectEdgeDistance(
      draggedLayout.x,
      draggedLayout.y,
      draggedLayout.width,
      draggedLayout.height,
      parentLayout.x,
      parentLayout.y,
      parentLayout.width,
      parentLayout.height
    );
    const currentEdgeDist = rectEdgeDistance(
      dragX,
      dragY,
      draggedLayout.width,
      draggedLayout.height,
      parentLayout.x,
      parentLayout.y,
      parentLayout.width,
      parentLayout.height
    );
    const hGap = Math.max(
      MIN_HORIZONTAL_GAP,
      Math.min(MAX_HORIZONTAL_GAP, curDoc.horizontalGap ?? DEFAULT_HORIZONTAL_GAP)
    );
    const detachGapThreshold = Math.max(220, hGap + 140);

    if (
      dragDist >= 140 &&
      currentEdgeDist >= detachGapThreshold &&
      (currentEdgeDist >= initialEdgeDist + 80 || dragDist >= 260)
    ) {
      return {
        draggedId,
        targetId: draggedNode.parentId,
        placement: "detach",
        detachPosition: {
          x: Math.round(dragX + draggedLayout.width / 2),
          y: Math.round(dragY + draggedLayout.height / 2),
        },
        indicator: {
          kind: "detach",
          x: dragX - 4,
          y: dragY - 4,
          width: draggedLayout.width + 8,
          height: draggedLayout.height + 8,
          label: "Release to detach",
        },
      };
    }
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

export function deleteNodes(
  doc: MindMapDocument,
  selectedIds: string[]
): { doc: MindMapDocument; nextSelectedId: string | null } {
  const next = cloneDocument(doc);
  const toDelete = new Set<string>();

  const collect = (id: string) => {
    if (toDelete.has(id)) return;
    const node = next.nodes[id];
    if (!node) return;
    toDelete.add(id);
    for (const cid of node.childrenIds) collect(cid);
  };

  for (const id of selectedIds) collect(id);

  // Never delete the very last root node so the map always stays valid
  if (next.rootIds.every((rid) => toDelete.has(rid))) {
    const primaryRoot = next.rootIds[0];
    if (primaryRoot && next.nodes[primaryRoot]) {
      toDelete.delete(primaryRoot);
    }
  }

  let fallbackFocus: string | null = null;
  for (const id of selectedIds) {
    const n = next.nodes[id];
    if (n?.parentId && !toDelete.has(n.parentId)) {
      fallbackFocus = n.parentId;
      break;
    }
  }

  for (const id of toDelete) {
    const node = next.nodes[id];
    if (node?.parentId && next.nodes[node.parentId]) {
      next.nodes[node.parentId].childrenIds = next.nodes[node.parentId].childrenIds.filter(
        (cid) => cid !== id
      );
    }
    delete next.nodes[id];
  }

  next.rootIds = next.rootIds.filter((rid) => !toDelete.has(rid));
  if (next.rootIds.length === 0 && Object.keys(next.nodes).length > 0) {
    next.rootIds = [Object.keys(next.nodes)[0]];
  }
  next.crossLinks = next.crossLinks.filter(
    (xl) => !toDelete.has(xl.fromId) && !toDelete.has(xl.toId)
  );

  if (!fallbackFocus || !next.nodes[fallbackFocus]) {
    fallbackFocus = next.rootIds[0] ?? null;
  }

  next.updatedAt = new Date().toISOString();
  return { doc: next, nextSelectedId: fallbackFocus };
}

function getEffectiveRootChildSide(
  doc: MindMapDocument,
  rootChildrenIds: string[],
  childId: string
): "left" | "right" {
  if (doc.layout === "tree-right") return "right";
  const child = doc.nodes[childId];
  if (child?.side === "left" || child?.side === "right") return child.side;
  const idx = rootChildrenIds.indexOf(childId);
  return idx % 2 === 0 ? "right" : "left";
}

function getTopBranchId(doc: MindMapDocument, nodeId: string): string | null {
  let cur = doc.nodes[nodeId];
  while (cur && cur.parentId) {
    const parent = doc.nodes[cur.parentId];
    if (!parent) return null;
    if (parent.parentId === null) return cur.id;
    cur = parent;
  }
  return null;
}

export function getEffectiveNodeSide(doc: MindMapDocument, nodeId: string): "left" | "right" {
  if (doc.layout === "tree-right") return "right";
  const branchId = getTopBranchId(doc, nodeId);
  if (!branchId) {
    return doc.nodes[nodeId]?.side === "left" ? "left" : "right";
  }
  const branch = doc.nodes[branchId];
  const root = branch?.parentId ? doc.nodes[branch.parentId] : undefined;
  if (!branch || !root) return "right";
  return getEffectiveRootChildSide(doc, root.childrenIds, branchId);
}

function normalizeRootChildrenSides(doc: MindMapDocument, rootId: string): void {
  const root = doc.nodes[rootId];
  if (!root || root.parentId !== null) return;
  root.childrenIds.forEach((cid, idx) => {
    const child = doc.nodes[cid];
    if (!child) return;
    if (doc.layout === "tree-right") {
      child.side = "right";
    } else if (child.side !== "left" && child.side !== "right") {
      child.side = idx % 2 === 0 ? "right" : "left";
    }
  });
}

function setSubtreeSide(doc: MindMapDocument, rootId: string, side: "left" | "right"): void {
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!n) return;
    n.side = side;
    for (const cid of n.childrenIds) walk(cid);
  };
  walk(rootId);
}

function getVisualSiblingIds(doc: MindMapDocument, targetId: string): string[] {
  const node = doc.nodes[targetId];
  if (!node || !node.parentId) return [];
  const parent = doc.nodes[node.parentId];
  if (!parent) return [];
  if (parent.parentId === null && doc.layout === "mindmap") {
    const targetSide = getEffectiveRootChildSide(doc, parent.childrenIds, targetId);
    return parent.childrenIds.filter(
      (cid) => getEffectiveRootChildSide(doc, parent.childrenIds, cid) === targetSide
    );
  }
  return parent.childrenIds;
}

export function reorderSibling(
  doc: MindMapDocument,
  targetId: string,
  delta: -1 | 1
): MindMapDocument {
  const node = doc.nodes[targetId];
  if (!node || !node.parentId) return doc;
  const parent = doc.nodes[node.parentId];
  if (!parent) return doc;

  const isRadialRootChild = parent.parentId === null && doc.layout === "mindmap";
  const visualSiblings = getVisualSiblingIds(doc, targetId);
  const visualIdx = visualSiblings.indexOf(targetId);
  const nextVisualIdx = visualIdx + delta;
  if (visualIdx < 0 || nextVisualIdx < 0 || nextVisualIdx >= visualSiblings.length) return doc;

  const swapTargetId = visualSiblings[nextVisualIdx];
  const idx = parent.childrenIds.indexOf(targetId);
  const nextIdx = parent.childrenIds.indexOf(swapTargetId);
  if (idx < 0 || nextIdx < 0) return doc;

  const next = cloneDocument(doc);
  if (isRadialRootChild) {
    normalizeRootChildrenSides(next, parent.id);
  }
  const list = next.nodes[node.parentId].childrenIds;
  [list[idx], list[nextIdx]] = [list[nextIdx], list[idx]];
  next.updatedAt = new Date().toISOString();
  return next;
}

export function moveNodeRelative(
  doc: MindMapDocument,
  targetId: string,
  direction: "up" | "down" | "left" | "right"
): MindMapDocument {
  const node = doc.nodes[targetId];
  if (!node || !node.parentId) return doc;

  if (doc.layout === "org-chart") {
    if (direction === "left" || direction === "up") {
      return reorderSibling(doc, targetId, -1);
    }
    return reorderSibling(doc, targetId, 1);
  }

  if (direction === "up") return reorderSibling(doc, targetId, -1);
  if (direction === "down") return reorderSibling(doc, targetId, 1);

  const branchId = getTopBranchId(doc, targetId);
  if (!branchId) return doc;
  const currentSide = getEffectiveNodeSide(doc, branchId);
  if (currentSide === direction) return doc;

  const next = cloneDocument(doc);
  const branch = next.nodes[branchId];
  if (!branch || !branch.parentId) return doc;

  normalizeRootChildrenSides(next, branch.parentId);
  if (next.layout === "tree-right" && direction === "left") {
    next.layout = "mindmap";
  }
  setSubtreeSide(next, branchId, direction);
  next.updatedAt = new Date().toISOString();
  return next;
}

export function getNodeMoveCapabilities(
  doc: MindMapDocument,
  targetId: string
): { canMoveUp: boolean; canMoveDown: boolean; canMoveLeft: boolean; canMoveRight: boolean } {
  const node = doc.nodes[targetId];
  if (!node || !node.parentId) {
    return { canMoveUp: false, canMoveDown: false, canMoveLeft: false, canMoveRight: false };
  }
  const visualSiblings = getVisualSiblingIds(doc, targetId);
  const pos = visualSiblings.indexOf(targetId);

  if (doc.layout === "org-chart") {
    return {
      canMoveUp: false,
      canMoveDown: false,
      canMoveLeft: pos > 0,
      canMoveRight: pos >= 0 && pos < visualSiblings.length - 1,
    };
  }

  const side = getEffectiveNodeSide(doc, targetId);
  return {
    canMoveUp: pos > 0,
    canMoveDown: pos >= 0 && pos < visualSiblings.length - 1,
    canMoveLeft: side === "right",
    canMoveRight: side === "left",
  };
}

export function repositionNode(
  doc: MindMapDocument,
  draggedId: string,
  targetId: string,
  placement: "before" | "after" | "inside",
  targetSide?: "left" | "right"
): MindMapDocument {
  const dragged = doc.nodes[draggedId];
  const target = doc.nodes[targetId];
  if (!dragged || !target || draggedId === targetId) return doc;

  const isDetachedRoot = dragged.parentId === null;
  if (isDetachedRoot && doc.rootIds.length <= 1) return doc;

  const subtreeIds = getSubtreeIds(doc, draggedId, true);
  if (subtreeIds.includes(targetId)) return doc;

  const next = cloneDocument(doc);
  const oldParentId = dragged.parentId;
  const oldRootId =
    oldParentId && doc.nodes[oldParentId]?.parentId === null ? oldParentId : null;
  if (oldRootId) normalizeRootChildrenSides(next, oldRootId);

  const detachFromOldLocation = () => {
    if (oldParentId) {
      const oldParent = next.nodes[oldParentId];
      if (oldParent) {
        oldParent.childrenIds = oldParent.childrenIds.filter((cid) => cid !== draggedId);
      }
    } else {
      next.rootIds = next.rootIds.filter((rid) => rid !== draggedId);
      delete next.nodes[draggedId].position;
    }
  };

  if (placement === "inside") {
    const newParent = next.nodes[targetId];
    if (!newParent) return doc;

    let resolvedSide: "left" | "right" | undefined;
    if (newParent.parentId === null) {
      normalizeRootChildrenSides(next, newParent.id);
      if (targetSide) {
        resolvedSide = targetSide;
      } else if (next.layout === "tree-right") {
        resolvedSide = "right";
      } else if (isDetachedRoot) {
        const rightCount = newParent.childrenIds.filter(
          (cid) => next.nodes[cid]?.side === "right"
        ).length;
        const leftCount = newParent.childrenIds.filter(
          (cid) => next.nodes[cid]?.side === "left"
        ).length;
        resolvedSide = rightCount <= leftCount ? "right" : "left";
      } else {
        resolvedSide = getEffectiveNodeSide(doc, draggedId);
      }
      if (next.layout === "tree-right" && resolvedSide === "left") {
        next.layout = "mindmap";
      }
    } else if (next.layout !== "org-chart") {
      resolvedSide = getEffectiveNodeSide(doc, targetId);
    }

    const sameParent = oldParentId === targetId;
    const sameSide = !resolvedSide || getEffectiveNodeSide(doc, draggedId) === resolvedSide;
    if (!isDetachedRoot && sameParent && sameSide) return doc;

    detachFromOldLocation();
    next.nodes[draggedId].parentId = targetId;
    newParent.collapsed = false;
    if (!newParent.childrenIds.includes(draggedId)) {
      newParent.childrenIds.push(draggedId);
    }
    if (resolvedSide) {
      setSubtreeSide(next, draggedId, resolvedSide);
    }
    next.updatedAt = new Date().toISOString();
    return next;
  }

  if (!target.parentId) return doc;
  const newParentId = target.parentId;
  const newParent = next.nodes[newParentId];
  if (!newParent) return doc;

  if (newParent.parentId === null) {
    normalizeRootChildrenSides(next, newParent.id);
  }

  let resolvedSide: "left" | "right" | undefined;
  if (next.layout !== "org-chart") {
    resolvedSide =
      newParent.parentId === null
        ? targetSide ?? getEffectiveRootChildSide(next, newParent.childrenIds, targetId)
        : getEffectiveNodeSide(next, newParentId);
    if (newParent.parentId === null && next.layout === "tree-right" && resolvedSide === "left") {
      next.layout = "mindmap";
    }
  }

  detachFromOldLocation();
  next.nodes[draggedId].parentId = newParentId;
  const targetIdx = newParent.childrenIds.indexOf(targetId);
  const insertIdx = targetIdx >= 0 ? (placement === "before" ? targetIdx : targetIdx + 1) : newParent.childrenIds.length;
  newParent.childrenIds.splice(insertIdx, 0, draggedId);
  if (resolvedSide) {
    setSubtreeSide(next, draggedId, resolvedSide);
  }

  // Avoid committing a no-op if parent, side, and visual sibling order did not change
  if (!isDetachedRoot && oldParentId === newParentId) {
    const prevOrder = getVisualSiblingIds(doc, draggedId);
    const nextOrder = getVisualSiblingIds(next, draggedId);
    const prevSide = getEffectiveNodeSide(doc, draggedId);
    const nextSide = getEffectiveNodeSide(next, draggedId);
    if (
      prevSide === nextSide &&
      prevOrder.length === nextOrder.length &&
      prevOrder.every((id, i) => id === nextOrder[i])
    ) {
      return doc;
    }
  }

  next.updatedAt = new Date().toISOString();
  return next;
}

export function getSubtreeIds(
  doc: MindMapDocument,
  rootId: string,
  includeRoot: boolean
): string[] {
  const out: string[] = [];
  const walk = (id: string, isRoot: boolean) => {
    const n = doc.nodes[id];
    if (!n) return;
    if (!isRoot || includeRoot) out.push(id);
    for (const cid of n.childrenIds) walk(cid, false);
  };
  walk(rootId, true);
  return out;
}

export function getSiblingIds(doc: MindMapDocument, nodeId: string): string[] {
  const node = doc.nodes[nodeId];
  if (!node) return [];
  if (!node.parentId) return [...doc.rootIds];
  return [...(doc.nodes[node.parentId]?.childrenIds || [])];
}

export function toggleCollapseNode(doc: MindMapDocument, targetId: string): MindMapDocument {
  const target = doc.nodes[targetId];
  if (!target || target.childrenIds.length === 0) return doc;
  const next = cloneDocument(doc);
  next.nodes[targetId].collapsed = !next.nodes[targetId].collapsed;
  next.updatedAt = new Date().toISOString();
  return next;
}

/**
 * Collapses all nodes at depth >= maxExpandedDepth (e.g. Alt+1 shows root + level 1,
 * collapsing level 1 nodes; Alt+2 expands levels 0..1 and collapses level 2).
 */
export function collapseToLevel(doc: MindMapDocument, level: number): MindMapDocument {
  const next = cloneDocument(doc);
  const visit = (id: string, depth: number) => {
    const node = next.nodes[id];
    if (!node) return;
    if (node.childrenIds.length > 0) {
      node.collapsed = depth >= level;
    } else {
      node.collapsed = false;
    }
    for (const cid of node.childrenIds) {
      visit(cid, depth + 1);
    }
  };
  for (const rootId of next.rootIds) {
    visit(rootId, 0);
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

export function expandAllNodes(doc: MindMapDocument): MindMapDocument {
  const next = cloneDocument(doc);
  for (const node of Object.values(next.nodes)) {
    node.collapsed = false;
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

export function getMaxDepth(doc: MindMapDocument): number {
  let maxDepth = 0;
  const visited = new Set<string>();
  const visit = (id: string, depth: number) => {
    if (visited.has(id)) return;
    const node = doc.nodes[id];
    if (!node) return;
    visited.add(id);
    if (depth > maxDepth) maxDepth = depth;
    for (const cid of node.childrenIds) {
      visit(cid, depth + 1);
    }
  };
  for (const rootId of doc.rootIds) {
    visit(rootId, 0);
  }
  return maxDepth;
}

export function applyCollapseState(
  target: MindMapDocument,
  source: MindMapDocument
): MindMapDocument {
  let nextNodes: Record<string, MindMapNode> | null = null;
  for (const [id, node] of Object.entries(target.nodes)) {
    const sourceNode = source.nodes[id];
    if (!sourceNode) continue;
    const targetCollapsed = Boolean(node.collapsed);
    const sourceCollapsed = Boolean(sourceNode.collapsed);
    if (targetCollapsed !== sourceCollapsed) {
      if (!nextNodes) {
        nextNodes = { ...target.nodes };
      }
      nextNodes[id] = { ...node, collapsed: sourceCollapsed };
    }
  }
  if (!nextNodes) return target;
  return { ...target, nodes: nextNodes };
}

export function updateNodesStyle(
  doc: MindMapDocument,
  ids: string[],
  updater: (node: MindMapNode) => void
): MindMapDocument {
  const next = cloneDocument(doc);
  for (const id of ids) {
    const node = next.nodes[id];
    if (node) updater(node);
  }
  next.updatedAt = new Date().toISOString();
  return next;
}

export function adjustFontSize(doc: MindMapDocument, ids: string[], mode: "inc" | "dec" | "reset"): MindMapDocument {
  return updateNodesStyle(doc, ids, (node) => {
    node.style = node.style || {};
    if (mode === "reset") {
      delete node.style.fontSize;
    } else {
      const current = node.style.fontSize ?? (node.parentId === null ? 16 : 14);
      node.style.fontSize = mode === "inc" ? Math.min(34, current + 2) : Math.max(10, current - 2);
    }
  });
}

export function setNodesAlign(doc: MindMapDocument, ids: string[], align: NodeAlign): MindMapDocument {
  return updateNodesStyle(doc, ids, (node) => {
    node.style = node.style || {};
    node.style.align = align;
  });
}

export function setNodesShape(doc: MindMapDocument, ids: string[], shape: NodeShape): MindMapDocument {
  return updateNodesStyle(doc, ids, (node) => {
    node.style = node.style || {};
    node.style.shape = shape;
  });
}

export function toggleCheckboxLine(markdown: string, lineIndex: number): string {
  const lines = markdown.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) return markdown;
  lines[lineIndex] = lines[lineIndex].replace(
    /^(\s*(?:[-*+]|\d+\.)\s+\[)([ xX])(\]\s+)/,
    (_m, pre: string, state: string, post: string) => `${pre}${state === " " ? "x" : " "}${post}`
  );
  return lines.join("\n");
}

export function insertSubtreeBranches(
  doc: MindMapDocument,
  parentId: string,
  branches: SubtreeBranch[]
): { doc: MindMapDocument; firstAddedId: string | null } {
  if (branches.length === 0) return { doc, firstAddedId: null };
  const next = cloneDocument(doc);
  const parent = next.nodes[parentId];
  if (!parent) return { doc, firstAddedId: null };

  parent.collapsed = false;
  let firstAddedId: string | null = null;

  const attachBranch = (branch: SubtreeBranch, pId: string, inheritedSide?: "left" | "right") => {
    const pNode = next.nodes[pId];
    const id = makeId("node");
    if (!firstAddedId) firstAddedId = id;

    let side = inheritedSide;
    if (pNode.parentId === null && next.layout === "mindmap") {
      const rightCount = pNode.childrenIds.filter((c) => next.nodes[c]?.side === "right").length;
      const leftCount = pNode.childrenIds.filter((c) => next.nodes[c]?.side === "left").length;
      side = rightCount <= leftCount ? "right" : "left";
    }

    next.nodes[id] = {
      id,
      parentId: pId,
      childrenIds: [],
      text: branch.text,
      side,
    };
    pNode.childrenIds.push(id);

    for (const child of branch.children) {
      attachBranch(child, id, side);
    }
  };

  for (const branch of branches) {
    attachBranch(branch, parentId, parent.side);
  }

  next.updatedAt = new Date().toISOString();
  return { doc: next, firstAddedId };
}

export function serializeClipboardSubtree(doc: MindMapDocument, rootIds: string[]): MindMapNode[] {
  const topIds = rootIds.filter((id) => {
    const n = doc.nodes[id];
    return n && (!n.parentId || !rootIds.includes(n.parentId));
  });

  const collected: MindMapNode[] = [];
  const walk = (id: string) => {
    const n = doc.nodes[id];
    if (!n) return;
    collected.push(structuredClone(n));
    for (const cid of n.childrenIds) walk(cid);
  };
  for (const id of topIds) walk(id);
  return collected;
}

export function pasteSubtreeNodes(
  doc: MindMapDocument,
  targetParentId: string,
  copiedNodes: MindMapNode[]
): { doc: MindMapDocument; pastedRootIds: string[] } {
  if (copiedNodes.length === 0) return { doc, pastedRootIds: [] };
  const next = cloneDocument(doc);
  const parent = next.nodes[targetParentId];
  if (!parent) return { doc, pastedRootIds: [] };

  const idMap = new Map<string, string>();
  for (const node of copiedNodes) {
    idMap.set(node.id, makeId("node"));
  }

  const copiedSet = new Set(copiedNodes.map((n) => n.id));
  const pastedRootIds: string[] = [];

  for (const orig of copiedNodes) {
    const newId = idMap.get(orig.id)!;
    const isTop = !orig.parentId || !copiedSet.has(orig.parentId);
    const newParentId = isTop ? targetParentId : idMap.get(orig.parentId!)!;

    next.nodes[newId] = {
      ...structuredClone(orig),
      id: newId,
      parentId: newParentId,
      childrenIds: orig.childrenIds.map((cid) => idMap.get(cid)!).filter(Boolean),
      position: undefined,
      side: isTop ? parent.side : orig.side,
    };

    if (isTop) {
      pastedRootIds.push(newId);
      parent.childrenIds.push(newId);
    }
  }

  parent.collapsed = false;
  next.updatedAt = new Date().toISOString();
  return { doc: next, pastedRootIds };
}

export function setNodesColor(
  doc: MindMapDocument,
  ids: string[],
  colors: { color?: string; borderColor?: string; edgeColor?: string; textColor?: string | null }
): MindMapDocument {
  const next = updateNodesStyle(doc, ids, (node) => {
    node.style = node.style || {};
    if (colors.color === "none") {
      node.style.color = "none";
      if (colors.textColor === undefined) {
        delete node.style.textColor;
      }
    } else if (colors.color !== undefined) {
      node.style.color = colors.color;
    }
    if (colors.borderColor !== undefined) node.style.borderColor = colors.borderColor;
    if (colors.edgeColor !== undefined) node.style.edgeColor = colors.edgeColor;
    if (colors.textColor === null) {
      delete node.style.textColor;
    } else if (colors.textColor !== undefined) {
      node.style.textColor = colors.textColor;
    }
  });
  next.colorMode = "custom";
  return next;
}

export function resetNodesColor(doc: MindMapDocument, ids: string[]): MindMapDocument {
  return updateNodesStyle(doc, ids, (node) => {
    if (!node.style) return;
    delete node.style.color;
    delete node.style.borderColor;
    delete node.style.edgeColor;
    delete node.style.textColor;
  });
}

export function resizeNodesBatch(
  doc: MindMapDocument,
  ids: string[],
  dimensions: { width?: number; minHeight?: number } | "auto"
): MindMapDocument {
  return updateNodesStyle(doc, ids, (node) => {
    node.style = node.style || {};
    if (dimensions === "auto") {
      delete node.style.width;
      delete node.style.minHeight;
    } else {
      if (dimensions.width !== undefined) node.style.width = dimensions.width;
      if (dimensions.minHeight !== undefined) node.style.minHeight = dimensions.minHeight;
    }
  });
}

export function toggleBatchFormatting(
  doc: MindMapDocument,
  ids: string[],
  wrapper: "**" | "*" | "~~" | "`"
): MindMapDocument {
  const esc = wrapper.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^${esc}([\\s\\S]+)${esc}$`);
  return updateNodesStyle(doc, ids, (node) => {
    const trimmed = node.text.trim();
    if (!trimmed) return;
    const match = trimmed.match(re);
    node.text = match ? match[1] : `${wrapper}${trimmed}${wrapper}`;
  });
}

export function toggleAllTasksInNodes(
  doc: MindMapDocument,
  ids: string[],
  checked: boolean
): MindMapDocument {
  const mark = checked ? "x" : " ";
  return updateNodesStyle(doc, ids, (node) => {
    node.text = node.text.replace(
      /^(\s*(?:[-*+]|\d+\.)\s+\[)[ xX](\]\s+)/gm,
      `$1${mark}$2`
    );
  });
}

export function setBatchCollapse(
  doc: MindMapDocument,
  ids: string[],
  collapsed: boolean
): MindMapDocument {
  return updateNodesStyle(doc, ids, (node) => {
    if (node.childrenIds.length > 0) {
      node.collapsed = collapsed;
    }
  });
}

export function updateBatchPhotoProps(
  doc: MindMapDocument,
  ids: string[],
  patch: Partial<NodeImage>
): MindMapDocument {
  return updateNodesStyle(doc, ids, (node) => {
    if (!node.images || node.images.length === 0) return;
    node.images = node.images.map((img) => ({ ...img, ...patch }));
  });
}

export function removeAllPhotosFromNodes(doc: MindMapDocument, ids: string[]): MindMapDocument {
  return updateNodesStyle(doc, ids, (node) => {
    node.images = [];
  });
}

export function duplicateNodes(
  doc: MindMapDocument,
  ids: string[]
): { doc: MindMapDocument; newIds: string[] } {
  const copied = serializeClipboardSubtree(doc, ids);
  if (copied.length === 0) return { doc, newIds: [] };

  const next = cloneDocument(doc);
  const newIds: string[] = [];
  const topOriginals = copied.filter((n) => !n.parentId || !ids.includes(n.parentId));

  for (const orig of topOriginals) {
    if (!orig.parentId || !next.nodes[orig.parentId]) {
      // Root duplication: create detached root below
      const subtree = serializeClipboardSubtree(doc, [orig.id]);
      const idMap = new Map<string, string>();
      for (const s of subtree) idMap.set(s.id, makeId("node"));
      for (const s of subtree) {
        const nid = idMap.get(s.id)!;
        const isTop = s.id === orig.id;
        next.nodes[nid] = {
          ...structuredClone(s),
          id: nid,
          parentId: isTop ? null : idMap.get(s.parentId!)!,
          childrenIds: s.childrenIds.map((c) => idMap.get(c)!).filter(Boolean),
          position: isTop && s.position ? { x: s.position.x + 40, y: s.position.y + 80 } : undefined,
        };
        if (isTop) {
          next.rootIds.push(nid);
          newIds.push(nid);
        }
      }
    } else {
      const subtree = serializeClipboardSubtree(doc, [orig.id]);
      const res = pasteSubtreeNodes(next, orig.parentId, subtree);
      Object.assign(next.nodes, res.doc.nodes);
      next.nodes[orig.parentId] = res.doc.nodes[orig.parentId];
      newIds.push(...res.pastedRootIds);
    }
  }

  next.updatedAt = new Date().toISOString();
  return { doc: next, newIds };
}

