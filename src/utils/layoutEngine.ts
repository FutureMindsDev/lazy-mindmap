import type {
  ConnectorStyle,
  CrossLinkLayer,
  LayoutMode,
  LayoutNodeInfo,
  MindMapDocument,
  MindMapNode,
} from "../types/mindmap";
import { MIND_THEMES } from "./themes";

export type SizeMap = Record<string, { width: number; height: number }>;

export const DEFAULT_HORIZONTAL_GAP = 80;
export const MIN_HORIZONTAL_GAP = 36;
export const MAX_HORIZONTAL_GAP = 260;
const V_GAP = 22;
const ROOT_GAP_Y = 96;

function estimateNodeSize(node: MindMapNode, measuredSizes?: SizeMap): { width: number; height: number } {
  const measured = measuredSizes?.[node.id];
  if (measured && measured.width > 20 && measured.height > 20) {
    return {
      width: Math.max(measured.width, node.style?.width || 0),
      height: Math.max(measured.height, node.style?.minHeight || 0),
    };
  }

  const lines = (node.text || "").split("\n");
  const maxChars = Math.max(10, ...lines.map((l) => l.length));
  const hasCode = /```/.test(node.text);
  const hasBlockMath = /\$\$|\\\[|\\begin\{/.test(node.text);
  const hasTable = /\|.+\|/.test(node.text);
  const hasImage = (node.images?.length ?? 0) > 0;

  let width = Math.min(340, Math.max(138, maxChars * 8 + 38));
  if (hasCode || hasTable) width = Math.max(width, 280);
  if (hasImage) {
    const imgW = Math.max(...(node.images || []).map((i) => i.width || 180));
    width = Math.max(width, Math.min(360, imgW + 28));
  }
  if (node.style?.width) {
    width = node.style.width;
  }

  let height = Math.max(44, lines.length * 22 + 22);
  if (hasBlockMath) height += 26;
  if (hasCode) height += 36;
  if (hasImage) height += 110;
  if ((node.stickers?.length ?? 0) > 0) height += 6;
  if (node.style?.minHeight) {
    height = Math.max(height, node.style.minHeight);
  }

  return { width, height };
}

function getVisibleChildren(doc: MindMapDocument, node: MindMapNode): MindMapNode[] {
  if (node.collapsed) return [];
  return node.childrenIds
    .map((id) => doc.nodes[id])
    .filter((child): child is MindMapNode => Boolean(child));
}

function measureSubtreeSpanHorizontal(
  doc: MindMapDocument,
  nodeId: string,
  measuredSizes?: SizeMap
): number {
  const node = doc.nodes[nodeId];
  if (!node) return 44;
  const selfSize = estimateNodeSize(node, measuredSizes);
  const children = getVisibleChildren(doc, node);
  if (children.length === 0) return selfSize.height;

  const childrenTotal =
    children.reduce(
      (sum, child) => sum + measureSubtreeSpanHorizontal(doc, child.id, measuredSizes),
      0
    ) +
    V_GAP * (children.length - 1);

  return Math.max(selfSize.height, childrenTotal);
}

function measureSubtreeSpanVertical(
  doc: MindMapDocument,
  nodeId: string,
  siblingGap: number,
  measuredSizes?: SizeMap
): number {
  const node = doc.nodes[nodeId];
  if (!node) return 140;
  const selfSize = estimateNodeSize(node, measuredSizes);
  const children = getVisibleChildren(doc, node);
  if (children.length === 0) return selfSize.width;

  const childrenTotal =
    children.reduce(
      (sum, child) => sum + measureSubtreeSpanVertical(doc, child.id, siblingGap, measuredSizes),
      0
    ) +
    siblingGap * (children.length - 1);

  return Math.max(selfSize.width, childrenTotal);
}

export function computeMindMapLayout(
  doc: MindMapDocument,
  measuredSizes?: SizeMap,
  isDark = false
): Record<string, LayoutNodeInfo> {
  const result: Record<string, LayoutNodeInfo> = {};
  const theme = MIND_THEMES[doc.theme] || MIND_THEMES.ocean;
  const palette = theme.branchColors;
  const colorMode = doc.colorMode || "colorful";
  const contrastColor = isDark ? "#e2e8f0" : "#1e293b";
  const hGap = Math.max(
    MIN_HORIZONTAL_GAP,
    Math.min(MAX_HORIZONTAL_GAP, doc.horizontalGap ?? DEFAULT_HORIZONTAL_GAP)
  );
  const orgSiblingGap = Math.max(24, Math.round(hGap * 0.4));

  let nextDetachedRootY = 0;

  doc.rootIds.forEach((rootId, rootIdx) => {
    const root = doc.nodes[rootId];
    if (!root) return;

    const rootSize = estimateNodeSize(root, measuredSizes);
    const rootCenterX = root.position?.x ?? 0;
    const rootCenterY =
      root.position?.y ?? (rootIdx === 0 ? 0 : nextDetachedRootY + rootSize.height / 2);

    const rootX = rootCenterX - rootSize.width / 2;
    const rootY = rootCenterY - rootSize.height / 2;

    const rootBranchColor =
      colorMode === "contrast"
        ? contrastColor
        : colorMode === "colorful"
        ? theme.rootBg
        : root.style?.edgeColor || root.style?.borderColor || root.style?.color || theme.rootBg;

    result[rootId] = {
      id: rootId,
      x: rootX,
      y: rootY,
      width: rootSize.width,
      height: rootSize.height,
      depth: 0,
      branchColor: rootBranchColor,
      side: "center",
      rootId,
    };

    const children = getVisibleChildren(doc, root);

    if (doc.layout === "org-chart") {
      const placeDownSubtree = (
        node: MindMapNode,
        centerX: number,
        topY: number,
        depth: number,
        branchColor: string
      ) => {
        const size = estimateNodeSize(node, measuredSizes);
        const resolvedColor =
          colorMode === "contrast"
            ? contrastColor
            : colorMode === "colorful"
            ? branchColor
            : node.style?.edgeColor || node.style?.borderColor || node.style?.color || branchColor;

        if (node.id !== rootId) {
          result[node.id] = {
            id: node.id,
            x: centerX - size.width / 2,
            y: topY,
            width: size.width,
            height: size.height,
            depth,
            branchColor: resolvedColor,
            side: "down",
            rootId,
          };
        }

        const kids = getVisibleChildren(doc, node);
        if (kids.length === 0) return;

        const childSpans = kids.map((k) =>
          measureSubtreeSpanVertical(doc, k.id, orgSiblingGap, measuredSizes)
        );
        const totalWidth =
          childSpans.reduce((a, b) => a + b, 0) + orgSiblingGap * Math.max(0, kids.length - 1);
        let cursorX = centerX - totalWidth / 2;
        const nextTopY = topY + size.height + 54;

        kids.forEach((kid, idx) => {
          const span = childSpans[idx];
          const kidCenterX = cursorX + span / 2;
          const color =
            colorMode === "contrast"
              ? contrastColor
              : depth === 0
              ? palette[idx % palette.length]
              : resolvedColor;
          placeDownSubtree(kid, kidCenterX, nextTopY, depth + 1, color);
          cursorX += span + orgSiblingGap;
        });
      };

      placeDownSubtree(root, rootCenterX, rootY, 0, rootBranchColor);
    } else {
      const placeHorizontalSide = (
        kids: MindMapNode[],
        direction: "left" | "right",
        startIdxOffset: number
      ) => {
        if (kids.length === 0) return;

        const spans = kids.map((k) => measureSubtreeSpanHorizontal(doc, k.id, measuredSizes));
        const totalHeight = spans.reduce((a, b) => a + b, 0) + V_GAP * Math.max(0, kids.length - 1);
        let cursorY = rootCenterY - totalHeight / 2;

        const placeNode = (
          node: MindMapNode,
          edgeX: number,
          centerY: number,
          depth: number,
          branchColor: string
        ) => {
          const size = estimateNodeSize(node, measuredSizes);
          const x = direction === "right" ? edgeX : edgeX - size.width;
          const y = centerY - size.height / 2;
          const resolvedColor =
            colorMode === "contrast"
              ? contrastColor
              : colorMode === "colorful"
              ? branchColor
              : node.style?.edgeColor || node.style?.borderColor || node.style?.color || branchColor;

          result[node.id] = {
            id: node.id,
            x,
            y,
            width: size.width,
            height: size.height,
            depth,
            branchColor: resolvedColor,
            side: direction,
            rootId,
          };

          const grandKids = getVisibleChildren(doc, node);
          if (grandKids.length === 0) return;

          const kidSpans = grandKids.map((gk) =>
            measureSubtreeSpanHorizontal(doc, gk.id, measuredSizes)
          );
          const kidTotalH =
            kidSpans.reduce((a, b) => a + b, 0) + V_GAP * Math.max(0, grandKids.length - 1);
          let kidCursorY = centerY - kidTotalH / 2;
          const nextEdgeX = direction === "right" ? x + size.width + hGap : x - hGap;

          grandKids.forEach((gk, gkIdx) => {
            const gkSpan = kidSpans[gkIdx];
            placeNode(gk, nextEdgeX, kidCursorY + gkSpan / 2, depth + 1, resolvedColor);
            kidCursorY += gkSpan + V_GAP;
          });
        };

        kids.forEach((kid, idx) => {
          const span = spans[idx];
          const branchColor =
            colorMode === "contrast"
              ? contrastColor
              : palette[(idx + startIdxOffset) % palette.length];
          const edgeX =
            direction === "right" ? rootX + rootSize.width + hGap : rootX - hGap;
          placeNode(kid, edgeX, cursorY + span / 2, 1, branchColor);
          cursorY += span + V_GAP;
        });
      };

      if (doc.layout === "tree-right") {
        placeHorizontalSide(children, "right", 0);
      } else {
        // Classic radial balanced mind map
        const rightKids: MindMapNode[] = [];
        const leftKids: MindMapNode[] = [];
        children.forEach((kid, idx) => {
          if (kid.side === "left") {
            leftKids.push(kid);
          } else if (kid.side === "right") {
            rightKids.push(kid);
          } else if (idx % 2 === 0) {
            rightKids.push(kid);
          } else {
            leftKids.push(kid);
          }
        });
        placeHorizontalSide(rightKids, "right", 0);
        placeHorizontalSide(leftKids, "left", rightKids.length);
      }
    }

    // Track bottom-most Y of this root tree for positioning any subsequent detached roots
    let maxY = rootY + rootSize.height;
    for (const info of Object.values(result)) {
      if (info.rootId === rootId) {
        maxY = Math.max(maxY, info.y + info.height);
      }
    }
    nextDetachedRootY = Math.max(nextDetachedRootY, maxY + ROOT_GAP_Y);
  });

  return result;
}

export function buildConnectorPath(
  parent: LayoutNodeInfo,
  child: LayoutNodeInfo,
  style: ConnectorStyle,
  layoutMode: LayoutMode
): string {
  let x1: number;
  let y1: number;
  let x2: number;
  let y2: number;

  if (layoutMode === "org-chart") {
    x1 = parent.x + parent.width / 2;
    y1 = parent.y + parent.height;
    x2 = child.x + child.width / 2;
    y2 = child.y;

    if (style === "straight") {
      return `M ${x1} ${y1} L ${x2} ${y2}`;
    }
    const midY = (y1 + y2) / 2;
    if (style === "orthogonal") {
      return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
    }
    return `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
  }

  const goesLeft = child.x + child.width / 2 < parent.x + parent.width / 2;
  x1 = goesLeft ? parent.x : parent.x + parent.width;
  y1 = parent.y + parent.height / 2;
  x2 = goesLeft ? child.x + child.width : child.x;
  y2 = child.y + child.height / 2;

  if (style === "straight") {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const midX = (x1 + x2) / 2;
  if (style === "orthogonal") {
    return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
  }
  return `M ${x1} ${y1} C ${midX} ${y1}, ${midX} ${y2}, ${x2} ${y2}`;
}

