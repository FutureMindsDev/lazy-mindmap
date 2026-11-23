import type { MindMapDocument, MindMapNode } from "../types/mindmap";
import type { LayoutNodeInfo } from "../types/mindmap";
import { buildConnectorPath } from "./layoutEngine";
import { parseMarkdownToSubtree } from "./markdownToSubtree";
import { getContrastTextColor } from "./themes";
import { createBlankMap, insertSubtreeBranches, makeId } from "./treeOps";

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
  return (title || "mindforge-map").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "mindforge-map";
}

export function exportMapAsJson(doc: MindMapDocument) {
  triggerDownload(`${safeSlug(doc.title)}.json`, JSON.stringify(doc, null, 2), "application/json");
}

export function exportMapAsMarkdown(doc: MindMapDocument): string {
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
  const md = lines.join("\n\n");
  triggerDownload(`${safeSlug(doc.title)}.md`, md, "text/markdown");
  return md;
}

export function exportMapAsMindMup(doc: MindMapDocument) {
  const toMupIdeas = (id: string): Record<string, unknown> => {
    const node = doc.nodes[id];
    const ideas: Record<string, unknown> = {};
    node.childrenIds.forEach((cid, idx) => {
      const rank = node.side === "left" || doc.nodes[cid]?.side === "left" ? -(idx + 1) : idx + 1;
      ideas[String(rank)] = toMupIdeas(cid);
    });
    return {
      title: node.text,
      id: node.id,
      attr: {
        style:
          node.style?.color && node.style.color !== "none"
            ? { background: node.style.color }
            : undefined,
        note: node.notes ? { text: node.notes } : undefined,
        collapsed: node.collapsed || undefined,
      },
      ideas,
    };
  };

  const primaryRoot = doc.rootIds[0];
  const mup = {
    formatVersion: 3,
    id: doc.id,
    title: doc.title,
    ideas: primaryRoot ? { "1": toMupIdeas(primaryRoot) } : {},
  };
  triggerDownload(`${safeSlug(doc.title)}.mup`, JSON.stringify(mup, null, 2), "application/json");
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function exportMapAsFreeMind(doc: MindMapDocument) {
  const renderMmNode = (id: string): string => {
    const node = doc.nodes[id];
    if (!node) return "";
    const children = node.childrenIds.map(renderMmNode).join("\n");
    const posAttr = node.side ? ` POSITION="${node.side}"` : "";
    const foldedAttr = node.collapsed ? ` FOLDED="true"` : "";
    return `<node TEXT="${escapeXml(node.text)}"${posAttr}${foldedAttr}>\n${children}\n</node>`;
  };
  const primary = doc.rootIds[0];
  const xml = `<map version="1.0.1">\n${primary ? renderMmNode(primary) : ""}\n</map>`;
  triggerDownload(`${safeSlug(doc.title)}.mm`, xml, "application/xml");
}

export function buildExportSvgString(
  doc: MindMapDocument,
  layouts: Record<string, LayoutNodeInfo>,
  isDark: boolean
): string {
  const items = Object.values(layouts);
  if (items.length === 0) return "<svg xmlns='http://www.w3.org/2000/svg'></svg>";

  const pad = 48;
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

  const width = maxX - minX + pad * 2;
  const height = maxY - minY + pad * 2;
  const offsetX = -minX + pad;
  const offsetY = -minY + pad;

  const bg = isDark ? "#0f172a" : "#f8fafc";
  const cardBg = isDark ? "#1e293b" : "#ffffff";
  const textColor = isDark ? "#f1f5f9" : "#0f172a";

  const edges: string[] = [];
  for (const node of Object.values(doc.nodes)) {
    const pLayout = layouts[node.id];
    if (!pLayout || node.collapsed) continue;
    for (const cid of node.childrenIds) {
      const cLayout = layouts[cid];
      if (!cLayout) continue;
      const d = buildConnectorPath(pLayout, cLayout, doc.connectorStyle, doc.layout);
      edges.push(
        `<path d="${d}" fill="none" stroke="${cLayout.branchColor}" stroke-width="2.4" stroke-linecap="round" />`
      );
    }
  }

  const useCustomColors = doc.colorMode === "custom";
  const boxes = items
    .map((info) => {
      const node = doc.nodes[info.id];
      const isRoot = info.depth === 0;
      const customFill =
        useCustomColors && node?.style?.color && node.style.color !== "none"
          ? node.style.color
          : undefined;
      const explicitNoFill = useCustomColors && node?.style?.color === "none";
      const fill = customFill || (isRoot && !explicitNoFill ? info.branchColor : cardBg);
      const stroke =
        useCustomColors && (node?.style?.borderColor || node?.style?.edgeColor)
          ? node.style.borderColor || node.style.edgeColor || info.branchColor
          : info.branchColor;
      const color =
        useCustomColors && node?.style?.textColor
          ? node.style.textColor
          : customFill
          ? getContrastTextColor(customFill)
          : isRoot && !explicitNoFill
          ? getContrastTextColor(info.branchColor)
          : textColor;
      const firstLine = (node?.text || "").split("\n")[0].replace(/[#*`$]/g, "").slice(0, 44);
      return `<g>
        <rect x="${info.x}" y="${info.y}" width="${info.width}" height="${info.height}" rx="12" fill="${fill}" stroke="${stroke}" stroke-width="2" />
        <text x="${info.x + info.width / 2}" y="${info.y + info.height / 2 + 5}" text-anchor="middle" font-family="system-ui, sans-serif" font-size="13" font-weight="${isRoot ? 700 : 500}" fill="${color}">${escapeXml(firstLine)}</text>
      </g>`;
    })
    .join("\n");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="100%" height="100%" fill="${bg}" />
    <g transform="translate(${offsetX},${offsetY})">
      ${edges.join("\n")}
      ${boxes}
    </g>
  </svg>`;
}

export function exportMapAsSvg(
  doc: MindMapDocument,
  layouts: Record<string, LayoutNodeInfo>,
  isDark: boolean
) {
  const svg = buildExportSvgString(doc, layouts, isDark);
  triggerDownload(`${safeSlug(doc.title)}.svg`, svg, "image/svg+xml");
}

export async function exportMapAsPng(
  doc: MindMapDocument,
  layouts: Record<string, LayoutNodeInfo>,
  isDark: boolean
) {
  const svg = buildExportSvgString(doc, layouts, isDark);
  const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("SVG render failed"));
      img.src = url;
    });
    const scale = 2;
    const canvas = document.createElement("canvas");
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    const pngBlob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/png")
    );
    if (pngBlob) {
      triggerDownload(`${safeSlug(doc.title)}.png`, pngBlob, "image/png");
    }
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function importMapFromFileContent(filename: string, rawText: string): MindMapDocument {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".mup")) {
    const parsed = JSON.parse(rawText) as {
      title?: string;
      ideas?: Record<string, any>;
    };
    const rootIdea = parsed.ideas?.["1"];
    const base = createBlankMap(parsed.title || rootIdea?.title || "Imported MindMup");
    const rootId = base.rootIds[0];

    const walkMup = (idea: any, parentId: string | null, currentId: string, side?: "left" | "right") => {
      const node: MindMapNode = {
        id: currentId,
        parentId,
        childrenIds: [],
        text: String(idea.title || "Topic"),
        notes: idea.attr?.note?.text || undefined,
        collapsed: Boolean(idea.attr?.collapsed),
        side,
        style: idea.attr?.style?.background ? { color: idea.attr.style.background } : undefined,
      };
      base.nodes[currentId] = node;
      if (idea.ideas && typeof idea.ideas === "object") {
        const entries = Object.entries(idea.ideas).sort((a, b) => Number(a[0]) - Number(b[0]));
        for (const [rank, childIdea] of entries) {
          const cid = makeId("node");
          node.childrenIds.push(cid);
          const childSide = parentId === null ? (Number(rank) < 0 ? "left" : "right") : side;
          walkMup(childIdea, currentId, cid, childSide);
        }
      }
    };

    if (rootIdea) {
      base.nodes = {};
      walkMup(rootIdea, null, rootId);
      base.title = base.nodes[rootId]?.text.split("\n")[0] || base.title;
    }
    return base;
  }

  if (lower.endsWith(".md") || lower.endsWith(".markdown") || lower.endsWith(".txt")) {
    const branches = parseMarkdownToSubtree(rawText);
    const title = branches[0]?.text.split("\n")[0].slice(0, 60) || filename.replace(/\.[^.]+$/, "");
    const base = createBlankMap(title);
    const rootId = base.rootIds[0];
    if (branches.length === 1) {
      base.nodes[rootId].text = branches[0].text;
      return insertSubtreeBranches(base, rootId, branches[0].children).doc;
    }
    return insertSubtreeBranches(base, rootId, branches).doc;
  }

  // Native MindForge JSON
  const doc = JSON.parse(rawText) as MindMapDocument;
  if (!doc.nodes || !doc.rootIds) {
    throw new Error("Unsupported mind map JSON format");
  }
  return {
    ...doc,
    id: doc.id || makeId("map"),
    crossLinks: doc.crossLinks || [],
    updatedAt: new Date().toISOString(),
  };
}
