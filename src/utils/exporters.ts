import type {
  CanvasBackground,
  ColorMode,
  ConnectorStyle,
  CrossLink,
  CrossLinkHeadType,
  CrossLinkLayer,
  CrossLinkStrokeStyle,
  LayoutMode,
  LayoutNodeInfo,
  MindMapDocument,
  MindMapNode,
  NodeAlign,
  NodeImage,
  NodeShape,
  NodeStyle,
  ThemeId,
} from "../types/mindmap";
import {
  buildConnectorPath,
  buildCrossLinkPath,
  wrapCrossLinkLabelLines,
} from "./layoutEngine";
import { renderRichNodeContent } from "./llmMathNormalizer";
import { parseMarkdownToSubtree, type SubtreeBranch } from "./markdownToSubtree";
import { getContrastTextColor, MIND_THEMES } from "./themes";
import { createBlankMap, makeId } from "./treeOps";

const MD_META_PREFIX = "lazymindmap:v1:";
const MD_META_REGEX = /<!--\s*lazymindmap:v1:([0-9a-f]+)\s+([A-Za-z0-9+/=]+)\s*-->/i;

const VALID_LAYOUTS = new Set<LayoutMode>(["mindmap", "tree-right", "org-chart"]);
const VALID_CONNECTORS = new Set<ConnectorStyle>(["bezier", "orthogonal", "straight"]);
const VALID_COLOR_MODES = new Set<ColorMode>(["contrast", "colorful", "custom"]);
const VALID_SHAPES = new Set<NodeShape>(["rounded", "card", "underline", "cloud"]);
const VALID_ALIGNS = new Set<NodeAlign>(["left", "center", "right"]);
const VALID_BACKGROUNDS = new Set<CanvasBackground>([
  "dots",
  "grid-sm",
  "grid-md",
  "grid-lg",
  "plain",
]);

const fontDataUrlCache = new Map<string, string>();

function triggerDownload(filename: string, content: string | Blob, mime: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function safeSlug(title: string): string {
  return (
    (title || "lazymindmap-map")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "lazymindmap-map"
  );
}

function encodeUtf8Base64(text: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(text, "utf8").toString("base64");
  }
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function decodeUtf8Base64(encoded: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(encoded, "base64").toString("utf8");
  }
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
}