export const MAX_CROSSLINK_LABEL_CHARS = 500;
export const MAX_CROSSLINK_LABEL_SENTENCES = 5;

export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  const terminators = Array.from(trimmed.matchAll(/[.!?]+(?=\s|$)/g));
  if (terminators.length === 0) return 1;
  const last = terminators[terminators.length - 1];
  const endIdx = (last.index ?? 0) + last[0].length;
  const trailing = trimmed.slice(endIdx).trim();
  return terminators.length + (trailing.length > 0 ? 1 : 0);
}

export function clampCrossLinkLabel(text: string): string {
  if (!text) return "";
  let clamped = text.slice(0, MAX_CROSSLINK_LABEL_CHARS);
  const terminators = Array.from(clamped.matchAll(/[.!?]+(?=\s|$)/g));
  if (terminators.length >= MAX_CROSSLINK_LABEL_SENTENCES) {
    const fifth = terminators[MAX_CROSSLINK_LABEL_SENTENCES - 1];
    const cutoff = (fifth.index ?? 0) + fifth[0].length;
    if (clamped.slice(cutoff).trim().length > 0) {
      clamped = clamped.slice(0, cutoff);
    }
  }
  return clamped;
}

export function wrapCrossLinkLabelLines(label: string, maxCharsPerLine = 42): string[] {
  const trimmed = label.trim();
  if (!trimmed) return [];
  const paragraphs = trimmed.split(/\r?\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    const clean = para.trim();
    if (!clean) continue;
    const words = clean.split(/\s+/);
    let current = "";
    for (const word of words) {
      if (!current) {
        if (word.length <= maxCharsPerLine) {
          current = word;
        } else {
          for (let i = 0; i < word.length; i += maxCharsPerLine) {
            const chunk = word.slice(i, i + maxCharsPerLine);
            if (i + maxCharsPerLine < word.length) {
              lines.push(chunk);
            } else {
              current = chunk;
            }
          }
        }
      } else if (current.length + 1 + word.length <= maxCharsPerLine) {
        current = `${current} ${word}`;
      } else {
        lines.push(current);
        if (word.length <= maxCharsPerLine) {
          current = word;
        } else {
          current = "";
          for (let i = 0; i < word.length; i += maxCharsPerLine) {
            const chunk = word.slice(i, i + maxCharsPerLine);
            if (i + maxCharsPerLine < word.length) {
              lines.push(chunk);
            } else {
              current = chunk;
            }
          }
        }
      }
    }
    if (current) lines.push(current);
  }

  return lines;
}

