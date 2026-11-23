import { describe, expect, it } from "vitest";
import { extractMarkdownFromHtml, renderRichNodeContent } from "../utils/llmMathNormalizer";
import { parseMarkdownToSubtree } from "../utils/markdownToSubtree";
import { computeMindMapLayout } from "../utils/layoutEngine";
import {
  addChildNode,
  addDetachedRootNode,
  addSiblingNode,
  collapseToLevel,
  createInitialMap,
  detachNodeToRoot,
  expandAllNodes,
  insertParentNode,
  removeAllPhotosFromNodes,
  reorderSibling,
  resetNodesColor,
  resizeNodesBatch,
  setBatchCollapse,
  setNodesColor,
  toggleAllTasksInNodes,
  toggleBatchFormatting,
  toggleCollapseNode,
  updateBatchPhotoProps,
} from "../utils/treeOps";

describe("Universal LLM Math Normalizer", () => {
  it("renders ChatGPT/DeepSeek \\(...\\) and \\[...\\] delimiters via KaTeX", () => {
    const html = renderRichNodeContent(
      "Inline \\(E = mc^2\\) and block:\n\\[\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n\\]"
    );
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).not.toContain("\\(");
    expect(html).not.toContain("\\[");
  });

  it("renders double-escaped \\\\(...\\\\) and \\\\[...\\\\] delimiters", () => {
    const html = renderRichNodeContent("Inline \\\\(a^2 + b^2 = c^2\\\\) and \\\\[\\sum_{i=1}^n i\\\\]");
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
  });

  it("renders standard $...$, $$...$$, spaced $ x^2 $, and GitHub $`...`$ while protecting underscores", () => {
    const html = renderRichNodeContent(
      "Vars $x_{i,1} + x_{i,2}$, spaced $ y^2 + 1 $, GitHub $`\\alpha + \\beta`$\n$$\nz = \\frac{1}{2}\n$$"
    );
    expect(html).toContain('class="katex"');
    expect(html).toContain('class="katex-display"');
    expect(html).not.toContain("<em>");
  });

  it("keeps plain currency text like $100 to $200 unparsed as plain prose", () => {
    const html = renderRichNodeContent("Budget is $100 to $200 for Q1.");
    expect(html).not.toContain('class="katex"');
    expect(html).toContain("$100 to $200");
  });

  it("renders Claude bare LaTeX environments (align, pmatrix) and mhchem formulas", () => {
    const html = renderRichNodeContent(
      "\\begin{align} a &= b + c \\\\ d &= e + f \\end{align}\n\n\\begin{pmatrix} 1 & 0 \\\\ 0 & 1 \\end{pmatrix}\n\n$\\ce{H2O}$"
    );
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('class="katex"');
  });

  it("renders Gemini ```math and ```latex fenced blocks as KaTeX display math", () => {
    const mathHtml = renderRichNodeContent("```math\n\\nabla \\times \\mathbf{B} = \\mu_0 \\mathbf{J}\n```");
    const latexHtml = renderRichNodeContent("```latex\n\\lim_{x \\to 0} \\frac{\\sin x}{x} = 1\n```");
    expect(mathHtml).toContain('class="katex-display"');
    expect(latexHtml).toContain('class="katex-display"');
  });

  it("renders syntax-highlighted code blocks with Copy button and Mermaid SVG flowcharts", () => {
    const codeHtml = renderRichNodeContent("```python\ndef add(a, b):\n    return a + b\n```");
    expect(codeHtml).toContain("mf-copy-code-btn");
    expect(codeHtml).toContain("hljs-keyword");

    const mermaidHtml = renderRichNodeContent("```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```");
    expect(mermaidHtml).toContain("<svg");
    expect(mermaidHtml).toContain("Start");
  });

  it("extracts KaTeX annotation LaTeX from DOM clipboard HTML without duplicating visual text", () => {
    const chatGptCopiedHtml =
      '<p>Formula: <span class="katex"><span class="katex-mathml"><math><semantics><mrow><mi>E</mi></mrow><annotation encoding="application/x-tex">E = mc^2</annotation></semantics></math></span><span class="katex-html" aria-hidden="true">Emc2</span></span> done.</p>';
    const md = extractMarkdownFromHtml(chatGptCopiedHtml);
    expect(md).toContain("$E = mc^2$");
    expect(md).not.toContain("Emc2");
  });
});

describe("LLM Markdown Subtree Parser", () => {
  it("splits headings, nested lists, code blocks, and block math into hierarchical nodes", () => {
    const md = `# Physics Review
## Kinematics
- Velocity: \\(v = \\frac{dx}{dt}\\)
  - Acceleration: $a = \\frac{dv}{dt}$
## Simulation
\`\`\`python
print("simulating")
\`\`\`
\\[
F = ma
\\]`;

    const branches = parseMarkdownToSubtree(md);
    expect(branches).toHaveLength(1);
    expect(branches[0].text).toBe("Physics Review");
    expect(branches[0].children).toHaveLength(2);
    expect(branches[0].children[0].text).toBe("Kinematics");
    expect(branches[0].children[0].children[0].children[0].text).toContain("Acceleration");
    expect(branches[0].children[1].text).toContain("```python");
    expect(branches[0].children[1].text).toContain("F = ma");
  });
});

