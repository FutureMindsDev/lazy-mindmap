import katex from "katex";
import "katex/contrib/mhchem";
import hljs from "highlight.js";
import { marked } from "marked";
import DOMPurify from "dompurify";

interface TokenEntry {
  html: string;
}

const BARE_LATEX_ENVS =
  "(?:equation\\*?|align\\*?|aligned|gather\\*?|gathered|pmatrix|bmatrix|vmatrix|Bmatrix|matrix|cases|array|split)";

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function encodeUtf8Base64(text: string): string {
  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(text, "utf8").toString("base64");
    }
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  } catch {
    return "";
  }
}

export function decodeUtf8Base64(encoded: string): string {
  try {
    if (typeof Buffer !== "undefined") {
      return Buffer.from(encoded, "base64").toString("utf8");
    }
    const binary = atob(encoded);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function renderKatexSafe(tex: string, displayMode: boolean): string {
  const cleaned = tex.trim();
  if (!cleaned) return "";
  try {
    return katex.renderToString(cleaned, {
      displayMode,
      throwOnError: false,
      strict: false,
      trust: false,
    });
  } catch {
    const safe = escapeHtml(cleaned);
    return displayMode ? `<pre class="mf-math-fallback">$$${safe}$$</pre>` : `<code>$${safe}$</code>`;
  }
}

/**
 * Lightweight offline SVG renderer for common Mermaid flowchart & sequence diagrams.
 * Falls back gracefully to a styled code block for exotic diagram types.
 */
function renderMermaidSvg(source: string): string {
  const lines = source
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("%%"));

  if (lines.length === 0) {
    return `<pre class="mf-code-pre"><code>${escapeHtml(source)}</code></pre>`;
  }

  const header = lines[0].toLowerCase();
  if (header.startsWith("flowchart") || header.startsWith("graph")) {
    const horizontal = /\b(lr|rl)\b/i.test(header);
    const nodes = new Map<string, string>();
    const edges: Array<{ from: string; to: string; label?: string }> = [];

    const parseNodeToken = (tok: string): { id: string; label: string } => {
      const m = tok.match(/^([A-Za-z0-9_.-]+)\s*(?:\[\s*(.*?)\s*\]|\(\s*(.*?)\s*\)|\{\s*(.*?)\s*\})?$/);
      if (!m) return { id: tok, label: tok };
      const id = m[1];
      const label = (m[2] ?? m[3] ?? m[4] ?? id).replace(/^["']|["']$/g, "");
      return { id, label };
    };

    for (const line of lines.slice(1)) {
      const edgeMatch = line.match(
        /^(.+?)\s*(?:--+>|==+>|-\.->|--\s*([^->]+?)\s*-->|--\|([^|]+)\|-->)\s*(.+)$/
      );
      if (edgeMatch) {
        const left = parseNodeToken(edgeMatch[1].trim());
        const right = parseNodeToken(edgeMatch[4].trim());
        const label = (edgeMatch[2] || edgeMatch[3] || "").trim() || undefined;
        if (!nodes.has(left.id)) nodes.set(left.id, left.label);
        if (!nodes.has(right.id)) nodes.set(right.id, right.label);
        edges.push({ from: left.id, to: right.id, label });
      } else {
        const solo = parseNodeToken(line);
        if (solo.id && !nodes.has(solo.id)) {
          nodes.set(solo.id, solo.label);
        }
      }
    }

    if (nodes.size > 0) {
      const nodeList = Array.from(nodes.entries());
      const boxW = 132;
      const boxH = 38;
      const gap = 46;
      const pad = 18;
      const positions = new Map<string, { x: number; y: number }>();

      nodeList.forEach(([id], idx) => {
        const x = horizontal ? pad + idx * (boxW + gap) : pad;
        const y = horizontal ? pad : pad + idx * (boxH + gap);
        positions.set(id, { x, y });
      });

      const svgW = horizontal
        ? pad * 2 + nodeList.length * boxW + Math.max(0, nodeList.length - 1) * gap
        : pad * 2 + boxW + 60;
      const svgH = horizontal
        ? pad * 2 + boxH + 24
        : pad * 2 + nodeList.length * boxH + Math.max(0, nodeList.length - 1) * gap;

      const edgeSvg = edges
        .map((e) => {
          const a = positions.get(e.from);
          const b = positions.get(e.to);
          if (!a || !b) return "";
          const x1 = horizontal ? a.x + boxW : a.x + boxW / 2;
          const y1 = horizontal ? a.y + boxH / 2 : a.y + boxH;
          const x2 = horizontal ? b.x : b.x + boxW / 2;
          const y2 = horizontal ? b.y + boxH / 2 : b.y;
          const mx = (x1 + x2) / 2;
          const my = (y1 + y2) / 2;
          const path = horizontal
            ? `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`
            : `M ${x1} ${y1} C ${x1} ${my}, ${x2} ${my}, ${x2} ${y2}`;
          const labelSvg = e.label
            ? `<text x="${mx}" y="${my - 5}" text-anchor="middle" class="mf-mermaid-edge-label">${escapeHtml(e.label)}</text>`
            : "";
          return `<path d="${path}" fill="none" stroke="currentColor" stroke-width="1.6" marker-end="url(#mf-arrow)" opacity="0.7" />${labelSvg}`;
        })
        .join("");

      const boxSvg = nodeList
        .map(([id, label]) => {
          const pos = positions.get(id)!;
          return `<g transform="translate(${pos.x},${pos.y})">
            <rect width="${boxW}" height="${boxH}" rx="8" class="mf-mermaid-box" />
            <text x="${boxW / 2}" y="${boxH / 2 + 4}" text-anchor="middle" class="mf-mermaid-text">${escapeHtml(
              label.length > 18 ? `${label.slice(0, 17)}…` : label
            )}</text>
          </g>`;
        })
        .join("");

      return `<div class="mf-mermaid-diagram" role="img" aria-label="Mermaid flowchart">
        <div class="mf-code-header"><span class="mf-code-lang">mermaid</span></div>
        <svg viewBox="0 0 ${svgW} ${svgH}" width="${Math.min(svgW, 460)}" class="mf-mermaid-svg">
          <defs>
            <marker id="mf-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
              <path d="M 0 1 L 10 5 L 0 9 z" fill="currentColor" />
            </marker>
          </defs>
          ${edgeSvg}
          ${boxSvg}
        </svg>
      </div>`;
    }
  }

  return `<div class="mf-code-block">
    <div class="mf-code-header">
      <span class="mf-code-lang">mermaid</span>
      <button type="button" class="mf-copy-code-btn" data-code-b64="${encodeUtf8Base64(source)}">Copy</button>
    </div>
    <pre class="mf-code-pre"><code>${escapeHtml(source)}</code></pre>
  </div>`;
}

function renderCodeBlock(code: string, lang: string): string {
  const normalizedLang = lang.trim().toLowerCase();

  // Gemini / Markdown fenced math blocks
  if (normalizedLang === "math" || normalizedLang === "latex" || normalizedLang === "tex") {
    return `<div class="mf-math-block">${renderKatexSafe(code, true)}</div>`;
  }

  // Mermaid diagrams-in-a-node
  if (normalizedLang === "mermaid") {
    return renderMermaidSvg(code);
  }

  let highlighted = "";
  let resolvedLang = normalizedLang;
  try {
    if (normalizedLang && hljs.getLanguage(normalizedLang)) {
      highlighted = hljs.highlight(code, { language: normalizedLang }).value;
    } else {
      const auto = hljs.highlightAuto(code);
      highlighted = auto.value;
      resolvedLang = resolvedLang || auto.language || "text";
    }
  } catch {
    highlighted = escapeHtml(code);
  }

  const label = escapeHtml(resolvedLang || "code");
  const encoded = encodeUtf8Base64(code);

  return `<div class="mf-code-block">
    <div class="mf-code-header">
      <span class="mf-code-lang">${label}</span>
      <button type="button" class="mf-copy-code-btn" data-code-b64="${encoded}">Copy</button>
    </div>
    <pre class="mf-code-pre"><code class="hljs">${highlighted}</code></pre>
  </div>`;
}

/**
 * Heuristically rejects plain-prose currency ranges like "$100 to $200"
 * while accepting spaced or unspaced math like "$ x^2 + y^2 $" or "$E=mc^2$".
 */
function looksLikeCurrency(inner: string, afterCloseChar: string): boolean {
  const trimmed = inner.trim();
  if (!trimmed) return true;
  if (/\d/.test(afterCloseChar)) {
    // e.g. "$100 to $200" -> closing '$' immediately precedes '200'
    if (/^\s*\d[\d,.]*(?:\s+[a-zA-Z]+|\s*$)/.test(inner)) {
      return true;
    }
  }
  if (/^\s*\d[\d,.]*\s+[a-zA-Z]{2,}/.test(inner) && !/[\\^_=+\-*/<>(){}]/.test(inner)) {
    return true;
  }
  return false;
}

function sanitizeMarkdownHtml(html: string): string {
  if (typeof window === "undefined") {
    // Pure Node/SSR test safety strip of script tags & inline event handlers
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/\son[a-z]+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  }

  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p",
      "br",
      "strong",
      "b",
      "em",
      "i",
      "del",
      "s",
      "u",
      "h1",
      "h2",
      "h3",
      "h4",
      "h5",
      "h6",
      "ul",
      "ol",
      "li",
      "blockquote",
      "a",
      "img",
      "table",
      "thead",
      "tbody",
      "tr",
      "th",
      "td",
      "hr",
      "code",
      "pre",
      "span",
      "div",
      "input",
    ],
    ALLOWED_ATTR: [
      "href",
      "src",
      "alt",
      "title",
      "class",
      "type",
      "checked",
      "target",
      "rel",
      "data-checkbox-line",
      "align",
    ],
    ALLOW_ARIA_ATTR: true,
    ALLOW_DATA_ATTR: true,
  });
}