export type CrossLinkAnchorSide = "left" | "right" | "top" | "bottom";

export interface CrossLinkAnchorPoint {
  x: number;
  y: number;
  side: CrossLinkAnchorSide;
}

export function getNodeEdgeMidpoint(
  node: LayoutNodeInfo,
  targetX: number,
  targetY: number
): CrossLinkAnchorPoint {
  const ncx = node.x + node.width / 2;
  const ncy = node.y + node.height / 2;
  const dx = targetX - ncx;
  const dy = targetY - ncy;
  const halfW = Math.max(1, node.width / 2);
  const halfH = Math.max(1, node.height / 2);

  if (Math.abs(dx) / halfW >= Math.abs(dy) / halfH) {
    return dx >= 0
      ? { x: node.x + node.width, y: ncy, side: "right" }
      : { x: node.x, y: ncy, side: "left" };
  }
  return dy >= 0
    ? { x: ncx, y: node.y + node.height, side: "bottom" }
    : { x: ncx, y: node.y, side: "top" };
}

export interface CrossLinkPathResult {
  path: string;
  labelX: number;
  labelY: number;
  startPoint: CrossLinkAnchorPoint;
  endPoint: CrossLinkAnchorPoint;
  relocated: boolean;
  forceLabelAbove: boolean;
}