describe("Layout Engine and Tree Operations", () => {
  it("computes valid layouts across mindmap, tree-right, and org-chart modes", () => {
    const doc = createInitialMap();
    const radial = computeMindMapLayout(doc);
    expect(Object.keys(radial).length).toBe(Object.keys(doc.nodes).length);

    const tree = computeMindMapLayout({ ...doc, layout: "tree-right" });
    const rootRight = tree[doc.rootIds[0]];
    const childRight = tree[doc.nodes[doc.rootIds[0]].childrenIds[0]];
    expect(childRight.x).toBeGreaterThan(rootRight.x);

    const org = computeMindMapLayout({ ...doc, layout: "org-chart" });
    const rootOrg = org[doc.rootIds[0]];
    const childOrg = org[doc.nodes[doc.rootIds[0]].childrenIds[0]];
    expect(childOrg.y).toBeGreaterThan(rootOrg.y);
  });

  it("supports collapseToLevel, expandAllNodes, toggleCollapseNode, and hierarchy edits", () => {
    let doc = createInitialMap();
    const rootId = doc.rootIds[0];

    // Collapse to level 1 (root children visible, level 2 hidden)
    doc = collapseToLevel(doc, 1);
    let layouts = computeMindMapLayout(doc);
    expect(layouts[doc.nodes[rootId].childrenIds[0]]).toBeDefined();
    expect(layouts["node-math-chatgpt"]).toBeUndefined();

    // Expand all restores grandchildren
    doc = expandAllNodes(doc);
    layouts = computeMindMapLayout(doc);
    expect(layouts["node-math-chatgpt"]).toBeDefined();

    // Fold single branch
    doc = toggleCollapseNode(doc, "node-math");
    expect(doc.nodes["node-math"].collapsed).toBe(true);

    // Add child, sibling above, insert parent, reorder, detach, and detached root
    const childRes = addChildNode(doc, rootId, "Branch X");
    doc = childRes.doc;
    const sibRes = addSiblingNode(doc, childRes.newId, "above", "Branch Before X");
    doc = sibRes.doc;
    const parentChildren = doc.nodes[rootId].childrenIds;
    expect(parentChildren.indexOf(sibRes.newId)).toBeLessThan(parentChildren.indexOf(childRes.newId));

    const insRes = insertParentNode(doc, childRes.newId, "Wrapper");
    doc = insRes.doc;
    expect(doc.nodes[childRes.newId].parentId).toBe(insRes.newId);

    doc = reorderSibling(doc, childRes.newId, -1);
    doc = detachNodeToRoot(doc, childRes.newId, { x: 200, y: 200 });
    expect(doc.rootIds).toContain(childRes.newId);

    const detRes = addDetachedRootNode(doc, { x: 300, y: 300 }, "Detached");
    expect(detRes.doc.rootIds).toContain(detRes.newId);
  });

  it("supports batch color selection, node resizing, task toggling, formatting, and photo actions", () => {
    let doc = createInitialMap();
    const allIds = Object.keys(doc.nodes);

    // 1. Batch color updates + reset across all selected nodes
    doc = setNodesColor(doc, allIds, {
      color: "#1e293b",
      borderColor: "#38bdf8",
      textColor: "#f8fafc",
    });
    for (const id of allIds) {
      expect(doc.nodes[id].style?.color).toBe("#1e293b");
      expect(doc.nodes[id].style?.borderColor).toBe("#38bdf8");
      expect(doc.nodes[id].style?.textColor).toBe("#f8fafc");
    }
    doc = resetNodesColor(doc, allIds);
    expect(doc.nodes[allIds[0]].style?.color).toBeUndefined();

    // 2. Resizable nodes reflected in layout engine
    doc = resizeNodesBatch(doc, ["node-math"], { width: 420, minHeight: 160 });
    const resizedLayout = computeMindMapLayout(doc)["node-math"];
    expect(resizedLayout.width).toBe(420);
    expect(resizedLayout.height).toBeGreaterThanOrEqual(160);
    doc = resizeNodesBatch(doc, ["node-math"], "auto");
    expect(doc.nodes["node-math"].style?.width).toBeUndefined();

    // 3. Batch task toggling & formatting & collapse
    doc = toggleAllTasksInNodes(doc, ["node-media-check"], true);
    expect(doc.nodes["node-media-check"].text).not.toContain("- [ ]");
    doc = toggleBatchFormatting(doc, ["node-math-chatgpt"], "**");
    expect(doc.nodes["node-math-chatgpt"].text.startsWith("**")).toBe(true);
    doc = setBatchCollapse(doc, ["node-math", "node-code"], true);
    expect(doc.nodes["node-math"].collapsed).toBe(true);
    expect(doc.nodes["node-code"].collapsed).toBe(true);

    // 4. Photo actions across selected nodes
    doc.nodes["node-media"].images = [
      { id: "img-1", url: "/uploads/test.png", name: "test.png", width: 180 },
    ];
    doc = updateBatchPhotoProps(doc, allIds, {
      width: 300,
      position: "bottom",
      align: "center",
      fit: "cover",
      caption: "Architecture",
    });
    expect(doc.nodes["node-media"].images?.[0].width).toBe(300);
    expect(doc.nodes["node-media"].images?.[0].position).toBe("bottom");
    expect(doc.nodes["node-media"].images?.[0].caption).toBe("Architecture");

    doc = removeAllPhotosFromNodes(doc, ["node-media"]);
    expect(doc.nodes["node-media"].images).toEqual([]);
  });
});