function decorateCheckboxesAndAlerts(html: string, sourceMarkdown: string): string {
  // Attach checkbox line indices matching source `- [ ]` / `- [x]` lines in order
  const checkboxLines: number[] = [];
  const rawLines = sourceMarkdown.split(/\r?\n/);
  rawLines.forEach((line, idx) => {
    if (/^\s*(?:[-*+]|\d+\.)\s+\[[ xX]\]\s+/.test(line)) {
      checkboxLines.push(idx);
    }
  });

  let cbCursor = 0;
  let processed = html.replace(
    /<input([^>]*type=["']checkbox["'][^>]*)>/gi,
    (_full, attrs: string) => {
      const lineIndex = checkboxLines[cbCursor++] ?? -1;
      const cleanedAttrs = attrs.replace(/\s*disabled(?:=["'][^"']*["'])?/gi, "");
      return `<input${cleanedAttrs} class="mf-task-checkbox" data-checkbox-line="${lineIndex}">`;
    }
  );

  // Transform GitHub-style admonition blockquotes (> [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION])
  processed = processed.replace(
    /<blockquote>\s*<p>\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:<br\s*\/?>|\s)*([\s\S]*?)<\/p>([\s\S]*?)<\/blockquote>/gi,
    (_m, rawKind: string, firstBody: string, rest: string) => {
      const kind = rawKind.toLowerCase();
      return `<div class="mf-callout mf-callout-${kind}"><div class="mf-callout-title">${rawKind.toUpperCase()}</div><div class="mf-callout-body"><p>${firstBody}</p>${rest}</div></div>`;
    }
  );

  // Ensure external links open safely in new tab
  processed = processed.replace(
    /<a\s+([^>]*href=["']https?:\/\/[^"']+["'][^>]*)>/gi,
    (_m, attrs: string) => {
      if (/target=/i.test(attrs)) return `<a ${attrs}>`;
      return `<a ${attrs} target="_blank" rel="noopener noreferrer">`;
    }
  );

  return processed;
}

/**
 * Renders node Markdown containing universal LLM math delimiters ($...$, $$...$$,
 * \(...\), \[...\], \\(...\\), \\[...\\], $`...`$, ```math/latex, bare \begin{...}),
 * syntax-highlighted code blocks, Mermaid diagrams, GFM tables, alerts, and interactive checkboxes.
 */
export function renderRichNodeContent(markdown: string): string {
  if (!markdown) return "";

  const tokens: TokenEntry[] = [];
  const hold = (html: string): string => {
    const idx = tokens.length;
    tokens.push({ html });
    return `@@MFTOKEN_${idx}@@`;
  };

  let text = markdown.replace(/\r\n?/g, "\n");

  // 1. Fenced code blocks (supports ```math, ```latex, ```tex, ```mermaid, and code highlighting)
  text = text.replace(
    /(^|\n)[ \t]*(`{3,}|~{3,})([^\n`]*)\n([\s\S]*?)\n?[ \t]*\2(?=\n|$)/g,
    (_full, prefix: string, _fence: string, info: string, code: string) => {
      const lang = info.trim().split(/\s+/)[0] || "";
      return `${prefix}${hold(renderCodeBlock(code, lang))}`;
    }
  );

  // 2. GitHub / GitLab inline math: $`...`$
  text = text.replace(/\$`([^`\n]+?)`\$/g, (_m, tex: string) => {
    return hold(`<span class="mf-math-inline">${renderKatexSafe(tex, false)}</span>`);
  });

  // 3. Inline code spans (single or multiple backticks) protected before math scanning
  text = text.replace(/(`+)([^`]|[^`][\s\S]*?[^`])\1/g, (_m, _ticks: string, code: string) => {
    return hold(`<code class="mf-inline-code">${escapeHtml(code.trim())}</code>`);
  });

  // 4. Double-escaped block math: \\[ ... \\]
  text = text.replace(/\\\\\[([\s\S]+?)\\\\\]/g, (_m, tex: string) => {
    return hold(`<div class="mf-math-block">${renderKatexSafe(tex, true)}</div>`);
  });

  // 5. Block math: $$ ... $$
  text = text.replace(/(^|[^\\])\$\$([\s\S]+?)\$\$/g, (_m, lead: string, tex: string) => {
    return `${lead}${hold(`<div class="mf-math-block">${renderKatexSafe(tex, true)}</div>`)}`;
  });

  // 6. Block math: \[ ... \] (ChatGPT, DeepSeek, Gemini)
  text = text.replace(/\\\[([\s\S]+?)\\\]/g, (_m, tex: string) => {
    return hold(`<div class="mf-math-block">${renderKatexSafe(tex, true)}</div>`);
  });

  // 7. Bare top-level LaTeX environments (Claude, DeepSeek)
  const bareEnvRegex = new RegExp(
    `\\\\begin\\{(${BARE_LATEX_ENVS})\\}([\\s\\S]+?)\\\\end\\{\\1\\}`,
    "g"
  );
  text = text.replace(bareEnvRegex, (fullMatch: string) => {
    return hold(`<div class="mf-math-block">${renderKatexSafe(fullMatch, true)}</div>`);
  });

  // 8. Double-escaped inline math: \\( ... \\)
  text = text.replace(/\\\\\(([\s\S]+?)\\\\\)/g, (_m, tex: string) => {
    return hold(`<span class="mf-math-inline">${renderKatexSafe(tex, false)}</span>`);
  });

  // 9. Inline math: \( ... \) (ChatGPT, DeepSeek, Gemini)
  text = text.replace(/\\\(([\s\S]+?)\\\)/g, (_m, tex: string) => {
    return hold(`<span class="mf-math-inline">${renderKatexSafe(tex, false)}</span>`);
  });

  // 10. Single-dollar inline math: $ ... $ with currency disambiguation
  text = text.replace(/(^|[^\\$])\$([^\n$]+?)\$(?!\$)/g, (full, lead: string, inner: string, offset: number, whole: string) => {
    const afterIdx = offset + full.length;
    const afterChar = whole[afterIdx] || "";
    if (looksLikeCurrency(inner, afterChar)) {
      return full;
    }
    return `${lead}${hold(`<span class="mf-math-inline">${renderKatexSafe(inner, false)}</span>`)}`;
  });

  // Parse remaining Markdown cleanly with GFM + soft breaks
  const rawHtml = marked.parse(text, {
    gfm: true,
    breaks: true,
    async: false,
  }) as string;

  const decorated = decorateCheckboxesAndAlerts(rawHtml, markdown);
  const sanitized = sanitizeMarkdownHtml(decorated);

  // Restore protected KaTeX, code, and Mermaid tokens
  // Note: marked may wrap standalone block tokens in <p>@@MFTOKEN_N@@</p>
  let restored = sanitized.replace(/<p>\s*(@@MFTOKEN_(\d+)@@)\s*<\/p>/g, (_m, _tok, idStr: string) => {
    const entry = tokens[Number(idStr)];
    return entry ? entry.html : "";
  });

  restored = restored.replace(/@@MFTOKEN_(\d+)@@/g, (_m, idStr: string) => {
    const entry = tokens[Number(idStr)];
    return entry ? entry.html : "";
  });

  return restored.trim();
}

/**
 * Checks whether a node's text contains rich Markdown, LaTeX math, or code
 * worth displaying in the live preview while editing (Option A editor).
 */
export function hasRichSyntax(markdown: string): boolean {
  if (!markdown) return false;
  return (
    /(?:\$|\\\(|\\\[|\\begin\{|```|`[^`]+`|\*\*|__|~~|^\s*[-*+]\s+\[[ xX]\]|\|.+\||\n#{1,6}\s|^>\s)/m.test(
      markdown
    )
  );
}

/**
 * Smart Clipboard Paste Interceptor:
 * Detects KaTeX / MathJax / LLM DOM copy HTML (from ChatGPT, Claude, Gemini, DeepSeek, Perplexity)
 * and extracts clean TeX into $...$ / $$...$$ without duplicating .katex-html + .katex-mathml text.
 */
export function extractMarkdownFromHtml(html: string): string {
  if (!html) return "";
  if (typeof DOMParser === "undefined") {
    // Non-DOM (SSR/Node) fallback for KaTeX/MathML <annotation encoding="application/x-tex"> extraction
    let cleaned = html
      .replace(
        /<span[^>]*class=["'][^"']*katex-display[^"']*["'][^>]*>[\s\S]*?<annotation[^>]*encoding=["']application\/x-tex["'][^>]*>([\s\S]*?)<\/annotation>[\s\S]*?<\/span>(?:\s*<\/span>)*/gi,
        (_m, tex: string) => `\n$$\n${tex.trim()}\n$$\n`
      )
      .replace(
        /<span[^>]*class=["'][^"']*katex["'][^>]*>[\s\S]*?<annotation[^>]*encoding=["']application\/x-tex["'][^>]*>([\s\S]*?)<\/annotation>[\s\S]*?<\/span>(?:\s*<\/span>)*/gi,
        (_m, tex: string) => `$${tex.trim()}$`
      )
      .replace(/<span[^>]*class=["'][^"']*katex-html[^"']*["'][^>]*>[\s\S]*?<\/span>/gi, "")
      .replace(/<[^>]+>/g, "");
    return cleaned.replace(/\n{3,}/g, "\n\n").trim();
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // 1. Replace KaTeX containers (.katex-display / .katex) using <annotation encoding="application/x-tex">
  doc.querySelectorAll(".katex-display").forEach((el) => {
    const ann = el.querySelector('annotation[encoding="application/x-tex"]');
    const tex = ann?.textContent?.trim();
    if (tex) {
      el.replaceWith(doc.createTextNode(`\n$$\n${tex}\n$$\n`));
    }
  });

  doc.querySelectorAll(".katex").forEach((el) => {
    const ann = el.querySelector('annotation[encoding="application/x-tex"]');
    const tex = ann?.textContent?.trim();
    if (tex) {
      el.replaceWith(doc.createTextNode(`$${tex}$`));
    }
  });

  // 2. Replace standalone MathML <math> nodes with tex annotations
  doc.querySelectorAll("math").forEach((el) => {
    const ann = el.querySelector('annotation[encoding="application/x-tex"]');
    const tex = ann?.textContent?.trim();
    if (tex) {
      const isBlock = el.getAttribute("display") === "block";
      el.replaceWith(doc.createTextNode(isBlock ? `\n$$\n${tex}\n$$\n` : `$${tex}$`));
    }
  });

  // 3. Replace [data-math] / [data-latex] elements (Gemini / custom UIs)
  doc.querySelectorAll("[data-math], [data-latex]").forEach((el) => {
    const tex = (el.getAttribute("data-math") || el.getAttribute("data-latex") || "").trim();
    if (tex) {
      const isBlock =
        el.tagName === "DIV" ||
        el.classList.contains("math-block") ||
        el.getAttribute("data-display") === "block";
      el.replaceWith(doc.createTextNode(isBlock ? `\n$$\n${tex}\n$$\n` : `$${tex}$`));
    }
  });

  // 4. Replace MathJax script tags
  doc.querySelectorAll('script[type^="math/tex"]').forEach((el) => {
    const tex = el.textContent?.trim();
    if (tex) {
      const isBlock = (el.getAttribute("type") || "").includes("mode=display");
      el.replaceWith(doc.createTextNode(isBlock ? `\n$$\n${tex}\n$$\n` : `$${tex}$`));
    }
  });

  // 5. Convert common HTML blocks to clean Markdown
  const serializeNode = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent || "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return "";
    }
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    if (tag === "style" || tag === "script" || tag === "noscript") {
      return "";
    }
    if (tag === "br") return "\n";
    if (tag === "pre") {
      const codeEl = el.querySelector("code");
      const rawCode = (codeEl || el).textContent || "";
      const langMatch = (codeEl?.className || el.className || "").match(/language-([a-z0-9_+-]+)/i);
      const lang = langMatch ? langMatch[1] : "";
      return `\n\`\`\`${lang}\n${rawCode.replace(/\n$/, "")}\n\`\`\`\n`;
    }
    if (tag === "code") {
      return `\`${el.textContent || ""}\``;
    }

    const inner = Array.from(el.childNodes).map(serializeNode).join("");

    if (/^h[1-6]$/.test(tag)) {
      const level = Number(tag[1]);
      return `\n${"#".repeat(level)} ${inner.trim()}\n`;
    }
    if (tag === "strong" || tag === "b") return `**${inner}**`;
    if (tag === "em" || tag === "i") return `*${inner}*`;
    if (tag === "del" || tag === "s") return `~~${inner}~~`;
    if (tag === "a") {
      const href = el.getAttribute("href");
      return href ? `[${inner}](${href})` : inner;
    }
    if (tag === "li") {
      const checkbox = el.querySelector('input[type="checkbox"]') as HTMLInputElement | null;
      const prefix = checkbox ? (checkbox.checked ? "- [x] " : "- [ ] ") : "- ";
      return `${prefix}${inner.trim()}\n`;
    }
    if (tag === "ul" || tag === "ol") {
      return `\n${inner}\n`;
    }
    if (tag === "blockquote") {
      const quoted = inner
        .trim()
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
      return `\n${quoted}\n`;
    }
    if (tag === "table") {
      const rows = Array.from(el.querySelectorAll("tr")).map((tr) =>
        Array.from(tr.querySelectorAll("th, td")).map((cell) =>
          (cell.textContent || "").trim().replace(/\|/g, "\\|")
        )
      );
      if (rows.length === 0) return inner;
      const header = `| ${rows[0].join(" | ")} |`;
      const sep = `| ${rows[0].map(() => "---").join(" | ")} |`;
      const body = rows.slice(1).map((r) => `| ${r.join(" | ")} |`).join("\n");
      return `\n${header}\n${sep}${body ? `\n${body}` : ""}\n`;
    }
    if (tag === "p" || tag === "div" || tag === "section" || tag === "article") {
      return `${inner}\n`;
    }
    return inner;
  };

  const md = serializeNode(doc.body)
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return md;
}

export function extractMarkdownFromClipboard(clipboardData: DataTransfer): {
  text: string;
  hasRichHtmlMath: boolean;
} {
  const html = clipboardData.getData("text/html") || "";
  const plain = clipboardData.getData("text/plain") || "";

  const hasMathDom =
    /class=["'][^"']*(?:katex|mathjax|MathJax)[^"']*["']|encoding=["']application\/x-tex["']|data-math=|data-latex=|<math[\s>]/i.test(
      html
    );

  if (html && hasMathDom) {
    const extracted = extractMarkdownFromHtml(html);
    if (extracted) {
      return { text: extracted, hasRichHtmlMath: true };
    }
  }

  return { text: plain, hasRichHtmlMath: false };
}