function estimateLabelBox(label: string): { width: number; height: number } {
  const lines = wrapCrossLinkLabelLines(label, 42);
  if (lines.length === 0) return { width: 64, height: 22 };
  const maxLen = Math.max(4, ...lines.map((l) => l.length));
  return {
    width: Math.min(340, Math.max(48, maxLen * 7.2 + 16)),
    height: Math.max(20, lines.length * 16 + 8),
  };
}

function overlapsRect(
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
  pad: number,
  node: LayoutNodeInfo
): boolean {
  return (
    cx + halfW + pad > node.x &&
    cx - halfW - pad < node.x + node.width &&
    cy + halfH + pad > node.y &&
    cy - halfH - pad < node.y + node.height
  );
}

export function buildCrossLinkPath(
  from: LayoutNodeInfo,
  to: LayoutNodeInfo,
  options?: {
    layouts?: Record<string, LayoutNodeInfo>;
    label?: string;
    layer?: CrossLinkLayer;
  }
): CrossLinkPathResult {
  const fromCenterX = from.x + from.width / 2;
  const fromCenterY = from.y + from.height / 2;
  const toCenterX = to.x + to.width / 2;
  const toCenterY = to.y + to.height / 2;

  const startPoint = getNodeEdgeMidpoint(from, toCenterX, toCenterY);
  const endPoint = getNodeEdgeMidpoint(to, fromCenterX, fromCenterY);

  const fx = startPoint.x;
  const fy = startPoint.y;
  const tx = endPoint.x;
  const ty = endPoint.y;

  const dx = tx - fx;
  const dy = ty - fy;
  const cx = (fx + tx) / 2 - dy * 0.18;
  const cy = (fy + ty) / 2 + dx * 0.18 - 28;

  const path = `M ${fx} ${fy} Q ${cx} ${cy} ${tx} ${ty}`;
  const midX = 0.25 * fx + 0.5 * cx + 0.25 * tx;
  const midY = 0.25 * fy + 0.5 * cy + 0.25 * ty;

  const layer = options?.layer || "above";
  const label = options?.label?.trim() || "";
  const allNodes = options?.layouts ? Object.values(options.layouts) : [];

  if (layer !== "behind" || !label || allNodes.length === 0) {
    return {
      path,
      labelX: midX,
      labelY: midY,
      startPoint,
      endPoint,
      relocated: false,
      forceLabelAbove: false,
    };
  }

  const { width: labelW, height: labelH } = estimateLabelBox(label);
  const halfW = labelW / 2;
  const halfH = labelH / 2;
  const pad = 6;

  const isObscured = (x: number, y: number): boolean =>
    allNodes.some((node) => overlapsRect(x, y, halfW, halfH, pad, node));

  if (!isObscured(midX, midY)) {
    return {
      path,
      labelX: midX,
      labelY: midY,
      startPoint,
      endPoint,
      relocated: false,
      forceLabelAbove: false,
    };
  }

  const evalCurve = (t: number) => {
    const u = 1 - t;
    return {
      t,
      x: u * u * fx + 2 * u * t * cx + t * t * tx,
      y: u * u * fy + 2 * u * t * cy + t * t * ty,
    };
  };

  const curveSamples = Array.from({ length: 29 }, (_, idx) => {
    const t = 0.15 + (idx / 28) * 0.7;
    return evalCurve(t);
  });

  const minCurveDist = (x: number, y: number): number => {
    let best = Infinity;
    for (const pt of curveSamples) {
      const d = Math.hypot(x - pt.x, y - pt.y);
      if (d < best) best = d;
    }
    return best;
  };

  const corridorMinX = Math.min(from.x, to.x) - 32;
  const corridorMaxX = Math.max(from.x + from.width, to.x + to.width) + 32;
  const leftNode = from.x + from.width <= to.x ? from : to.x + to.width <= from.x ? to : null;
  const rightNode = leftNode === from ? to : leftNode === to ? from : null;
  const betweenMinX = leftNode ? leftNode.x + leftNode.width + pad : corridorMinX;
  const betweenMaxX = rightNode ? rightNode.x - pad : corridorMaxX;
  const hasBetweenSpan = leftNode !== null && betweenMaxX - betweenMinX >= labelW;

  interface Candidate {
    x: number;
    y: number;
    score: number;
  }
  const candidates: Candidate[] = [];

  const evaluateHorizontalClearance = (x: number, y: number): number => {
    let leftDist = x - corridorMinX;
    let rightDist = corridorMaxX - x;
    for (const node of allNodes) {
      if (y + halfH + pad > node.y && y - halfH - pad < node.y + node.height) {
        const nodeRight = node.x + node.width;
        if (nodeRight <= x) {
          leftDist = Math.min(leftDist, x - nodeRight);
        }
        if (node.x >= x) {
          rightDist = Math.min(rightDist, node.x - x);
        }
      }
    }
    return Math.min(leftDist, rightDist);
  };

  const pushCandidate = (x: number, y: number, bonus = 0) => {
    if (isObscured(x, y)) return;
    const distToMid = Math.hypot(x - midX, y - midY);
    const distToCurve = minCurveDist(x, y);
    if (distToCurve > 85) return;
    const hClearance = Math.max(0, evaluateHorizontalClearance(x, y));
    // Lower score is better: stay close to the curve and midpoint while favoring horizontal clearance
    const score = distToCurve * 2.4 + distToMid * 0.45 - Math.min(100, hClearance) * 0.55 - bonus;
    candidates.push({ x, y, score });
  };

  // 1. Check unobstructed points directly along the curve
  for (const pt of curveSamples) {
    pushCandidate(pt.x, pt.y, 4);
  }

  // 2. Find middle positions of available horizontal gaps between nodes at curve row heights
  const yRows = new Set<number>();
  yRows.add(Math.round(midY));
  for (const pt of curveSamples) {
    yRows.add(Math.round(pt.y));
  }

  for (const rowY of yRows) {
    const pushGapsInRange = (rangeMin: number, rangeMax: number, gapBonus: number) => {
      const blockingIntervals: Array<[number, number]> = [];
      for (const node of allNodes) {
        if (rowY + halfH + pad > node.y && rowY - halfH - pad < node.y + node.height) {
          const start = Math.max(rangeMin, node.x - pad);
          const end = Math.min(rangeMax, node.x + node.width + pad);
          if (end > start) {
            blockingIntervals.push([start, end]);
          }
        }
      }

      blockingIntervals.sort((a, b) => a[0] - b[0]);
      const merged: Array<[number, number]> = [];
      for (const iv of blockingIntervals) {
        if (merged.length === 0 || iv[0] > merged[merged.length - 1][1]) {
          merged.push([iv[0], iv[1]]);
        } else {
          merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1]);
        }
      }

      let cursor = rangeMin;
      const gaps: Array<[number, number]> = [];
      for (const [bStart, bEnd] of merged) {
        if (bStart > cursor) {
          gaps.push([cursor, bStart]);
        }
        cursor = Math.max(cursor, bEnd);
      }
      if (cursor < rangeMax) {
        gaps.push([cursor, rangeMax]);
      }

      for (const [gStart, gEnd] of gaps) {
        if (gEnd - gStart >= labelW) {
          const gapMidX = (gStart + gEnd) / 2;
          pushCandidate(gapMidX, rowY, gapBonus);
        }
      }
    };

    if (hasBetweenSpan) {
      pushGapsInRange(betweenMinX, betweenMaxX, 28);
    }
    pushGapsInRange(corridorMinX, corridorMaxX, 14);
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => a.score - b.score);
    return {
      path,
      labelX: candidates[0].x,
      labelY: candidates[0].y,
      startPoint,
      endPoint,
      relocated: true,
      forceLabelAbove: false,
    };
  }

  // No collision-free horizontal space left anywhere in a dense/complex map:
  // keep the connecting line behind nodes, and elevate the text label alone above nodes.
  return {
    path,
    labelX: midX,
    labelY: midY,
    startPoint,
    endPoint,
    relocated: false,
    forceLabelAbove: true,
  };
}

