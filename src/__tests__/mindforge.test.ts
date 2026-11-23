import { describe, expect, it, vi } from "vitest";
import { extractMarkdownFromHtml, renderRichNodeContent } from "../utils/llmMathNormalizer";
import {
  callLlmProvider,
  findRelatedNodes,
  LlmApiError,
  parseAndApplyLlmResponse,
} from "../utils/llmMindMapAgent";
import { parseMarkdownToSubtree } from "../utils/markdownToSubtree";
import { computeMindMapLayout } from "../utils/layoutEngine";
import {
  addChildNode,
  addDetachedRootNode,
  addSiblingNode,
  applyCollapseState,
  collapseToLevel,
  createBlankMap,
  createInitialMap,
  detachNodeToRoot,
  expandAllNodes,
  getMaxDepth,
  getNodeMoveCapabilities,
  insertParentNode,
  moveNodeRelative,
  removeAllPhotosFromNodes,
  reorderSibling,
  repositionNode,
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

  it("marks task checklist items with mf-task-item without altering rich inline formatting or normal bullets", () => {
    const html = renderRichNodeContent(
      "Tasks:\n- [x] Universal **LLM** math $E=mc^2$\n- [ ] Press `Space` to edit me\n\nBullets:\n- Regular bullet"
    );
    expect(html).toContain('<li class="mf-task-item">');
    expect(html).toContain("mf-task-checkbox");
    expect(html).toContain("<strong>LLM</strong>");
    expect(html).toContain('class="katex"');
    expect(html).toContain('<code class="mf-inline-code">Space</code>');
    expect(html).toContain("<li>Regular bullet</li>");
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

  it("respects custom horizontalGap for edge distance between nodes", () => {
    const doc = createInitialMap();
    const compact = computeMindMapLayout({ ...doc, layout: "tree-right", horizontalGap: 48 });
    const wide = computeMindMapLayout({ ...doc, layout: "tree-right", horizontalGap: 180 });
    const childId = doc.nodes[doc.rootIds[0]].childrenIds[0];
    const compactGap = compact[childId].x - (compact[doc.rootIds[0]].x + compact[doc.rootIds[0]].width);
    const wideGap = wide[childId].x - (wide[doc.rootIds[0]].x + wide[doc.rootIds[0]].width);
    expect(compactGap).toBe(48);
    expect(wideGap).toBe(180);
  });

  it("supports contrast, colorful, and custom node/edge color modes and switches to custom automatically", () => {
    const base = createInitialMap();
    const rootId = base.rootIds[0];
    const firstChildId = base.nodes[rootId].childrenIds[0];

    const contrastLight = computeMindMapLayout({ ...base, colorMode: "contrast" }, undefined, false);
    const contrastDark = computeMindMapLayout({ ...base, colorMode: "contrast" }, undefined, true);
    expect(contrastLight[rootId].branchColor).toBe("#1e293b");
    expect(contrastLight[firstChildId].branchColor).toBe("#1e293b");
    expect(contrastDark[rootId].branchColor).toBe("#e2e8f0");
    expect(contrastDark[firstChildId].branchColor).toBe("#e2e8f0");

    const customDoc = setNodesColor(base, [firstChildId], {
      edgeColor: "#ff00aa",
      borderColor: "#ff00aa",
    });
    expect(customDoc.colorMode).toBe("custom");
    const customLayout = computeMindMapLayout(customDoc);
    expect(customLayout[firstChildId].branchColor).toBe("#ff00aa");
    const grandChildId = customDoc.nodes[firstChildId].childrenIds[0];
    expect(customLayout[grandChildId].branchColor).toBe("#ff00aa");

    const backToColorful = computeMindMapLayout({ ...customDoc, colorMode: "colorful" });
    expect(backToColorful[firstChildId].branchColor).not.toBe("#ff00aa");
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

  it("computes getMaxDepth regardless of collapsed state and preserves collapse state across undo/redo snapshots", () => {
    const blank = createBlankMap();
    expect(getMaxDepth(blank)).toBe(0);

    const initial = createInitialMap();
    expect(getMaxDepth(initial)).toBeGreaterThanOrEqual(2);

    // Collapsing branches does not reduce getMaxDepth
    const collapsedLevel1 = collapseToLevel(initial, 1);
    expect(getMaxDepth(collapsedLevel1)).toBe(getMaxDepth(initial));

    // When nothing differs (treating undefined as false), applyCollapseState returns exact same reference
    const expanded = expandAllNodes(initial);
    expect(applyCollapseState(initial, expanded)).toBe(initial);

    // Copies collapsed state for shared IDs while leaving target-only nodes untouched
    const targetWithExtra = addChildNode(initial, "node-math", "Target only child");
    targetWithExtra.doc.nodes[targetWithExtra.newId].collapsed = true;
    targetWithExtra.doc.nodes["node-code"].collapsed = true;
    const sourceWithChanges = toggleCollapseNode(
      collapseToLevel(initial, 1),
      "node-code"
    );
    const merged = applyCollapseState(targetWithExtra.doc, sourceWithChanges);
    expect(merged).not.toBe(targetWithExtra.doc);
    expect(merged.updatedAt).toBe(targetWithExtra.doc.updatedAt);
    expect(merged.nodes["node-math"].collapsed).toBe(true);
    expect(merged.nodes["node-code"].collapsed).toBe(false);
    expect(merged.nodes[targetWithExtra.newId].collapsed).toBe(true);
  });

  it("reorders same-side siblings up/down and moves branches left/right relative to parent", () => {
    const initial = createInitialMap();
    const beforeLayout = computeMindMapLayout(initial);
    // In starter map: node-math & node-shortcuts are on right; node-code & node-media are on left
    expect(beforeLayout["node-math"].side).toBe("right");
    expect(beforeLayout["node-shortcuts"].side).toBe("right");
    expect(beforeLayout["node-shortcuts"].y).toBeGreaterThan(beforeLayout["node-math"].y);

    // Moving node-shortcuts up swaps it above node-math on the right side
    const movedUp = moveNodeRelative(initial, "node-shortcuts", "up");
    const upLayout = computeMindMapLayout(movedUp);
    expect(upLayout["node-shortcuts"].y).toBeLessThan(upLayout["node-math"].y);
    expect(upLayout["node-code"].side).toBe("left");
    expect(upLayout["node-media"].side).toBe("left");

    // Capabilities reflect top/bottom/side boundaries
    const shortcutsCaps = getNodeMoveCapabilities(movedUp, "node-shortcuts");
    expect(shortcutsCaps).toEqual({
      canMoveUp: false,
      canMoveDown: true,
      canMoveLeft: true,
      canMoveRight: false,
    });

    // Moving node-math from right to left flips both it and its children to left side
    const movedLeft = moveNodeRelative(movedUp, "node-math", "left");
    const leftLayout = computeMindMapLayout(movedLeft);
    expect(leftLayout["node-math"].side).toBe("left");
    expect(leftLayout["node-math"].x).toBeLessThan(leftLayout[movedLeft.rootIds[0]].x);
    expect(leftLayout["node-math-chatgpt"].side).toBe("left");

    // Moving node-math back to right restores it to right side
    const movedBackRight = moveNodeRelative(movedLeft, "node-math", "right");
    expect(computeMindMapLayout(movedBackRight)["node-math"].side).toBe("right");

    // In tree-right mode, moving one child left switches layout to mindmap while preserving other right children
    const treeDoc = { ...initial, layout: "tree-right" as const };
    const treeMovedLeft = moveNodeRelative(treeDoc, "node-code", "left");
    expect(treeMovedLeft.layout).toBe("mindmap");
    const treeMovedLayout = computeMindMapLayout(treeMovedLeft);
    expect(treeMovedLayout["node-code"].side).toBe("left");
    expect(treeMovedLayout["node-math"].side).toBe("right");

    // In org-chart mode, left/right moves siblings horizontally
    const orgDoc = { ...initial, layout: "org-chart" as const };
    const orgBefore = computeMindMapLayout(orgDoc);
    expect(orgBefore["node-code"].x).toBeGreaterThan(orgBefore["node-math"].x);
    const orgSwapped = moveNodeRelative(orgDoc, "node-code", "left");
    const orgAfter = computeMindMapLayout(orgSwapped);
    expect(orgAfter["node-code"].x).toBeLessThan(orgAfter["node-math"].x);
  });

  it("repositions nodes via drag-and-drop before/after siblings, across sides, and inside new parents", () => {
    const initial = createInitialMap();

    // Drag node-math (right) before node-code (left) -> moves to left side above node-code
    const movedToLeftTop = repositionNode(initial, "node-math", "node-code", "before", "left");
    const leftTopLayout = computeMindMapLayout(movedToLeftTop);
    expect(leftTopLayout["node-math"].side).toBe("left");
    expect(leftTopLayout["node-math"].y).toBeLessThan(leftTopLayout["node-code"].y);
    expect(leftTopLayout["node-math-chatgpt"].side).toBe("left");

    // Drag node-math-chatgpt inside node-shortcuts -> reparents under node-shortcuts on right side
    const reparented = repositionNode(movedToLeftTop, "node-math-chatgpt", "node-shortcuts", "inside");
    expect(reparented.nodes["node-math-chatgpt"].parentId).toBe("node-shortcuts");
    expect(reparented.nodes["node-math"].childrenIds).not.toContain("node-math-chatgpt");
    expect(computeMindMapLayout(reparented)["node-math-chatgpt"].side).toBe("right");

    // Dropping a parent inside its own descendant is ignored
    const invalidDrop = repositionNode(initial, "node-math", "node-math-chatgpt", "inside");
    expect(invalidDrop).toBe(initial);
  });
});

describe("LLM Mind Map Assistant Agent", () => {
  it("identifies related existing nodes from user prompt and falls back to selection", () => {
    const doc = createInitialMap();

    const mathMatches = findRelatedNodes(doc, "Update the Universal LLM Math equations", ["node-code"]);
    expect(mathMatches[0].id).toBe("node-math");

    const fallbackMatches = findRelatedNodes(doc, "add three fresh brainstorming ideas", ["node-shortcuts"]);
    expect(fallbackMatches[0].id).toBe("node-shortcuts");
  });

  it("modifies existing nodes, creates child/root nodes, attaches all file types, and reports affected nodes", () => {
    const doc = createInitialMap();
    const uploadedFiles = [
      {
        id: "f-pdf",
        name: "spec.pdf",
        url: "/uploads/spec.pdf",
        mimeType: "application/pdf",
        size: 12000,
      },
      {
        id: "f-zip",
        name: "bundle.zip",
        url: "/uploads/bundle.zip",
        mimeType: "application/zip",
        size: 48000,
      },
      {
        id: "f-img",
        name: "diagram.png",
        url: "/uploads/diagram.png",
        mimeType: "image/png",
        size: 9500,
      },
    ];

    const llmReply = `\`\`\`json
{
  "explanation": "Updated **Universal LLM Math** with Euler's identity, added a branch under **Code, Diagrams & Tables**, and created a new root.",
  "operations": [
    {
      "type": "modify_node",
      "nodeId": "node-math",
      "appendText": "Euler: $e^{i\\\\pi} + 1 = 0$",
      "newNotes": "Derived from Taylor series",
      "attachFiles": true
    },
    {
      "type": "create_child_nodes",
      "parentId": "node-code",
      "branches": [
        {
          "text": "API Reference",
          "children": [{ "text": "POST /api/llm/chat" }]
        }
      ]
    },
    {
      "type": "create_root_node",
      "text": "Deployment Checklist"
    }
  ]
}
\`\`\``;

    const applied = parseAndApplyLlmResponse(doc, llmReply, doc.rootIds[0], uploadedFiles);
    expect(applied.doc.nodes["node-math"].text).toContain("Euler:");
    expect(applied.doc.nodes["node-math"].notes).toBe("Derived from Taylor series");
    expect(applied.doc.nodes["node-math"].attachments).toHaveLength(2);
    expect(applied.doc.nodes["node-math"].attachments?.map((a) => a.name)).toEqual([
      "spec.pdf",
      "bundle.zip",
    ]);
    expect(applied.doc.nodes["node-math"].images).toHaveLength(1);
    expect(applied.doc.nodes["node-math"].images?.[0].name).toBe("diagram.png");

    const codeChildren = applied.doc.nodes["node-code"].childrenIds;
    const apiRefId = codeChildren.find((id) => applied.doc.nodes[id]?.text === "API Reference");
    expect(apiRefId).toBeDefined();
    expect(applied.doc.nodes[apiRefId!].childrenIds).toHaveLength(1);

    expect(applied.doc.rootIds.length).toBe(2);
    expect(applied.affectedNodes.some((n) => n.nodeId === "node-math" && n.action === "modified")).toBe(
      true
    );
    expect(
      applied.affectedNodes.some((n) => n.nodeId === "node-code" && n.action === "created_under")
    ).toBe(true);
    expect(applied.affectedNodes.some((n) => n.action === "created_root")).toBe(true);
  });

  it("falls back to Markdown subtree insertion and reports created nodes when LLM returns plain Markdown", () => {
    const doc = createInitialMap();
    const mdReply = `# Research Plan
- Literature Review
- Prototype`;
    const applied = parseAndApplyLlmResponse(doc, mdReply, "node-code", []);
    expect(applied.doc.nodes["node-code"].childrenIds.length).toBeGreaterThan(
      doc.nodes["node-code"].childrenIds.length
    );
    expect(applied.affectedNodes.some((n) => n.nodeId === "node-code" && n.action === "created_under")).toBe(
      true
    );
    expect(applied.affectedNodes.some((n) => n.action === "created_node")).toBe(true);
  });

  it("rejects missing API key and surfaces exact API error messages", async () => {
    await expect(
      callLlmProvider({
        config: { provider: "openai", apiKey: "   ", model: "gpt-4o-mini" },
        systemPrompt: "sys",
        messages: [],
      })
    ).rejects.toThrow(/API key/i);

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "Incorrect API key provided: sk-bad" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    try {
      await callLlmProvider({
        config: { provider: "openai", apiKey: "sk-bad", model: "gpt-4o-mini" },
        systemPrompt: "sys",
        messages: [
          { id: "m1", role: "user", content: "Hello", createdAt: new Date().toISOString() },
        ],
      });
      expect.unreachable("Expected callLlmProvider to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(LlmApiError);
      expect((err as LlmApiError).message).toBe("Incorrect API key provided: sk-bad");
      expect((err as LlmApiError).status).toBe(401);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