function fnv1aHash(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  let hash = 0x811c9dc5;
  for (let i = 0; i < normalized.length; i++) {
    hash ^= normalized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function hasCustomNodeColors(doc: MindMapDocument): boolean {
  return Object.values(doc.nodes).some((node) => {
    const s = node.style;
    if (!s) return false;
    return Boolean(s.color || s.borderColor || s.edgeColor || s.textColor);
  });
}

function cleanStyle(raw: Partial<NodeStyle> | undefined): NodeStyle | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: NodeStyle = {};
  if (typeof raw.color === "string" && raw.color.trim()) out.color = raw.color.trim();
  if (typeof raw.borderColor === "string" && raw.borderColor.trim()) {
    out.borderColor = raw.borderColor.trim();
  }
  if (typeof raw.edgeColor === "string" && raw.edgeColor.trim()) {
    out.edgeColor = raw.edgeColor.trim();
  }
  if (typeof raw.textColor === "string" && raw.textColor.trim()) {
    out.textColor = raw.textColor.trim();
  }
  if (typeof raw.fontSize === "number" && Number.isFinite(raw.fontSize) && raw.fontSize > 0) {
    out.fontSize = Math.round(raw.fontSize);
  }
  if (raw.align && VALID_ALIGNS.has(raw.align)) out.align = raw.align;
  if (raw.shape && VALID_SHAPES.has(raw.shape)) out.shape = raw.shape;
  if (typeof raw.width === "number" && Number.isFinite(raw.width) && raw.width > 0) {
    out.width = Math.round(raw.width);
  }
  if (typeof raw.minHeight === "number" && Number.isFinite(raw.minHeight) && raw.minHeight > 0) {
    out.minHeight = Math.round(raw.minHeight);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function normalizeImportedDocument(
  raw: Partial<MindMapDocument>,
  fallbackTitle = "Imported Mind Map"
): MindMapDocument {
  const now = new Date().toISOString();
  const nodes: Record<string, MindMapNode> = {};
  if (raw.nodes && typeof raw.nodes === "object") {
    for (const [id, node] of Object.entries(raw.nodes)) {
      if (!node || typeof node !== "object") continue;
      nodes[id] = {
        ...structuredClone(node),
        id: node.id || id,
        parentId: node.parentId ?? null,
        childrenIds: Array.isArray(node.childrenIds) ? [...node.childrenIds] : [],
        text: typeof node.text === "string" ? node.text : "Topic",
        style: cleanStyle(node.style),
      };
    }
  }

  for (const node of Object.values(nodes)) {
    node.childrenIds = node.childrenIds.filter((cid) => Boolean(nodes[cid]) && cid !== node.id);
    if (node.parentId && !nodes[node.parentId]) {
      node.parentId = null;
    }
  }

  let rootIds = Array.isArray(raw.rootIds)
    ? raw.rootIds.filter((rid) => Boolean(nodes[rid]))
    : [];
  if (rootIds.length === 0) {
    rootIds = Object.values(nodes)
      .filter((n) => n.parentId === null)
      .map((n) => n.id);
  }
  if (rootIds.length === 0) {
    const firstId = Object.keys(nodes)[0];
    if (firstId) {
      nodes[firstId].parentId = null;
      rootIds = [firstId];
    } else {
      return createBlankMap(fallbackTitle);
    }
  }

  const crossLinks = Array.isArray(raw.crossLinks)
    ? raw.crossLinks
        .filter((xl) => xl && nodes[xl.fromId] && nodes[xl.toId] && xl.fromId !== xl.toId)
        .map((xl) => ({ ...structuredClone(xl), id: xl.id || makeId("xl") }))
    : [];

  const theme: ThemeId = raw.theme && raw.theme in MIND_THEMES ? raw.theme : "ocean";
  const layout: LayoutMode = raw.layout && VALID_LAYOUTS.has(raw.layout) ? raw.layout : "mindmap";
  const connectorStyle: ConnectorStyle =
    raw.connectorStyle && VALID_CONNECTORS.has(raw.connectorStyle) ? raw.connectorStyle : "bezier";
  const backgroundPattern: CanvasBackground | undefined =
    raw.backgroundPattern && VALID_BACKGROUNDS.has(raw.backgroundPattern)
      ? raw.backgroundPattern
      : undefined;

  const doc: MindMapDocument = {
    id: makeId("map"),
    title:
      (typeof raw.title === "string" && raw.title.trim()) ||
      nodes[rootIds[0]]?.text.split("\n")[0].replace(/[*#`]/g, "").trim() ||
      fallbackTitle,
    rootIds,
    nodes,
    crossLinks,
    layout,
    theme,
    colorMode:
      raw.colorMode && VALID_COLOR_MODES.has(raw.colorMode) ? raw.colorMode : undefined,
    connectorStyle,
    horizontalGap:
      typeof raw.horizontalGap === "number" && Number.isFinite(raw.horizontalGap)
        ? raw.horizontalGap
        : undefined,
    backgroundPattern,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : now,
    updatedAt: now,
  };

  if (!doc.colorMode && hasCustomNodeColors(doc)) {
    doc.colorMode = "custom";
  }

  return doc;
}

export function exportMapAsJson(doc: MindMapDocument) {
  triggerDownload(`${safeSlug(doc.title)}.json`, JSON.stringify(doc, null, 2), "application/json");
}

function buildVisibleMarkdown(doc: MindMapDocument): string {
  const lines: string[] = [];
  const walk = (id: string, depth: number) => {
    const node = doc.nodes[id];
    if (!node) return;
    if (depth === 0) {
      lines.push(`# ${node.text.replace(/\n+/g, "\n")}`);
    } else if (depth <= 3) {
      lines.push(`${"#".repeat(depth + 1)} ${node.text}`);
    } else {
      const indent = "  ".repeat(depth - 4);
      const indentedText = node.text
        .split("\n")
        .map((l, idx) => (idx === 0 ? `${indent}- ${l}` : `${indent}  ${l}`))
        .join("\n");
      lines.push(indentedText);
    }
    if (node.notes?.trim()) {
      lines.push(`\n> ${node.notes.trim().replace(/\n/g, "\n> ")}\n`);
    }
    for (const cid of node.childrenIds) {
      walk(cid, depth + 1);
    }
  };
  for (const rootId of doc.rootIds) {
    walk(rootId, 0);
  }
  return lines.join("\n\n");
}

export function serializeMapAsMarkdown(doc: MindMapDocument): string {
  const visibleMd = buildVisibleMarkdown(doc);
  const hash = fnv1aHash(visibleMd);
  const encoded = encodeUtf8Base64(JSON.stringify(doc));
  return `${visibleMd}\n\n<!-- ${MD_META_PREFIX}${hash} ${encoded} -->`;
}

export function exportMapAsMarkdown(doc: MindMapDocument): string {
  const md = serializeMapAsMarkdown(doc);
  triggerDownload(`${safeSlug(doc.title)}.md`, md, "text/markdown");
  return md;
}

export function serializeMapAsMindMup(doc: MindMapDocument): string {
  const toMupIdeas = (id: string): Record<string, unknown> => {
    const node = doc.nodes[id];
    const ideas: Record<string, unknown> = {};
    let rightRank = 1;
    let leftRank = -1;
    node.childrenIds.forEach((cid) => {
      const child = doc.nodes[cid];
      if (!child) return;
      const isLeft =
        node.parentId === null
          ? child.side === "left"
          : node.side === "left" || child.side === "left";
      const rank = isLeft ? leftRank-- : rightRank++;
      ideas[String(rank)] = toMupIdeas(cid);
    });

    const stylePayload: Record<string, unknown> = {};
    if (node.style?.color) stylePayload.background = node.style.color;
    if (node.style?.textColor) stylePayload.color = node.style.textColor;
    if (node.style?.borderColor) stylePayload.borderColor = node.style.borderColor;
    if (node.style?.edgeColor) stylePayload.edgeColor = node.style.edgeColor;
    if (node.style?.fontSize) stylePayload.fontSize = node.style.fontSize;
    if (node.style?.align) stylePayload.align = node.style.align;
    if (node.style?.shape) stylePayload.shape = node.style.shape;
    if (node.style?.width) stylePayload.width = node.style.width;
    if (node.style?.minHeight) stylePayload.minHeight = node.style.minHeight;

    const attr: Record<string, unknown> = {};
    if (Object.keys(stylePayload).length > 0) attr.style = stylePayload;
    if (node.notes) attr.note = { text: node.notes };
    if (node.collapsed) attr.collapsed = true;
    if (node.position) attr.position = [node.position.x, node.position.y];
    if (node.side) attr.side = node.side;
    if (node.stickers && node.stickers.length > 0) attr.stickers = node.stickers;
    if (node.images && node.images.length > 0) attr.images = node.images;
    if (node.attachments && node.attachments.length > 0) attr.attachments = node.attachments;

    return {
      title: node.text,
      id: node.id,
      ...(Object.keys(attr).length > 0 ? { attr } : {}),
      ...(Object.keys(ideas).length > 0 ? { ideas } : {}),
    };
  };

  const rootIdeas: Record<string, unknown> = {};
  doc.rootIds.forEach((rootId, idx) => {
    if (doc.nodes[rootId]) {
      rootIdeas[String(idx + 1)] = toMupIdeas(rootId);
    }
  });

  const links = (doc.crossLinks || []).map((xl) => ({
    ideaIdFrom: xl.fromId,
    ideaIdTo: xl.toId,
    attr: {
      label: xl.label,
      layer: xl.layer,
      startHead: xl.startHead,
      endHead: xl.endHead,
      style: {
        color: xl.color,
        lineStyle: xl.strokeStyle,
      },
    },
  }));

  const mup = {
    formatVersion: 3,
    id: doc.id,
    title: doc.title,
    attr: {
      theme: doc.theme,
      colorMode: doc.colorMode,
      layout: doc.layout,
      connectorStyle: doc.connectorStyle,
      horizontalGap: doc.horizontalGap,
      backgroundPattern: doc.backgroundPattern,
    },
    ideas: rootIdeas,
    ...(links.length > 0 ? { links } : {}),
  };
  return JSON.stringify(mup, null, 2);
}

export function exportMapAsMindMup(doc: MindMapDocument) {
  triggerDownload(`${safeSlug(doc.title)}.mup`, serializeMapAsMindMup(doc), "application/json");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function unescapeXml(str: string): string {
  return str
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}

export function serializeMapAsFreeMind(doc: MindMapDocument): string {
  const renderMmNode = (id: string): string => {
    const node = doc.nodes[id];
    if (!node) return "";

    const attrs: string[] = [`ID="${escapeXml(node.id)}"`, `TEXT="${escapeXml(node.text)}"`];
    if (node.side) attrs.push(`POSITION="${node.side}"`);
    if (node.collapsed) attrs.push(`FOLDED="true"`);
    if (node.style?.textColor) attrs.push(`COLOR="${escapeXml(node.style.textColor)}"`);
    if (node.style?.color) attrs.push(`BACKGROUND_COLOR="${escapeXml(node.style.color)}"`);
    if (node.style?.borderColor) {
      attrs.push(`BORDER_COLOR="${escapeXml(node.style.borderColor)}"`);
    }
    if (node.style?.shape) attrs.push(`STYLE="${escapeXml(node.style.shape)}"`);
    if (node.style?.align) attrs.push(`TEXT_ALIGN="${escapeXml(node.style.align)}"`);
    if (node.style?.width) attrs.push(`MAX_WIDTH="${node.style.width}"`);
    if (node.style?.minHeight) attrs.push(`MIN_HEIGHT="${node.style.minHeight}"`);
    if (node.position) {
      attrs.push(`POS_X="${Math.round(node.position.x)}"`);
      attrs.push(`POS_Y="${Math.round(node.position.y)}"`);
    }
    if (node.stickers && node.stickers.length > 0) {
      attrs.push(`STICKERS="${escapeXml(JSON.stringify(node.stickers))}"`);
    }
    if (node.images && node.images.length > 0) {
      attrs.push(`IMAGES="${escapeXml(encodeUtf8Base64(JSON.stringify(node.images)))}"`);
    }

    const innerParts: string[] = [];
    const edgeColor = node.style?.edgeColor || node.style?.borderColor;
    if (edgeColor) {
      innerParts.push(`<edge COLOR="${escapeXml(edgeColor)}" />`);
    }
    if (node.style?.fontSize) {
      innerParts.push(`<font SIZE="${node.style.fontSize}" />`);
    }
    if (node.notes?.trim()) {
      innerParts.push(
        `<richcontent TYPE="NOTE"><html><body><p>${escapeXml(node.notes)}</p></body></html></richcontent>`
      );
    }
    for (const cid of node.childrenIds) {
      const rendered = renderMmNode(cid);
      if (rendered) innerParts.push(rendered);
    }

    if (innerParts.length === 0) {
      return `<node ${attrs.join(" ")} />`;
    }
    return `<node ${attrs.join(" ")}>\n${innerParts.join("\n")}\n</node>`;
  };

  const mapMeta = encodeUtf8Base64(
    JSON.stringify({
      title: doc.title,
      theme: doc.theme,
      colorMode: doc.colorMode,
      layout: doc.layout,
      connectorStyle: doc.connectorStyle,
      horizontalGap: doc.horizontalGap,
      backgroundPattern: doc.backgroundPattern,
      crossLinks: doc.crossLinks,
    })
  );

  const rootNodesXml = doc.rootIds
    .map((rid) => renderMmNode(rid))
    .filter(Boolean)
    .join("\n");

  return `<map version="1.0.1" LAZYMINDMAP_META="${escapeXml(mapMeta)}">\n${rootNodesXml}\n</map>`;
}

export function exportMapAsFreeMind(doc: MindMapDocument) {
  triggerDownload(`${safeSlug(doc.title)}.mm`, serializeMapAsFreeMind(doc), "application/xml");
}

function buildExportCrossLinksLayer(
  doc: MindMapDocument,
  layouts: Record<string, LayoutNodeInfo>,
  layerFilter: "behind" | "above",
  surfaceBg: string
): { defs: string; body: string } {
  const filtered = doc.crossLinks.filter((xl) => (xl.layer || "above") === layerFilter);
  const elevatedBehindLabels =
    layerFilter === "above"
      ? doc.crossLinks.filter(
          (xl) => (xl.layer || "above") === "behind" && Boolean(xl.label?.trim())
        )
      : [];

  const defsParts: string[] = [];
  const bodyParts: string[] = [];

  const renderMarker = (id: string, headType: CrossLinkHeadType, color: string): string => {
    if (headType === "none") return "";
    if (headType === "circle-filled") {
      return `<marker id="${id}" viewBox="0 0 10 10" refX="8.2" refY="5" markerWidth="6.2" markerHeight="6.2" orient="auto-start-reverse"><circle cx="5" cy="5" r="3.6" fill="${color}" /></marker>`;
    }
    if (headType === "circle-outline") {
      return `<marker id="${id}" viewBox="0 0 10 10" refX="8.2" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><circle cx="5" cy="5" r="3.3" fill="${surfaceBg}" stroke="${color}" stroke-width="1.8" /></marker>`;
    }
    return `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6.5" markerHeight="6.5" orient="auto-start-reverse"><path d="M 0 1 L 10 5 L 0 9 z" fill="${color}" /></marker>`;
  };

  const renderLabel = (label: string | undefined, labelX: number, labelY: number, color: string) => {
    const lines = label ? wrapCrossLinkLabelLines(label, 42) : [];
    if (lines.length === 0) return "";
    const lineHeight = 15;
    const startY = labelY - ((lines.length - 1) * lineHeight) / 2 + 4;
    const tspans = lines
      .map(
        (line, idx) =>
          `<tspan x="${labelX}" dy="${idx === 0 ? 0 : lineHeight}">${escapeXml(line)}</tspan>`
      )
      .join("");
    return `<text x="${labelX}" y="${startY}" text-anchor="middle" fill="${color}" font-family="Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif" font-size="12" font-weight="700" paint-order="stroke fill" stroke="${surfaceBg}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round">${tspans}</text>`;
  };

  for (const xl of filtered) {
    const fromL = layouts[xl.fromId];
    const toL = layouts[xl.toId];
    if (!fromL || !toL) continue;
    const pathInfo = buildCrossLinkPath(fromL, toL, {
      layouts,
      label: xl.label,
      layer: xl.layer || "above",
    });
    const color = xl.color || "#f59e0b";
    const startHead = xl.startHead || "none";
    const endHead = xl.endHead || "arrow";
    const startId = `mf-exp-xl-start-${xl.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;
    const endId = `mf-exp-xl-end-${xl.id.replace(/[^a-zA-Z0-9_-]/g, "")}`;

    if (startHead !== "none") defsParts.push(renderMarker(startId, startHead, color));
    if (endHead !== "none") defsParts.push(renderMarker(endId, endHead, color));

    const dashAttr =
      xl.strokeStyle === "solid"
        ? ""
        : xl.strokeStyle === "dotted"
        ? ' stroke-dasharray="2 6"'
        : ' stroke-dasharray="6 5"';
    const markerStartAttr = startHead !== "none" ? ` marker-start="url(#${startId})"` : "";
    const markerEndAttr = endHead !== "none" ? ` marker-end="url(#${endId})"` : "";

    bodyParts.push(
      `<g><path d="${pathInfo.path}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round"${dashAttr}${markerStartAttr}${markerEndAttr} />${
        !pathInfo.forceLabelAbove
          ? renderLabel(xl.label, pathInfo.labelX, pathInfo.labelY, color)
          : ""
      }</g>`
    );
  }

  for (const xl of elevatedBehindLabels) {
    const fromL = layouts[xl.fromId];
    const toL = layouts[xl.toId];
    if (!fromL || !toL) continue;
    const pathInfo = buildCrossLinkPath(fromL, toL, {
      layouts,
      label: xl.label,
      layer: "behind",
    });
    if (!pathInfo.forceLabelAbove) continue;
    const color = xl.color || "#f59e0b";
    bodyParts.push(renderLabel(xl.label, pathInfo.labelX, pathInfo.labelY, color));
  }

  return { defs: defsParts.join("\n"), body: bodyParts.join("\n") };
}

function computeExportBounds(
  doc: MindMapDocument,
  layouts: Record<string, LayoutNodeInfo>,
  pad = 56
): { width: number; height: number; offsetX: number; offsetY: number } {
  const items = Object.values(layouts);
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

  for (const xl of doc.crossLinks) {
    const fromL = layouts[xl.fromId];
    const toL = layouts[xl.toId];
    if (!fromL || !toL) continue;
    const info = buildCrossLinkPath(fromL, toL, {
      layouts,
      label: xl.label,
      layer: xl.layer || "above",
    });
    const labelHalfW = xl.label ? Math.min(180, xl.label.length * 4 + 20) : 24;
    const labelHalfH = xl.label ? 24 : 16;
    minX = Math.min(minX, info.labelX - labelHalfW);
    maxX = Math.max(maxX, info.labelX + labelHalfW);
    minY = Math.min(minY, info.labelY - labelHalfH);
    maxY = Math.max(maxY, info.labelY + labelHalfH);
  }

  if (!Number.isFinite(minX)) {
    return { width: 400, height: 300, offsetX: pad, offsetY: pad };
  }

  return {
    width: Math.max(120, Math.ceil(maxX - minX + pad * 2)),
    height: Math.max(120, Math.ceil(maxY - minY + pad * 2)),
    offsetX: -minX + pad,
    offsetY: -minY + pad,
  };
}

function html5ToXhtmlFragment(html: string): string {
  return html
    .replace(/<svg(?![^>]*\bxmlns=)/gi, '<svg xmlns="http://www.w3.org/2000/svg"')
    .replace(/<(br|hr|img|input|col|source|wbr)(\b[^>]*?)(?<!\/)>/gi, "<$1$2 />")
    .replace(/\b(checked|disabled|readonly|selected)(?=[\s/>])/gi, '$1="$1"')
    .replace(/&nbsp;/g, "&#160;");
}

function escapeCdata(css: string): string {
  return css.replace(/\]\]>/g, "]]]]><![CDATA[>");
}

const FALLBACK_EXPORT_CSS = `
.mf-export-root, .mf-export-root *, .mf-export-root *::before, .mf-export-root *::after {
  box-sizing: border-box;
}
.mf-export-root {
  position: relative;
  margin: 0;
  padding: 0;
  font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif;
  color: var(--text-primary);
  background: transparent;
}
.mf-node {
  position: absolute;
  min-width: 120px;
  background: var(--bg-surface);
  color: var(--text-primary);
  border: 2px solid var(--node-border, #2563eb);
  border-radius: 12px;
  padding: 9px 13px;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.08);
}
.mf-node.shape-card { border-radius: 5px; }
.mf-node.shape-underline {
  border-radius: 0; border-top: none; border-left: none; border-right: none;
  background: transparent; box-shadow: none; padding-left: 4px; padding-right: 4px;
}
.mf-node.shape-cloud { border-radius: 26px; }
.mf-node.is-root { border-width: 2px; box-shadow: 0 10px 26px rgba(37, 99, 235, 0.22); }
.mf-node-stickers { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; font-size: 1rem; }
.mf-node-images { display: flex; flex-direction: column; gap: 6px; margin-bottom: 6px; }
.mf-node-img-wrap { position: relative; display: inline-block; max-width: 100%; border-radius: 8px; overflow: hidden; border: 1px solid rgba(148, 163, 184, 0.35); margin: 0; }
.mf-node-img-wrap img { display: block; max-width: 100%; height: auto; border-radius: 7px; }
.mf-img-caption { font-size: 0.72rem; opacity: 0.8; padding: 3px 6px; text-align: center; }
.mf-node-content { line-height: 1.45; word-break: break-word; overflow-wrap: anywhere; }
.mf-node-content > *:first-child { margin-top: 0; }
.mf-node-content > *:last-child { margin-bottom: 0; }
.mf-node-content p { margin: 0.3em 0; }
.mf-node-content ul, .mf-node-content ol { margin: 0.25em 0; padding-left: 1.3em; }
.mf-node-content li.mf-task-item { list-style: none; list-style-type: none; }
.mf-node-content ul:has(> li.mf-task-item):not(:has(> li:not(.mf-task-item))) { list-style: none; padding-left: 0.15em; }
.mf-task-checkbox { margin-right: 6px; vertical-align: middle; }
.mf-node-content table { border-collapse: collapse; width: 100%; margin: 6px 0; font-size: 0.85em; }
.mf-node-content th, .mf-node-content td { border: 1px solid rgba(148, 163, 184, 0.45); padding: 4px 7px; text-align: left; }
.mf-node-content th { background: rgba(148, 163, 184, 0.14); }
.mf-node-content blockquote { margin: 6px 0; padding: 4px 10px; border-left: 3px solid var(--accent-color); background: rgba(148, 163, 184, 0.1); border-radius: 0 6px 6px 0; }
.mf-inline-code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 0.86em; padding: 1px 5px; border-radius: 5px; background: rgba(148, 163, 184, 0.2); }
.mf-code-block { margin: 6px 0; border-radius: 8px; overflow: hidden; border: 1px solid #30363d; background: #0d1117; color: #e6edf3; text-align: left; }
.mf-code-header { display: flex; align-items: center; justify-content: space-between; padding: 4px 9px; background: #161b22; border-bottom: 1px solid #30363d; font-size: 0.72rem; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #8b949e; }
.mf-code-pre { margin: 0; padding: 8px 10px; font-size: 0.79rem; line-height: 1.45; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-word; }
.mf-code-pre code { background: transparent; padding: 0; }
.mf-math-block { padding: 4px 2px; margin: 4px 0; }
.mf-mermaid-diagram { margin: 6px 0; border: 1px solid var(--border-color); border-radius: 8px; background: var(--bg-elevated); overflow: hidden; text-align: left; }
.mf-mermaid-svg { display: block; max-width: 100%; height: auto; padding: 6px; }
.mf-mermaid-box { fill: var(--bg-surface); stroke: var(--accent-color); stroke-width: 1.6; }
.mf-mermaid-text { fill: var(--text-primary); font-size: 11px; font-weight: 600; }
.mf-mermaid-edge-label { fill: var(--text-muted); font-size: 10px; }
.mf-callout { margin: 6px 0; padding: 7px 10px; border-radius: 7px; border-left: 4px solid #3b82f6; background: rgba(59, 130, 246, 0.12); font-size: 0.9em; text-align: left; }
.mf-callout-tip { border-left-color: #10b981; background: rgba(16, 185, 129, 0.12); }
.mf-callout-warning, .mf-callout-caution { border-left-color: #f59e0b; background: rgba(245, 158, 11, 0.14); }
.mf-callout-important { border-left-color: #8b5cf6; background: rgba(139, 92, 246, 0.14); }
.mf-callout-title { font-weight: 700; font-size: 0.76em; letter-spacing: 0.04em; margin-bottom: 3px; }
.mf-fold-badge { position: absolute; top: 50%; transform: translateY(-50%); width: 22px; height: 22px; border-radius: 999px; border: 1.5px solid var(--node-border, #2563eb); background: var(--bg-surface); color: var(--text-primary); font-size: 0.68rem; font-weight: 700; display: grid; place-items: center; }
.mf-fold-badge.side-right { right: -12px; }
.mf-fold-badge.side-left { left: -12px; }
.mf-fold-badge.side-down { left: 50%; top: auto; bottom: -12px; transform: translateX(-50%); }
`;

function buildStaticNodeCardXhtml(
  node: MindMapNode,
  info: LayoutNodeInfo,
  doc: MindMapDocument,
  offsetX: number,
  offsetY: number
): string {
  const isRoot = info.depth === 0;
  const shape = node.style?.shape || "rounded";
  const fontSize = node.style?.fontSize ?? (isRoot ? 16 : 14);
  const textAlign = node.style?.align || (isRoot ? "center" : "left");
  const useCustomColors = doc.colorMode === "custom";
  const hasCustomFill = Boolean(useCustomColors && node.style?.color && node.style.color !== "none");
  const hasExplicitNoFill = Boolean(useCustomColors && node.style?.color === "none");
  const borderColor = useCustomColors
    ? node.style?.borderColor || node.style?.edgeColor || info.branchColor
    : info.branchColor;

  const styleParts = [
    `left:${info.x + offsetX}px`,
    `top:${info.y + offsetY}px`,
    `width:${info.width}px`,
    `min-height:${info.height}px`,
    `font-size:${fontSize}px`,
    `text-align:${textAlign}`,
    `--node-border:${borderColor}`,
    `border-color:${borderColor}`,
  ];

  if (isRoot && !hasCustomFill && !hasExplicitNoFill) {
    styleParts.push(`background:${info.branchColor}`);
    styleParts.push(
      `color:${
        (useCustomColors ? node.style?.textColor : undefined) ||
        getContrastTextColor(info.branchColor)
      }`
    );
  } else if (hasCustomFill && node.style?.color) {
    styleParts.push(`background:${node.style.color}`);
    styleParts.push(
      `color:${node.style.textColor || getContrastTextColor(node.style.color)}`
    );
  } else if (useCustomColors && node.style?.textColor) {
    styleParts.push(`color:${node.style.textColor}`);
  }

  const stickersHtml =
    node.stickers && node.stickers.length > 0
      ? `<div class="mf-node-stickers">${node.stickers
          .map((st) => `<span>${escapeXml(st)}</span>`)
          .join("")}</div>`
      : "";

  const renderImages = (imgs: NodeImage[]) => {
    if (imgs.length === 0) return "";
    return `<div class="mf-node-images">${imgs
      .map((img) => {
        const alignSelf =
          img.align === "center"
            ? "center"
            : img.align === "right"
            ? "flex-end"
            : "flex-start";
        const w = img.width || 180;
        const fit = img.fit || "contain";
        const hStyle = img.height ? `height:${img.height}px;` : "height:auto;";
        const caption = img.caption
          ? `<figcaption class="mf-img-caption">${escapeXml(img.caption)}</figcaption>`
          : "";
        return `<figure class="mf-node-img-wrap" style="width:${w}px;align-self:${alignSelf};"><img src="${escapeXml(
          img.url
        )}" alt="${escapeXml(img.caption || img.name)}" style="width:100%;object-fit:${fit};${hStyle}" />${caption}</figure>`;
      })
      .join("")}</div>`;
  };

  const topImages = (node.images || []).filter((img) => img.position !== "bottom");
  const bottomImages = (node.images || []).filter((img) => img.position === "bottom");
  const contentXhtml = html5ToXhtmlFragment(renderRichNodeContent(node.text));

  const foldSideClass =
    info.side === "left" ? "side-left" : info.side === "down" ? "side-down" : "side-right";
  const foldBadge =
    node.collapsed && node.childrenIds.length > 0
      ? `<div class="mf-fold-badge ${foldSideClass}">+${node.childrenIds.length}</div>`
      : "";

  return `<div class="mf-node shape-${shape}${isRoot ? " is-root" : ""}" style="${escapeXml(
    styleParts.join(";")
  )}">${stickersHtml}${renderImages(topImages)}<div class="mf-node-content">${
    contentXhtml || "<span>&#160;</span>"
  }</div>${renderImages(bottomImages)}${foldBadge}</div>`;
}

function getThemeVars(isDark: boolean): Record<string, string> {
  if (typeof window !== "undefined" && typeof document !== "undefined") {
    const cs = getComputedStyle(document.documentElement);
    const read = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    return {
      "--bg-canvas": read("--bg-canvas", isDark ? "#0b1120" : "#f4f7fb"),
      "--bg-surface": read("--bg-surface", isDark ? "#131c31" : "#ffffff"),
      "--bg-elevated": read("--bg-elevated", isDark ? "#1e293b" : "#f1f5f9"),
      "--text-primary": read("--text-primary", isDark ? "#f1f5f9" : "#0f172a"),
      "--text-muted": read("--text-muted", isDark ? "#94a3b8" : "#475569"),
      "--border-color": read("--border-color", isDark ? "#334155" : "#cbd5e1"),
      "--accent-color": read("--accent-color", isDark ? "#60a5fa" : "#2563eb"),
      "--dot-color": read("--dot-color", isDark ? "#1e293b" : "#cbd5e1"),
      "--grid-line-color": read("--grid-line-color", isDark ? "#172033" : "#e2e8f0"),
    };
  }
  return {
    "--bg-canvas": isDark ? "#0b1120" : "#f4f7fb",
    "--bg-surface": isDark ? "#131c31" : "#ffffff",
    "--bg-elevated": isDark ? "#1e293b" : "#f1f5f9",
    "--text-primary": isDark ? "#f1f5f9" : "#0f172a",
    "--text-muted": isDark ? "#94a3b8" : "#475569",
    "--border-color": isDark ? "#334155" : "#cbd5e1",
    "--accent-color": isDark ? "#60a5fa" : "#2563eb",
    "--dot-color": isDark ? "#1e293b" : "#cbd5e1",
    "--grid-line-color": isDark ? "#172033" : "#e2e8f0",
  };
}

/**
 * Synchronous rich SVG builder (works in both browser and Node/Vitest).
 * Renders tree branches, behind/above cross-links, and full rich XHTML node cards
 * (images, emojis/stickers, code snippets, KaTeX math, Mermaid diagrams, tables, checklists).
 */
export function buildExportSvgString(
  doc: MindMapDocument,
  layouts: Record<string, LayoutNodeInfo>,
  isDark: boolean
): string {
  const items = Object.values(layouts);
  if (items.length === 0) return "<svg xmlns='http://www.w3.org/2000/svg'></svg>";

  const { width, height, offsetX, offsetY } = computeExportBounds(doc, layouts);
  const vars = getThemeVars(isDark);
  const bg = vars["--bg-canvas"];
  const surfaceBg = vars["--bg-surface"];

  const branchPaths: string[] = [];
  for (const node of Object.values(doc.nodes)) {
    const pLayout = layouts[node.id];
    if (!pLayout || node.collapsed) continue;
    for (const cid of node.childrenIds) {
      const cLayout = layouts[cid];
      if (!cLayout) continue;
      const d = buildConnectorPath(pLayout, cLayout, doc.connectorStyle, doc.layout);
      const sw = Math.max(1.8, 3.2 - cLayout.depth * 0.4);
      branchPaths.push(
        `<path d="${d}" fill="none" stroke="${cLayout.branchColor}" stroke-width="${sw}" stroke-linecap="round" />`
      );
    }
  }

  const behindLinks = buildExportCrossLinksLayer(doc, layouts, "behind", surfaceBg);
  const aboveLinks = buildExportCrossLinksLayer(doc, layouts, "above", surfaceBg);

  const cardsHtml = items
    .map((info) => {
      const node = doc.nodes[info.id];
      return node ? buildStaticNodeCardXhtml(node, info, doc, offsetX, offsetY) : "";
    })
    .join("");

  const varDecls = Object.entries(vars)
    .map(([k, v]) => `${k}:${v}`)
    .join(";");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style><![CDATA[${escapeCdata(FALLBACK_EXPORT_CSS)}]]></style>
    ${behindLinks.defs}
    ${aboveLinks.defs}
  </defs>
  <rect width="100%" height="100%" fill="${bg}" />
  <g transform="translate(${offsetX},${offsetY})">
    ${branchPaths.join("\n    ")}
    ${behindLinks.body}
  </g>
  <foreignObject x="0" y="0" width="${width}" height="${height}">
    <div xmlns="http://www.w3.org/1999/xhtml" class="mf-export-root" style="width:${width}px;height:${height}px;color-scheme:${
      isDark ? "dark" : "light"
    };${escapeXml(varDecls)}">${cardsHtml}</div>
  </foreignObject>
  <g transform="translate(${offsetX},${offsetY})">
    ${aboveLinks.body}
  </g>
</svg>`;
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read blob as data URL"));
    reader.readAsDataURL(blob);
  });
}

async function inlineImageToDataUrl(src: string, liveImg?: HTMLImageElement | null): Promise<string | null> {
  if (!src) return null;
  if (src.startsWith("data:")) return src;

  try {
    const absoluteUrl = new URL(src, window.location.href).href;
    const resp = await fetch(absoluteUrl, { credentials: "same-origin" });
    if (resp.ok) {
      const blob = await resp.blob();
      return await blobToDataUrl(blob);
    }
  } catch {
    // Fallback to drawing an already-loaded same-origin image via canvas
  }

  if (liveImg && liveImg.complete && liveImg.naturalWidth > 0 && liveImg.naturalHeight > 0) {
    try {
      const c = document.createElement("canvas");
      c.width = liveImg.naturalWidth;
      c.height = liveImg.naturalHeight;
      const ctx = c.getContext("2d");
      if (ctx) {
        ctx.drawImage(liveImg, 0, 0);
        return c.toDataURL("image/png");
      }
    } catch {
      // Cross-origin image without CORS headers cannot be read from canvas
    }
  }

  return null;
}

async function resolveFontUrlToDataUrl(fontUrl: string): Promise<string | null> {
  const cached = fontDataUrlCache.get(fontUrl);
  if (cached) return cached;
  try {
    const resp = await fetch(fontUrl, { credentials: "same-origin" });
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const dataUrl = await blobToDataUrl(blob);
    fontDataUrlCache.set(fontUrl, dataUrl);
    return dataUrl;
  } catch {
    return null;
  }
}

async function collectExportCssText(includeKatexFonts: boolean): Promise<string> {
  if (typeof document === "undefined") return FALLBACK_EXPORT_CSS;
  const collected: string[] = [FALLBACK_EXPORT_CSS];
  const fontTasks: Array<{ index: number; ruleText: string; baseHref: string }> = [];

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    const baseHref = sheet.href || window.location.href;
    for (const rule of Array.from(rules)) {
      const text = rule.cssText;
      if (!text) continue;
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        if (!includeKatexFonts) continue;
        const idx = collected.length;
        collected.push("");
        fontTasks.push({ index: idx, ruleText: text, baseHref });
        continue;
      }
      collected.push(text);
    }
  }

  if (fontTasks.length > 0) {
    await Promise.all(
      fontTasks.map(async ({ index, ruleText, baseHref }) => {
        const woff2Match = ruleText.match(/url\((["']?)([^)"']+\.woff2(?:\?[^)"']*)?)\1\)/i);
        const fallbackMatch =
          woff2Match || ruleText.match(/url\((["']?)([^)"']+)\1\)/i);
        if (!fallbackMatch) {
          collected[index] = ruleText;
          return;
        }
        const rawUrl = fallbackMatch[2];
        if (rawUrl.startsWith("data:")) {
          collected[index] = ruleText;
          return;
        }
        let absUrl: string;
        try {
          absUrl = new URL(rawUrl, baseHref).href;
        } catch {
          return;
        }
        const dataUrl = await resolveFontUrlToDataUrl(absUrl);
        if (!dataUrl) return;
        const fmt = woff2Match ? ' format("woff2")' : "";
        collected[index] = ruleText.replace(
          /src\s*:\s*[^;}]+;?/i,
          `src: url("${dataUrl}")${fmt};`
        );
      })
    );
  }

  return collected.filter(Boolean).join("\n");
}

/**
 * Browser-grade rich SVG exporter that clones the live rendered mind map DOM
 * (preserving exact KaTeX formulas with embedded woff2 fonts, syntax-highlighted code snippets,
 * Mermaid diagrams, inlined images, emojis/stickers, tables, checklists, shapes, colors, and cross-links).
 */
export async function buildRichExportSvgString(
  doc: MindMapDocument,
  layouts: Record<string, LayoutNodeInfo>,
  isDark: boolean,
  options?: { worldEl?: HTMLElement | null }
): Promise<string> {
  const items = Object.values(layouts);
  if (items.length === 0) return "<svg xmlns='http://www.w3.org/2000/svg'></svg>";

  if (typeof document === "undefined" || typeof XMLSerializer === "undefined") {
    return buildExportSvgString(doc, layouts, isDark);
  }

  const { width, height, offsetX, offsetY } = computeExportBounds(doc, layouts);
  const vars = getThemeVars(isDark);
  const bg = vars["--bg-canvas"];
  const surfaceBg = vars["--bg-surface"];

  const branchPaths: string[] = [];
  for (const node of Object.values(doc.nodes)) {
    const pLayout = layouts[node.id];
    if (!pLayout || node.collapsed) continue;
    for (const cid of node.childrenIds) {
      const cLayout = layouts[cid];
      if (!cLayout) continue;
      const d = buildConnectorPath(pLayout, cLayout, doc.connectorStyle, doc.layout);
      const sw = Math.max(1.8, 3.2 - cLayout.depth * 0.4);
      branchPaths.push(
        `<path d="${d}" fill="none" stroke="${cLayout.branchColor}" stroke-width="${sw}" stroke-linecap="round" />`
      );
    }
  }

  const behindLinks = buildExportCrossLinksLayer(doc, layouts, "behind", surfaceBg);
  const aboveLinks = buildExportCrossLinksLayer(doc, layouts, "above", surfaceBg);

  const exportRoot = document.createElementNS("http://www.w3.org/1999/xhtml", "div") as HTMLDivElement;
  exportRoot.className = "mf-export-root";
  exportRoot.style.width = `${width}px`;
  exportRoot.style.height = `${height}px`;
  exportRoot.style.colorScheme = isDark ? "dark" : "light";
  for (const [k, v] of Object.entries(vars)) {
    exportRoot.style.setProperty(k, v);
  }

  const worldEl = options?.worldEl || null;
  const imageInlineTasks: Promise<void>[] = [];
  let hasKatexMath = false;

  for (const info of items) {
    const node = doc.nodes[info.id];
    if (!node) continue;

    const liveCard = worldEl
      ? (Array.from(worldEl.querySelectorAll<HTMLElement>("[data-node-id]")).find(
          (el) => el.getAttribute("data-node-id") === info.id
        ) ?? null)
      : null;

    if (liveCard && !liveCard.classList.contains("is-editing")) {
      const clone = liveCard.cloneNode(true) as HTMLElement;
      clone.classList.remove(
        "is-selected",
        "is-editing",
        "is-dragging",
        "is-drop-target",
        "is-crosslink-source"
      );
      clone
        .querySelectorAll(
          ".mf-quick-add-btn, .mf-node-resize-e, .mf-node-resize-s, .mf-node-resize-se, .mf-img-actions, .mf-img-resize-handle, .mf-copy-code-btn, .mf-node-meta-row"
        )
        .forEach((el) => el.remove());

      if (!node.collapsed) {
        clone.querySelectorAll(".mf-fold-badge").forEach((el) => el.remove());
      }

      // Preserve checkbox checked state for XML serialization
      const liveInputs = liveCard.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      const cloneInputs = clone.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
      cloneInputs.forEach((input, idx) => {
        const checked = liveInputs[idx]?.checked ?? input.hasAttribute("checked");
        if (checked) input.setAttribute("checked", "checked");
        else input.removeAttribute("checked");
      });

      if (clone.querySelector(".katex")) {
        hasKatexMath = true;
      }

      // Use explicit left/top instead of CSS transform to avoid Safari foreignObject clipping
      clone.style.transform = "none";
      clone.style.left = `${info.x + offsetX}px`;
      clone.style.top = `${info.y + offsetY}px`;
      clone.style.width = `${info.width}px`;
      clone.style.minHeight = `${info.height}px`;
      clone.style.maxWidth = "none";
      clone.style.transition = "none";
      clone.style.contain = "none";

      const liveImgs = liveCard.querySelectorAll<HTMLImageElement>("img");
      const cloneImgs = clone.querySelectorAll<HTMLImageElement>("img");
      cloneImgs.forEach((cImg, idx) => {
        const rawSrc = cImg.getAttribute("src") || liveImgs[idx]?.currentSrc || liveImgs[idx]?.src || "";
        imageInlineTasks.push(
          inlineImageToDataUrl(rawSrc, liveImgs[idx]).then((dataUrl) => {
            if (dataUrl) {
              cImg.setAttribute("src", dataUrl);
            }
          })
        );
      });

      exportRoot.appendChild(clone);
    } else {
      const tempHost = document.createElement("div");
      tempHost.innerHTML = buildStaticNodeCardXhtml(node, info, doc, offsetX, offsetY);
      const cardEl = tempHost.firstElementChild as HTMLElement | null;
      if (cardEl) {
        if (cardEl.querySelector(".katex")) {
          hasKatexMath = true;
        }
        cardEl.querySelectorAll<HTMLImageElement>("img").forEach((cImg) => {
          const rawSrc = cImg.getAttribute("src") || "";
          imageInlineTasks.push(
            inlineImageToDataUrl(rawSrc).then((dataUrl) => {
              if (dataUrl) cImg.setAttribute("src", dataUrl);
            })
          );
        });
        exportRoot.appendChild(cardEl);
      }
    }
  }

  await Promise.all(imageInlineTasks);
  const cssText = await collectExportCssText(hasKatexMath);
  const serializedRoot = new XMLSerializer().serializeToString(exportRoot);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style><![CDATA[${escapeCdata(cssText)}]]></style>
    ${behindLinks.defs}
    ${aboveLinks.defs}
  </defs>
  <rect width="100%" height="100%" fill="${bg}" />
  <g transform="translate(${offsetX},${offsetY})">
    ${branchPaths.join("\n    ")}
    ${behindLinks.body}
  </g>
  <foreignObject x="0" y="0" width="${width}" height="${height}">
    ${serializedRoot}
  </foreignObject>
  <g transform="translate(${offsetX},${offsetY})">
    ${aboveLinks.body}
  </g>
</svg>`;
}

export async function exportMapAsSvg(
  doc: MindMapDocument,
  layouts: Record<string, LayoutNodeInfo>,
  isDark: boolean,
  options?: { worldEl?: HTMLElement | null }
) {
  const svg = await buildRichExportSvgString(doc, layouts, isDark, options);
  triggerDownload(`${safeSlug(doc.title)}.svg`, svg, "image/svg+xml;charset=utf-8");
}

export async function exportMapAsPng(
  doc: MindMapDocument,
  layouts: Record<string, LayoutNodeInfo>,
  isDark: boolean,
  options?: { worldEl?: HTMLElement | null }
) {
  const svg = await buildRichExportSvgString(doc, layouts, isDark, options);
  const { width, height } = computeExportBounds(doc, layouts);
  const vars = getThemeVars(isDark);
  const bg = vars["--bg-canvas"];

  // Use base64 data URI so SVG foreignObject does not taint canvas in WebKit/Safari
  const loadSvgImage = async (): Promise<HTMLImageElement> => {
    const loadFromSrc = (src: string) =>
      new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error("Failed to rasterize mind map image"));
        el.src = src;
      });

    try {
      return await loadFromSrc(`data:image/svg+xml;base64,${encodeUtf8Base64(svg)}`);
    } catch {
      const blobUrl = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
      try {
        return await loadFromSrc(blobUrl);
      } finally {
        URL.revokeObjectURL(blobUrl);
      }
    }
  };

  const img = await loadSvgImage();
  if (typeof img.decode === "function") {
    try {
      await img.decode();
    } catch {
      // Ignore decode rejection when onload already completed
    }
  }

  const maxCanvasDim = 8192;
  const maxScaleForDim = maxCanvasDim / Math.max(width, height, 1);
  const scale = Math.max(0.5, Math.min(2, maxScaleForDim));

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);

  const pngBlob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/png")
  );
  if (pngBlob) {
    triggerDownload(`${safeSlug(doc.title)}.png`, pngBlob, "image/png");
  }
}

function buildDocumentFromSubtreeBranches(
  branches: SubtreeBranch[],
  fallbackTitle: string,
  metaHints?: Partial<MindMapDocument>
): MindMapDocument {
  if (branches.length === 0) {
    return createBlankMap(fallbackTitle);
  }

  const nodes: Record<string, MindMapNode> = {};
  const rootIds: string[] = [];

  const attachChildren = (
    parentId: string,
    children: SubtreeBranch[],
    inheritedSide?: "left" | "right"
  ) => {
    const parent = nodes[parentId];
    if (!parent) return;
    children.forEach((child, idx) => {
      const cid = makeId("node");
      const side =
        parent.parentId === null
          ? (idx % 2 === 0 ? "right" : "left")
          : inheritedSide;
      nodes[cid] = {
        id: cid,
        parentId,
        childrenIds: [],
        text: child.text,
        side,
      };
      parent.childrenIds.push(cid);
      attachChildren(cid, child.children, side);
    });
  };

  for (const branch of branches) {
    const rootId = makeId("root");
    rootIds.push(rootId);
    nodes[rootId] = {
      id: rootId,
      parentId: null,
      childrenIds: [],
      text: branch.text,
      style: { shape: "rounded", fontSize: 16 },
    };
    attachChildren(rootId, branch.children);
  }

  const firstTitle =
    branches[0]?.text.split("\n")[0].replace(/[*#`]/g, "").trim().slice(0, 60) || fallbackTitle;

  return normalizeImportedDocument(
    {
      ...metaHints,
      title: firstTitle,
      rootIds,
      nodes,
      crossLinks: [],
    },
    fallbackTitle
  );
}

interface ParsedXmlElement {
  tag: string;
  attrs: Record<string, string>;
  children: ParsedXmlElement[];
  textContent: string;
}

function parseSimpleXml(xml: string): ParsedXmlElement | null {
  if (typeof DOMParser !== "undefined") {
    const parsed = new DOMParser().parseFromString(xml, "application/xml");
    if (!parsed.querySelector("parsererror") && parsed.documentElement) {
      const convert = (el: Element): ParsedXmlElement => {
        const attrs: Record<string, string> = {};
        for (const attr of Array.from(el.attributes)) {
          attrs[attr.name] = attr.value;
        }
        return {
          tag: el.tagName.toLowerCase(),
          attrs,
          children: Array.from(el.children).map(convert),
          textContent: el.textContent || "",
        };
      };
      return convert(parsed.documentElement);
    }
  }

  // Pure-JS lightweight XML parser fallback for Node/Vitest environments
  const stripped = xml
    .replace(/<\?[\s\S]*?\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .trim();
  const tokenRe = /<(\/?)([A-Za-z_][\w:.-]*)((?:\s+[A-Za-z_][\w:.-]*\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  const stack: ParsedXmlElement[] = [];
  let root: ParsedXmlElement | null = null;
  let match: RegExpExecArray | null;

  while ((match = tokenRe.exec(stripped))) {
    if (match[5] !== undefined) {
      if (stack.length > 0) {
        stack[stack.length - 1].textContent += unescapeXml(match[5]);
      }
      continue;
    }
    const isClosing = match[1] === "/";
    const tag = match[2].toLowerCase();
    const rawAttrs = match[3] || "";
    const isSelfClosing = match[4] === "/";

    if (isClosing) {
      while (stack.length > 0) {
        const popped = stack.pop()!;
        if (popped.tag === tag) break;
      }
      continue;
    }

    const attrs: Record<string, string> = {};
    const attrRe = /([A-Za-z_][\w:.-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let am: RegExpExecArray | null;
    while ((am = attrRe.exec(rawAttrs))) {
      attrs[am[1]] = unescapeXml(am[2] ?? am[3] ?? "");
    }

    const elem: ParsedXmlElement = { tag, attrs, children: [], textContent: "" };
    if (stack.length > 0) {
      stack[stack.length - 1].children.push(elem);
    } else if (!root) {
      root = elem;
    }
    if (!isSelfClosing) {
      stack.push(elem);
    }
  }

  return root;
}

function importFreeMindXml(rawText: string, fallbackTitle: string): MindMapDocument {
  const rootEl = parseSimpleXml(rawText);
  if (!rootEl || rootEl.tag !== "map") {
    throw new Error("Invalid FreeMind (.mm) file");
  }

  let mapMeta: Partial<MindMapDocument> = {};
  if (rootEl.attrs.LAZYMINDMAP_META) {
    try {
      mapMeta = JSON.parse(decodeUtf8Base64(rootEl.attrs.LAZYMINDMAP_META)) as Partial<MindMapDocument>;
    } catch {
      mapMeta = {};
    }
  }

  const nodes: Record<string, MindMapNode> = {};
  const rootIds: string[] = [];
  const idMap = new Map<string, string>();

  const walkMm = (el: ParsedXmlElement, parentId: string | null): string => {
    const oldId = el.attrs.ID;
    const id = parentId === null ? makeId("root") : makeId("node");
    if (oldId) idMap.set(oldId, id);

    const style: NodeStyle = {};
    if (el.attrs.BACKGROUND_COLOR) style.color = el.attrs.BACKGROUND_COLOR;
    if (el.attrs.COLOR) style.textColor = el.attrs.COLOR;
    if (el.attrs.BORDER_COLOR) style.borderColor = el.attrs.BORDER_COLOR;
    if (el.attrs.STYLE && VALID_SHAPES.has(el.attrs.STYLE as NodeShape)) {
      style.shape = el.attrs.STYLE as NodeShape;
    }
    if (el.attrs.TEXT_ALIGN && VALID_ALIGNS.has(el.attrs.TEXT_ALIGN as NodeAlign)) {
      style.align = el.attrs.TEXT_ALIGN as NodeAlign;
    }
    if (el.attrs.MAX_WIDTH && Number.isFinite(Number(el.attrs.MAX_WIDTH))) {
      style.width = Number(el.attrs.MAX_WIDTH);
    }
    if (el.attrs.MIN_HEIGHT && Number.isFinite(Number(el.attrs.MIN_HEIGHT))) {
      style.minHeight = Number(el.attrs.MIN_HEIGHT);
    }

    let notes: string | undefined;
    const childNodeEls: ParsedXmlElement[] = [];

    for (const child of el.children) {
      if (child.tag === "node") {
        childNodeEls.push(child);
      } else if (child.tag === "edge" && child.attrs.COLOR) {
        style.edgeColor = child.attrs.COLOR;
        if (!style.borderColor) style.borderColor = child.attrs.COLOR;
      } else if (child.tag === "font" && child.attrs.SIZE) {
        const sizeNum = Number(child.attrs.SIZE);
        if (Number.isFinite(sizeNum) && sizeNum > 0) style.fontSize = sizeNum;
      } else if (child.tag === "richcontent" && child.attrs.TYPE?.toUpperCase() === "NOTE") {
        const trimmed = child.textContent.trim();
        if (trimmed) notes = trimmed;
      }
    }

    let stickers: string[] | undefined;
    if (el.attrs.STICKERS) {
      try {
        const parsedStickers = JSON.parse(el.attrs.STICKERS);
        if (Array.isArray(parsedStickers)) stickers = parsedStickers.map(String);
      } catch {
        // ignore invalid stickers
      }
    }

    let images: NodeImage[] | undefined;
    if (el.attrs.IMAGES) {
      try {
        const parsedImages = JSON.parse(decodeUtf8Base64(el.attrs.IMAGES));
        if (Array.isArray(parsedImages)) images = parsedImages;
      } catch {
        // ignore invalid images
      }
    }

    const posX = el.attrs.POS_X !== undefined ? Number(el.attrs.POS_X) : NaN;
    const posY = el.attrs.POS_Y !== undefined ? Number(el.attrs.POS_Y) : NaN;
    const position =
      parentId === null && Number.isFinite(posX) && Number.isFinite(posY)
        ? { x: posX, y: posY }
        : undefined;

    const side =
      el.attrs.POSITION === "left" || el.attrs.POSITION === "right"
        ? (el.attrs.POSITION as "left" | "right")
        : undefined;

    const node: MindMapNode = {
      id,
      parentId,
      childrenIds: [],
      text: el.attrs.TEXT || "Topic",
      notes,
      collapsed: el.attrs.FOLDED?.toLowerCase() === "true" || undefined,
      side,
      position,
      style: cleanStyle(style),
      stickers,
      images,
    };
    nodes[id] = node;

    for (const childEl of childNodeEls) {
      const cid = walkMm(childEl, id);
      node.childrenIds.push(cid);
    }
    return id;
  };

  for (const child of rootEl.children) {
    if (child.tag === "node") {
      rootIds.push(walkMm(child, null));
    }
  }

  const remappedCrossLinks: CrossLink[] = (mapMeta.crossLinks || [])
    .map((xl) => {
      const fromId = idMap.get(xl.fromId);
      const toId = idMap.get(xl.toId);
      if (!fromId || !toId) return null;
      return { ...xl, id: makeId("xl"), fromId, toId };
    })
    .filter((xl): xl is CrossLink => Boolean(xl));

  return normalizeImportedDocument(
    {
      ...mapMeta,
      rootIds,
      nodes,
      crossLinks: remappedCrossLinks,
    },
    fallbackTitle
  );
}

export function importMapFromFileContent(filename: string, rawText: string): MindMapDocument {
  const lower = filename.toLowerCase();
  const fallbackTitle = filename.replace(/\.[^.]+$/, "") || "Imported Mind Map";

  if (lower.endsWith(".mup")) {
    const parsed = JSON.parse(rawText) as {
      title?: string;
      attr?: {
        theme?: ThemeId;
        colorMode?: ColorMode;
        layout?: LayoutMode;
        connectorStyle?: ConnectorStyle;
        horizontalGap?: number;
        backgroundPattern?: CanvasBackground;
      };
      ideas?: Record<string, any>;
      links?: Array<any>;
    };

    const nodes: Record<string, MindMapNode> = {};
    const rootIds: string[] = [];
    const oldToNewId = new Map<string, string>();

    const walkMup = (
      idea: any,
      parentId: string | null,
      currentId: string,
      side?: "left" | "right"
    ) => {
      if (idea.id !== undefined && idea.id !== null) {
        oldToNewId.set(String(idea.id), currentId);
      }

      const rawStyle = idea.attr?.style || {};
      const style: NodeStyle = {};
      if (rawStyle.background || rawStyle.backgroundColor) {
        style.color = String(rawStyle.background || rawStyle.backgroundColor);
      }
      if (rawStyle.color || rawStyle.textColor) {
        style.textColor = String(rawStyle.color || rawStyle.textColor);
      }
      if (rawStyle.borderColor) style.borderColor = String(rawStyle.borderColor);
      if (rawStyle.edgeColor) style.edgeColor = String(rawStyle.edgeColor);
      const rawFontSize = rawStyle.fontSize ?? rawStyle.font?.size;
      if (typeof rawFontSize === "number" && Number.isFinite(rawFontSize)) {
        style.fontSize = rawFontSize;
      }
      if (rawStyle.align && VALID_ALIGNS.has(rawStyle.align)) style.align = rawStyle.align;
      if (rawStyle.shape && VALID_SHAPES.has(rawStyle.shape)) style.shape = rawStyle.shape;
      if (typeof rawStyle.width === "number" && Number.isFinite(rawStyle.width)) {
        style.width = rawStyle.width;
      }
      if (typeof rawStyle.minHeight === "number" && Number.isFinite(rawStyle.minHeight)) {
        style.minHeight = rawStyle.minHeight;
      }

      const rawPos = idea.attr?.position;
      const position =
        parentId === null &&
        Array.isArray(rawPos) &&
        rawPos.length >= 2 &&
        Number.isFinite(Number(rawPos[0])) &&
        Number.isFinite(Number(rawPos[1]))
          ? { x: Number(rawPos[0]), y: Number(rawPos[1]) }
          : undefined;

      const resolvedSide =
        side ??
        (idea.attr?.side === "left" || idea.attr?.side === "right" ? idea.attr.side : undefined);

      const node: MindMapNode = {
        id: currentId,
        parentId,
        childrenIds: [],
        text: String(idea.title ?? "Topic"),
        notes: idea.attr?.note?.text || undefined,
        collapsed: Boolean(idea.attr?.collapsed) || undefined,
        side: parentId === null ? undefined : resolvedSide,
        position,
        style: cleanStyle(style),
        stickers: Array.isArray(idea.attr?.stickers) ? idea.attr.stickers.map(String) : undefined,
        images: Array.isArray(idea.attr?.images) ? idea.attr.images : undefined,
        attachments: Array.isArray(idea.attr?.attachments) ? idea.attr.attachments : undefined,
      };
      nodes[currentId] = node;

      if (idea.ideas && typeof idea.ideas === "object") {
        const entries = Object.entries(idea.ideas).sort((a, b) => Number(a[0]) - Number(b[0]));
        for (const [rank, childIdea] of entries) {
          if (!childIdea || typeof childIdea !== "object") continue;
          const cid = makeId("node");
          node.childrenIds.push(cid);
          const childSide =
            parentId === null ? (Number(rank) < 0 ? "left" : "right") : resolvedSide;
          walkMup(childIdea, currentId, cid, childSide);
        }
      }
    };

    if (parsed.ideas && typeof parsed.ideas === "object") {
      const topEntries = Object.entries(parsed.ideas).sort((a, b) => Number(a[0]) - Number(b[0]));
      for (const [, rootIdea] of topEntries) {
        if (!rootIdea || typeof rootIdea !== "object") continue;
        const rid = makeId("root");
        rootIds.push(rid);
        walkMup(rootIdea, null, rid);
      }
    }

    const crossLinks: CrossLink[] = Array.isArray(parsed.links)
      ? parsed.links
          .map((lnk) => {
            const fromId = oldToNewId.get(String(lnk.ideaIdFrom));
            const toId = oldToNewId.get(String(lnk.ideaIdTo));
            if (!fromId || !toId || fromId === toId) return null;
            const strokeStyle = lnk.attr?.style?.lineStyle as CrossLinkStrokeStyle | undefined;
            const layer = lnk.attr?.layer as CrossLinkLayer | undefined;
            const startHead = lnk.attr?.startHead as CrossLinkHeadType | undefined;
            const endHead = lnk.attr?.endHead as CrossLinkHeadType | undefined;
            const xl: CrossLink = {
              id: makeId("xl"),
              fromId,
              toId,
              label: typeof lnk.attr?.label === "string" ? lnk.attr.label : undefined,
              color: typeof lnk.attr?.style?.color === "string" ? lnk.attr.style.color : undefined,
              strokeStyle:
                strokeStyle === "dashed" || strokeStyle === "dotted" || strokeStyle === "solid"
                  ? strokeStyle
                  : undefined,
              layer: layer === "above" || layer === "behind" ? layer : undefined,
              startHead,
              endHead,
            };
            return xl;
          })
          .filter((xl): xl is CrossLink => Boolean(xl))
      : [];

    if (rootIds.length === 0) {
      return createBlankMap(parsed.title || fallbackTitle);
    }

    return normalizeImportedDocument(
      {
        title: parsed.title || nodes[rootIds[0]]?.text.split("\n")[0] || fallbackTitle,
        rootIds,
        nodes,
        crossLinks,
        theme: parsed.attr?.theme,
        colorMode: parsed.attr?.colorMode,
        layout: parsed.attr?.layout,
        connectorStyle: parsed.attr?.connectorStyle,
        horizontalGap: parsed.attr?.horizontalGap,
        backgroundPattern: parsed.attr?.backgroundPattern,
      },
      fallbackTitle
    );
  }

  if (lower.endsWith(".mm") || lower.endsWith(".xml")) {
    return importFreeMindXml(rawText, fallbackTitle);
  }

  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".txt")) {
    let metaHints: Partial<MindMapDocument> | undefined;
    const metaMatch = rawText.match(MD_META_REGEX);
    const strippedMd = rawText.replace(MD_META_REGEX, "").trim();

    if (metaMatch) {
      const [, expectedHash, encoded] = metaMatch;
      try {
        const embedded = JSON.parse(decodeUtf8Base64(encoded)) as MindMapDocument;
        if (embedded && embedded.nodes && embedded.rootIds) {
          if (fnv1aHash(strippedMd) === expectedHash.toLowerCase()) {
            return normalizeImportedDocument(embedded, fallbackTitle);
          }
          // User edited the Markdown externally: preserve map settings while parsing their edits
          metaHints = {
            theme: embedded.theme,
            colorMode: embedded.colorMode,
            layout: embedded.layout,
            connectorStyle: embedded.connectorStyle,
            horizontalGap: embedded.horizontalGap,
            backgroundPattern: embedded.backgroundPattern,
          };
        }
      } catch {
        // Ignore corrupted comment metadata and parse plain Markdown
      }
    }

    const branches = parseMarkdownToSubtree(strippedMd);
    return buildDocumentFromSubtreeBranches(branches, fallbackTitle, metaHints);
  }

  // Native LazyMindmap JSON
  const doc = JSON.parse(rawText) as MindMapDocument;
  if (!doc.nodes || !doc.rootIds) {
    throw new Error("Unsupported mind map JSON format");
  }
  return normalizeImportedDocument(doc, fallbackTitle);
}