export function findArrowNavigationTarget(
  currentId: string,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  layouts: Record<string, LayoutNodeInfo>,
  doc: MindMapDocument
): string | null {
  const current = layouts[currentId];
  const currentNode = doc.nodes[currentId];
  if (!current || !currentNode) return null;

  // Prefer tree hierarchy along primary axes when exact match exists
  if (doc.layout !== "org-chart") {
    if (key === "ArrowRight") {
      if (current.side === "left" && currentNode.parentId && layouts[currentNode.parentId]) {
        return currentNode.parentId;
      }
      const rightChildren = (currentNode.collapsed ? [] : currentNode.childrenIds).filter(
        (cid) => layouts[cid] && layouts[cid].x >= current.x
      );
      if (rightChildren.length > 0) {
        return rightChildren[Math.floor(rightChildren.length / 2)];
      }
    }
    if (key === "ArrowLeft") {
      if (current.side === "right" && currentNode.parentId && layouts[currentNode.parentId]) {
        return currentNode.parentId;
      }
      const leftChildren = (currentNode.collapsed ? [] : currentNode.childrenIds).filter(
        (cid) => layouts[cid] && layouts[cid].x <= current.x
      );
      if (leftChildren.length > 0) {
        return leftChildren[Math.floor(leftChildren.length / 2)];
      }
    }
  } else {
    if (key === "ArrowUp" && currentNode.parentId && layouts[currentNode.parentId]) {
      return currentNode.parentId;
    }
    if (key === "ArrowDown" && !currentNode.collapsed && currentNode.childrenIds.length > 0) {
      const mid = Math.floor(currentNode.childrenIds.length / 2);
      if (layouts[currentNode.childrenIds[mid]]) return currentNode.childrenIds[mid];
    }
  }

  // Fallback: geometric nearest neighbor in the arrow direction
  const cx = current.x + current.width / 2;
  const cy = current.y + current.height / 2;
  let bestId: string | null = null;
  let bestScore = Infinity;

  for (const candidate of Object.values(layouts)) {
    if (candidate.id === currentId) continue;
    const tx = candidate.x + candidate.width / 2;
    const ty = candidate.y + candidate.height / 2;
    const dx = tx - cx;
    const dy = ty - cy;

    let valid = false;
    let primary = 0;
    let perp = 0;

    if (key === "ArrowRight") {
      valid = dx > 12;
      primary = dx;
      perp = Math.abs(dy);
    } else if (key === "ArrowLeft") {
      valid = dx < -12;
      primary = -dx;
      perp = Math.abs(dy);
    } else if (key === "ArrowDown") {
      valid = dy > 8;
      primary = dy;
      perp = Math.abs(dx);
    } else if (key === "ArrowUp") {
      valid = dy < -8;
      primary = -dy;
      perp = Math.abs(dx);
    }

    if (!valid) continue;
    const score = primary + perp * 2.2;
    if (score < bestScore) {
      bestScore = score;
      bestId = candidate.id;
    }
  }

  return bestId;
}
