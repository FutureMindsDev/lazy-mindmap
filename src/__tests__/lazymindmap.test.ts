import { describe, expect, it, vi } from "vitest";
import type { LayoutNodeInfo } from "../types/mindmap";
import {
  buildExportSvgString,
  importMapFromFileContent,
  serializeMapAsFreeMind,
  serializeMapAsMarkdown,
  serializeMapAsMindMup,
} from "../utils/exporters";
import { extractMarkdownFromHtml, renderRichNodeContent } from "../utils/llmMathNormalizer";
import {
  callLlmProvider,
  createNewConversation,
  deriveConversationTitle,
  findRelatedNodes,
  LLM_CONVERSATIONS_STORAGE_KEY,
  LLM_HISTORY_STORAGE_KEY,
  LlmApiError,
  loadLlmConversations,
  parseAndApplyLlmResponse,
  saveLlmConversations,
} from "../utils/llmMindMapAgent";
import { parseMarkdownToSubtree } from "../utils/markdownToSubtree";
import {
  buildCrossLinkPath,
  clampCrossLinkLabel,
  computeFitViewport,
  computeMindMapLayout,
  countSentences,
  getNodeEdgeMidpoint,
  MAX_CROSSLINK_LABEL_CHARS,
  MAX_CROSSLINK_LABEL_SENTENCES,
  ROOT_TREE_GAP,
  wrapCrossLinkLabelLines,
} from "../utils/layoutEngine";
import {
  addChildNode,
  addDetachedRootNode,
  addSiblingNode,
  applyCollapseState,
  collapseToLevel,
  computeDragDropHint,
  createBlankMap,
  createInitialMap,
  detachNodesToRoots,
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

  it("derives conversation titles, migrates legacy history, and persists conversations without heavy dataUrls", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => {
        store.set(k, v);
      },
      removeItem: (k: string) => {
        store.delete(k);
      },
    });

    try {
      expect(deriveConversationTitle([])).toBe("New Conversation");
      expect(
        deriveConversationTitle([
          {
            id: "u1",
            role: "user",
            content: "# Add **Quantum Computing**\nwith `qubits` and gates for beginners and experts",
            createdAt: "2026-11-24T00:00:00.000Z",
          },
        ])
      ).toBe("Add Quantum Computing with qubits and g…");

      // Legacy migration from lazymindmap:llmChatHistory
      store.set(
        LLM_HISTORY_STORAGE_KEY,
        JSON.stringify([
          {
            id: "legacy-1",
            role: "user",
            content: "Summarize physics nodes",
            createdAt: "2026-11-24T00:00:00.000Z",
          },
        ])
      );
      const migrated = loadLlmConversations();
      expect(migrated).toHaveLength(1);
      expect(migrated[0].title).toBe("Summarize physics nodes");
      expect(migrated[0].messages).toHaveLength(1);

      // Saving strips dataUrl blobs while retaining metadata
      const conv = createNewConversation([
        {
          id: "m-file",
          role: "user",
          content: "Inspect PDF",
          createdAt: "2026-11-24T00:01:00.000Z",
          files: [
            {
              id: "f1",
              name: "paper.pdf",
              url: "/uploads/paper.pdf",
              mimeType: "application/pdf",
              size: 2048,
              dataUrl: "data:application/pdf;base64,AAAA",
            },
          ],
        },
      ]);
      saveLlmConversations([conv, ...migrated]);
      const rawSaved = store.get(LLM_CONVERSATIONS_STORAGE_KEY);
      expect(rawSaved).toBeDefined();
      expect(rawSaved).not.toContain("data:application/pdf;base64,AAAA");

      const reloaded = loadLlmConversations();
      expect(reloaded).toHaveLength(2);
      expect(reloaded[0].messages[0].files?.[0].name).toBe("paper.pdf");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe("Cross-Link Label Limits and Smart Behind-Layer Placement", () => {
  it("enforces max 5 sentences and ~500 char limit for cross-link labels and wraps cleanly", () => {
    expect(countSentences("")).toBe(0);
    expect(countSentences("v1.2 connects cleanly. Next?")).toBe(2);

    const fiveSentences =
      "First sentence. Second sentence! Third sentence? Fourth sentence. Fifth sentence.";
    expect(countSentences(fiveSentences)).toBe(MAX_CROSSLINK_LABEL_SENTENCES);
    expect(clampCrossLinkLabel(fiveSentences)).toBe(fiveSentences);

    const sixSentences = `${fiveSentences} Sixth sentence should be trimmed.`;
    expect(clampCrossLinkLabel(sixSentences)).toBe(fiveSentences);

    const longProse = "a".repeat(MAX_CROSSLINK_LABEL_CHARS + 120);
    expect(clampCrossLinkLabel(longProse).length).toBe(MAX_CROSSLINK_LABEL_CHARS);

    const wrapped = wrapCrossLinkLabelLines(fiveSentences, 36);
    expect(wrapped.length).toBeGreaterThan(1);
    expect(wrapped.join(" ")).toBe(fiveSentences);
  });

  it("relocates obscured Behind-layer cross-link labels to the middle of available horizontal space and elevates label alone when map has no free space", () => {
    const from: LayoutNodeInfo = {
      id: "from",
      x: 0,
      y: 100,
      width: 120,
      height: 50,
      depth: 1,
      branchColor: "#2563eb",
      side: "left",
      rootId: "root",
    };
    const to: LayoutNodeInfo = {
      id: "to",
      x: 520,
      y: 100,
      width: 120,
      height: 50,
      depth: 1,
      branchColor: "#2563eb",
      side: "right",
      rootId: "root",
    };
    const blocker: LayoutNodeInfo = {
      id: "blocker",
      x: 240,
      y: 80,
      width: 140,
      height: 120,
      depth: 0,
      branchColor: "#2563eb",
      side: "center",
      rootId: "root",
    };

    // Unobscured Behind layer keeps default midpoint
    const clearBehind = buildCrossLinkPath(from, to, {
      layouts: { from, to },
      label: "depends on",
      layer: "behind",
    });
    expect(clearBehind.relocated).toBe(false);
    expect(clearBehind.forceLabelAbove).toBe(false);

    // Above layer stays at default midpoint even over a node
    const aboveOverNode = buildCrossLinkPath(from, to, {
      layouts: { from, to, blocker },
      label: "depends on",
      layer: "above",
    });
    expect(aboveOverNode.relocated).toBe(false);
    expect(aboveOverNode.forceLabelAbove).toBe(false);

    // Obscured Behind layer relocates into the open horizontal gap [380, 520] (middle ~450)
    const relocated = buildCrossLinkPath(from, to, {
      layouts: { from, to, blocker },
      label: "depends on",
      layer: "behind",
    });
    expect(relocated.relocated).toBe(true);
    expect(relocated.forceLabelAbove).toBe(false);
    expect(relocated.labelX).toBeGreaterThan(blocker.x + blocker.width);
    expect(relocated.labelX).toBeLessThan(to.x);

    // Densely packed map with no free horizontal or vertical space elevates text label alone
    const denseLayouts: Record<string, LayoutNodeInfo> = { from, to };
    let idx = 0;
    for (let x = 110; x <= 480; x += 110) {
      for (let y = 40; y <= 260; y += 60) {
        const id = `dense-${idx++}`;
        denseLayouts[id] = {
          id,
          x,
          y,
          width: 104,
          height: 54,
          depth: 1,
          branchColor: "#2563eb",
          side: "right",
          rootId: "root",
        };
      }
    }
    const denseResult = buildCrossLinkPath(from, to, {
      layouts: denseLayouts,
      label: "Dense cross-link dependency label",
      layer: "behind",
    });
    expect(denseResult.forceLabelAbove).toBe(true);
  });

  it("anchors cross-link endpoints to the middle edge of each node rather than node centers", () => {
    const leftNode: LayoutNodeInfo = {
      id: "left",
      x: 100,
      y: 200,
      width: 140,
      height: 60,
      depth: 1,
      branchColor: "#2563eb",
      side: "left",
      rootId: "root",
    };
    const rightNode: LayoutNodeInfo = {
      id: "right",
      x: 420,
      y: 200,
      width: 160,
      height: 80,
      depth: 1,
      branchColor: "#2563eb",
      side: "right",
      rootId: "root",
    };
    const bottomNode: LayoutNodeInfo = {
      id: "bottom",
      x: 110,
      y: 400,
      width: 120,
      height: 50,
      depth: 2,
      branchColor: "#2563eb",
      side: "down",
      rootId: "root",
    };

    const horizontalLink = buildCrossLinkPath(leftNode, rightNode);
    expect(horizontalLink.startPoint).toEqual({ x: 240, y: 230, side: "right" });
    expect(horizontalLink.endPoint).toEqual({ x: 420, y: 240, side: "left" });
    expect(horizontalLink.path.startsWith("M 240 230 Q ")).toBe(true);
    expect(horizontalLink.path.endsWith(" 420 240")).toBe(true);

    const verticalLink = buildCrossLinkPath(leftNode, bottomNode);
    expect(verticalLink.startPoint).toEqual({ x: 170, y: 260, side: "bottom" });
    expect(verticalLink.endPoint).toEqual({ x: 170, y: 400, side: "top" });

    expect(getNodeEdgeMidpoint(leftNode, 0, 230)).toEqual({ x: 100, y: 230, side: "left" });
    expect(getNodeEdgeMidpoint(leftNode, 170, 50)).toEqual({ x: 170, y: 200, side: "top" });
  });
});

describe("Multi-Root Non-Overlapping Layout & Node No-Fill State", () => {
  const getTreeBounds = (layouts: Record<string, LayoutNodeInfo>, rootId: string) => {
    const items = Object.values(layouts).filter((n) => n.rootId === rootId);
    return {
      minX: Math.min(...items.map((n) => n.x)),
      minY: Math.min(...items.map((n) => n.y)),
      maxX: Math.max(...items.map((n) => n.x + n.width)),
      maxY: Math.max(...items.map((n) => n.y + n.height)),
    };
  };

  const getMinNodePairGap = (
    layouts: Record<string, LayoutNodeInfo>,
    rootA: string,
    rootB: string
  ) => {
    const nodesA = Object.values(layouts).filter((n) => n.rootId === rootA);
    const nodesB = Object.values(layouts).filter((n) => n.rootId === rootB);
    let minGap = Infinity;
    for (const a of nodesA) {
      for (const b of nodesB) {
        const dx = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width));
        const dy = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height));
        minGap = Math.min(minGap, Math.max(dx, dy));
      }
    }
    return minGap;
  };

  it("automatically separates overlapping detached mind maps with at least ROOT_TREE_GAP across all layout modes", () => {
    let doc = createBlankMap("Primary Map");
    const root1 = doc.rootIds[0];
    doc = addChildNode(doc, root1, "Branch A").doc;
    doc = addChildNode(doc, root1, "Branch B").doc;

    // Add second detached root intentionally overlapping root1 at (0, 0)
    const det = addDetachedRootNode(doc, { x: 20, y: 10 }, "Second Mind Map");
    doc = det.doc;
    const root2 = det.newId;
    doc = addChildNode(doc, root2, "Second Branch 1").doc;

    for (const mode of ["mindmap", "tree-right", "org-chart"] as const) {
      const layouts = computeMindMapLayout({ ...doc, layout: mode });
      expect(getMinNodePairGap(layouts, root1, root2)).toBeGreaterThanOrEqual(ROOT_TREE_GAP);
    }
  });

  it("shifts an adjacent mind map automatically when an editing tree grows into it, and resolves 3 clustered maps", () => {
    let doc = createBlankMap("Root 1");
    const r1 = doc.rootIds[0];

    // Place Root 2 comfortably below Root 1 initially (not overlapping)
    const det2 = addDetachedRootNode(doc, { x: 0, y: 200 }, "Root 2");
    doc = det2.doc;
    const r2 = det2.newId;

    // Place Root 3 clustered tightly near Root 1 & Root 2
    const det3 = addDetachedRootNode(doc, { x: 30, y: 190 }, "Root 3");
    doc = det3.doc;
    const r3 = det3.newId;

    // Grow Root 1 with tall nodes so it expands vertically into Root 2 & Root 3
    for (let i = 0; i < 6; i++) {
      const res = addChildNode(doc, r1, `Topic ${i + 1}`);
      doc = resizeNodesBatch(res.doc, [res.newId], { width: 220, minHeight: 110 });
    }

    const layouts = computeMindMapLayout(doc);
    const rootList = [r1, r2, r3];
    for (let i = 0; i < rootList.length; i++) {
      for (let j = i + 1; j < rootList.length; j++) {
        expect(getMinNodePairGap(layouts, rootList[i], rootList[j])).toBeGreaterThanOrEqual(
          ROOT_TREE_GAP
        );
      }
    }

    // Distant non-overlapping root retains its exact coordinates
    let farDoc = createBlankMap("Near");
    const farDet = addDetachedRootNode(farDoc, { x: 1800, y: 1400 }, "Far Away");
    farDoc = farDet.doc;
    const farLayouts = computeMindMapLayout(farDoc);
    const farLayout = farLayouts[farDet.newId];
    expect(farLayout.x + farLayout.width / 2).toBe(1800);
    expect(farLayout.y + farLayout.height / 2).toBe(1400);
  });

  it("allows detached roots to move freely above and into open pockets around another tree without a bounding-box ceiling wall", () => {
    let doc = createInitialMap();
    const r1 = doc.rootIds[0];
    const baseLayouts = computeMindMapLayout(doc);
    const mainBounds = getTreeBounds(baseLayouts, r1);

    // 1. Placing a detached root in open whitespace directly above the main tree stays above it
    const abovePos = { x: 0, y: Math.round(mainBounds.minY - 140) };
    const detAbove = addDetachedRootNode(doc, abovePos, "Moved Above");
    const aboveLayouts = computeMindMapLayout(detAbove.doc);
    const placedAbove = aboveLayouts[detAbove.newId];
    expect(placedAbove.y + placedAbove.height / 2).toBe(abovePos.y);

    // 2. Placing a detached root inside an open whitespace pocket beside shorter branches (inside outer bbox, no node collision) stays put
    const pocketPos = { x: Math.round(mainBounds.maxX - 40), y: Math.round(mainBounds.minY - 90) };
    const detPocket = addDetachedRootNode(doc, pocketPos, "Open Pocket");
    const pocketLayouts = computeMindMapLayout(detPocket.doc);
    const placedPocket = pocketLayouts[detPocket.newId];
    expect(placedPocket.y + placedPocket.height / 2).toBe(pocketPos.y);

    // 3. During active drag (ignoreOverlapRootId), the dragged root moves freely even across another tree without snapping back
    const midCrossPos = { x: 0, y: 0 };
    const detDrag = addDetachedRootNode(doc, midCrossPos, "Dragging Across");
    const dragLayouts = computeMindMapLayout(detDrag.doc, undefined, false, {
      ignoreOverlapRootId: detDrag.newId,
    });
    const draggingInfo = dragLayouts[detDrag.newId];
    expect(Math.round(draggingInfo.x + draggingInfo.width / 2)).toBe(0);
    expect(Math.round(draggingInfo.y + draggingInfo.height / 2)).toBe(0);
  });

  it("supports explicit no-fill ('none') color option without leaking into branch/edge colors", () => {
    const base = createInitialMap();
    const targetId = "node-math";
    let doc = setNodesColor(base, [targetId], {
      color: "#2563eb",
      borderColor: "#10b981",
      edgeColor: "#e11d48",
      textColor: "#ffffff",
    });

    // Switching node fill to 'none' clears textColor, preserves border/edge color, and keeps custom mode
    doc = setNodesColor(doc, [targetId], { color: "none" });
    expect(doc.colorMode).toBe("custom");
    expect(doc.nodes[targetId].style?.color).toBe("none");
    expect(doc.nodes[targetId].style?.textColor).toBeUndefined();
    expect(doc.nodes[targetId].style?.borderColor).toBe("#10b981");
    expect(doc.nodes[targetId].style?.edgeColor).toBe("#e11d48");

    // A node with only color: "none" (no borderColor/edgeColor) must never turn branchColor into "none"
    const onlyNoFill = setNodesColor(base, [targetId], { color: "none" });
    const layouts = computeMindMapLayout(onlyNoFill);
    expect(layouts[targetId].branchColor).not.toBe("none");
    expect(layouts[targetId].branchColor.startsWith("#")).toBe(true);
  });

  it("computes zoom-to-fit viewport transform centered on all nodes", () => {
    const doc = createInitialMap();
    const layouts = computeMindMapLayout(doc);
    const fit = computeFitViewport(layouts, 1200, 800);
    expect(fit).not.toBeNull();
    expect(fit!.scale).toBeGreaterThanOrEqual(0.25);
    expect(fit!.scale).toBeLessThanOrEqual(1.35);

    // Every node bounding box fits inside the 1200x800 container
    for (const node of Object.values(layouts)) {
      const left = fit!.x + node.x * fit!.scale;
      const top = fit!.y + node.y * fit!.scale;
      const right = left + node.width * fit!.scale;
      const bottom = top + node.height * fit!.scale;
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(right).toBeLessThanOrEqual(1200);
      expect(bottom).toBeLessThanOrEqual(800);
    }

    expect(computeFitViewport({}, 1200, 800)).toBeNull();
  });
});

describe("Export / Import Fidelity & Rich Visual SVG Export", () => {
  it("imports multi-root plain Markdown without wrapping in an extra root node and keeps checklists inside their node", () => {
    const md = `# First Map Root
## Interactive Tasks
- [x] Universal LLM math pipeline
- [ ] Press \`Space\` to edit me

# Second Independent Root
## Marketing
- Social Media
- Print`;

    const imported = importMapFromFileContent("notes.md", md);
    expect(imported.rootIds).toHaveLength(2);
    const rootTexts = imported.rootIds.map((rid) => imported.nodes[rid].text);
    expect(rootTexts).toEqual(["First Map Root", "Second Independent Root"]);

    // First root has 1 child ("Interactive Tasks") containing the task checkboxes inline
    const firstRoot = imported.nodes[imported.rootIds[0]];
    expect(firstRoot.childrenIds).toHaveLength(1);
    const taskNode = imported.nodes[firstRoot.childrenIds[0]];
    expect(taskNode.text).toContain("- [x] Universal LLM math pipeline");
    expect(taskNode.text).toContain("- [ ] Press `Space` to edit me");
    expect(taskNode.childrenIds).toHaveLength(0);

    // Second root preserves its exact hierarchy
    const secondRoot = imported.nodes[imported.rootIds[1]];
    expect(secondRoot.childrenIds).toHaveLength(1);
    const mktNode = imported.nodes[secondRoot.childrenIds[0]];
    expect(mktNode.text).toBe("Marketing");
    expect(mktNode.childrenIds.map((cid) => imported.nodes[cid].text)).toEqual([
      "Social Media",
      "Print",
    ]);
  });

  it("preserves exact multi-root hierarchy, colors, formatting, stickers, and cross-links across .md, .mup, .mm, and .json round-trips", () => {
    let doc = createInitialMap();
    const detached = addDetachedRootNode(doc, { x: 420, y: 520 }, "Second Root 🚀");
    doc = detached.doc;
    const secondChild = addChildNode(doc, detached.newId, "**Bold** and $E=mc^2$");
    doc = secondChild.doc;
    doc = setNodesColor(doc, ["node-math", secondChild.newId], {
      color: "#1e293b",
      borderColor: "#ec4899",
      edgeColor: "#ec4899",
      textColor: "#f8fafc",
    });
    doc.nodes["node-math"].notes = "Extended physics notes";
    doc.nodes[secondChild.newId].style = {
      ...doc.nodes[secondChild.newId].style,
      shape: "cloud",
      fontSize: 18,
      align: "center",
    };

    // 1. Markdown round-trip (unmodified)
    const mdRaw = serializeMapAsMarkdown(doc);
    const fromMd = importMapFromFileContent("export.md", mdRaw);
    expect(fromMd.rootIds).toHaveLength(2);
    expect(fromMd.colorMode).toBe("custom");
    expect(fromMd.nodes["node-math"]?.style?.color).toBe("#1e293b");
    expect(fromMd.nodes["node-math"]?.style?.edgeColor).toBe("#ec4899");
    expect(fromMd.nodes["node-math"]?.notes).toBe("Extended physics notes");
    expect(fromMd.crossLinks).toHaveLength(doc.crossLinks.length);

    // Edited Markdown export falls back to parsing edited Markdown without extra wrapper node
    const editedMd = mdRaw.replace("Second Root 🚀", "Renamed Root ✨");
    const fromEditedMd = importMapFromFileContent("edited.md", editedMd);
    expect(fromEditedMd.rootIds).toHaveLength(2);
    expect(fromEditedMd.nodes[fromEditedMd.rootIds[1]].text).toBe("Renamed Root ✨");

    // 2. MindMup (.mup) round-trip
    const mupRaw = serializeMapAsMindMup(doc);
    const fromMup = importMapFromFileContent("export.mup", mupRaw);
    expect(fromMup.rootIds).toHaveLength(2);
    expect(fromMup.colorMode).toBe("custom");
    const mupSecondRoot = fromMup.nodes[fromMup.rootIds[1]];
    expect(mupSecondRoot.text).toBe("Second Root 🚀");
    expect(mupSecondRoot.position).toEqual({ x: 420, y: 520 });
    const mupSecondChild = fromMup.nodes[mupSecondRoot.childrenIds[0]];
    expect(mupSecondChild.style?.color).toBe("#1e293b");
    expect(mupSecondChild.style?.edgeColor).toBe("#ec4899");
    expect(mupSecondChild.style?.shape).toBe("cloud");
    expect(mupSecondChild.style?.fontSize).toBe(18);
    expect(fromMup.crossLinks).toHaveLength(doc.crossLinks.length);

    // External MindMup file with background color automatically activates colorMode = "custom"
    const extMup = JSON.stringify({
      formatVersion: 3,
      title: "External Map",
      ideas: {
        "1": {
          id: 1,
          title: "Central",
          attr: { style: { background: "#ff5500", color: "#ffffff" } },
          ideas: { "1": { id: 2, title: "Child A" } },
        },
      },
    });
    const fromExtMup = importMapFromFileContent("external.mup", extMup);
    expect(fromExtMup.rootIds).toHaveLength(1);
    expect(fromExtMup.colorMode).toBe("custom");
    expect(fromExtMup.nodes[fromExtMup.rootIds[0]].style?.color).toBe("#ff5500");

    // 3. FreeMind (.mm) round-trip
    const mmRaw = serializeMapAsFreeMind(doc);
    const fromMm = importMapFromFileContent("export.mm", mmRaw);
    expect(fromMm.rootIds).toHaveLength(2);
    expect(fromMm.colorMode).toBe("custom");
    const mmSecondRoot = fromMm.nodes[fromMm.rootIds[1]];
    expect(mmSecondRoot.text).toBe("Second Root 🚀");
    const mmSecondChild = fromMm.nodes[mmSecondRoot.childrenIds[0]];
    expect(mmSecondChild.style?.color).toBe("#1e293b");
    expect(mmSecondChild.style?.edgeColor).toBe("#ec4899");
    expect(mmSecondChild.style?.fontSize).toBe(18);
    expect(fromMm.crossLinks).toHaveLength(doc.crossLinks.length);

    // 4. Native JSON round-trip
    const fromJson = importMapFromFileContent("export.json", JSON.stringify(doc));
    expect(fromJson.rootIds).toHaveLength(2);
    expect(fromJson.colorMode).toBe("custom");
    expect(fromJson.nodes[secondChild.newId].style?.color).toBe("#1e293b");
  });

  it("includes images, emojis/stickers, code snippets, formatted KaTeX math, Mermaid diagrams, and cross-links in rich SVG export", () => {
    const doc = createInitialMap();
    doc.nodes["node-media"].images = [
      { id: "img-export", url: "data:image/png;base64,iVBORw0KGgo=", name: "diagram.png", width: 200 },
    ];
    const layouts = computeMindMapLayout(doc);
    const svg = buildExportSvgString(doc, layouts, false);

    expect(svg).toContain("<foreignObject");
    expect(svg).toContain("data:image/png;base64,iVBORw0KGgo=");
    expect(svg).toContain("🚀");
    expect(svg).toContain("🧮");
    expect(svg).toContain('class="katex"');
    expect(svg).toContain("mf-code-block");
    expect(svg).toContain("hljs-keyword");
    expect(svg).toContain("mf-mermaid-diagram");
    expect(svg).toContain("supports math");
  });
});

describe("Node Detaching (Floating Toolbar Batch & Drag Far Away)", () => {
  it("detaches selected non-root nodes into independent roots while preserving selected subtrees", () => {
    const doc = createInitialMap();
    // Selecting parent ("node-math") + its descendant ("node-math-chatgpt") + root should detach only "node-math" with its subtree intact
    const res = detachNodesToRoots(
      doc,
      [doc.rootIds[0], "node-math", "node-math-chatgpt"],
      { "node-math": { x: 640, y: 320 } }
    );
    expect(res.detachedIds).toEqual(["node-math"]);
    expect(res.doc.rootIds).toContain("node-math");
    expect(res.doc.nodes["node-math"].parentId).toBeNull();
    expect(res.doc.nodes["node-math"].position).toEqual({ x: 640, y: 320 });
    expect(res.doc.nodes["node-math-chatgpt"].parentId).toBe("node-math");

    // Selecting only root nodes is a no-op
    const rootOnly = detachNodesToRoots(doc, [doc.rootIds[0]]);
    expect(rootOnly.detachedIds).toEqual([]);
    expect(rootOnly.doc).toBe(doc);
  });

  it("triggers drag-to-detach hint when a child node is dragged far away from its parent into empty space", () => {
    const doc = createInitialMap();
    const layouts = computeMindMapLayout(doc);
    const mathLayout = layouts["node-math"];
    const rootLayout = layouts[doc.rootIds[0]];

    // Small drag away from parent does NOT detach
    const smallDrag = computeDragDropHint(
      "node-math",
      mathLayout.x + mathLayout.width / 2 + 60,
      mathLayout.y + mathLayout.height / 2,
      doc,
      layouts,
      { dx: 60, dy: 0 }
    );
    expect(smallDrag?.placement).not.toBe("detach");

    // Dragging far away to the right into empty space triggers detach at the dropped coordinates
    const farDx = 420;
    const farDy = -180;
    const detachHint = computeDragDropHint(
      "node-math",
      mathLayout.x + mathLayout.width / 2 + farDx,
      mathLayout.y + mathLayout.height / 2 + farDy,
      doc,
      layouts,
      { dx: farDx, dy: farDy }
    );
    expect(detachHint).not.toBeNull();
    expect(detachHint?.placement).toBe("detach");
    expect(detachHint?.indicator.kind).toBe("detach");
    expect(detachHint?.indicator.label).toBe("Release to detach");
    expect(detachHint?.detachPosition).toEqual({
      x: Math.round(mathLayout.x + mathLayout.width / 2 + farDx),
      y: Math.round(mathLayout.y + mathLayout.height / 2 + farDy),
    });

    // Dragging directly onto another node still reparents/reorders instead of detaching
    const shortcutsLayout = layouts["node-shortcuts"];
    const reparentHint = computeDragDropHint(
      "node-math",
      shortcutsLayout.x + shortcutsLayout.width / 2,
      shortcutsLayout.y + shortcutsLayout.height / 2,
      doc,
      layouts,
      {
        dx: shortcutsLayout.x - mathLayout.x,
        dy: shortcutsLayout.y - mathLayout.y,
      }
    );
    expect(reparentHint?.placement).toBe("inside");
    expect(reparentHint?.targetId).toBe("node-shortcuts");

    // Dragging a right-side branch just across the root center still flips to left side instead of detaching
    const flipX = rootLayout.x - 40;
    const flipY = rootLayout.y - 160;
    const flipHint = computeDragDropHint("node-math", flipX, flipY, doc, layouts, {
      dx: flipX - (mathLayout.x + mathLayout.width / 2),
      dy: flipY - (mathLayout.y + mathLayout.height / 2),
    });
    expect(flipHint?.placement).toBe("inside");
    expect(flipHint?.side).toBe("left");
  });

  it("allows dragging a detached root node back onto an existing mind map to attach as child or sibling", () => {
    let doc = createInitialMap();
    // Detach "node-math" (which has children "node-math-chatgpt" & "node-math-claude")
    doc = detachNodeToRoot(doc, "node-math", { x: 600, y: 500 });
    expect(doc.rootIds).toContain("node-math");
    expect(doc.nodes["node-math"].parentId).toBeNull();

    const layouts = computeMindMapLayout(doc);
    const shortcutsLayout = layouts["node-shortcuts"];
    const mainRootLayout = layouts[doc.rootIds[0]];

    // Hovering empty canvas space returns null (stays floating root)
    const emptyHint = computeDragDropHint("node-math", 1200, 900, doc, layouts);
    expect(emptyHint).toBeNull();

    // Hovering over the middle of "node-shortcuts" offers "Make child"
    const childHint = computeDragDropHint(
      "node-math",
      shortcutsLayout.x + shortcutsLayout.width / 2,
      shortcutsLayout.y + shortcutsLayout.height / 2,
      doc,
      layouts
    );
    expect(childHint?.placement).toBe("inside");
    expect(childHint?.targetId).toBe("node-shortcuts");
    expect(childHint?.indicator.label).toBe("Make child");

    // Dropping attaches "node-math" (and its subtree) under "node-shortcuts" and removes it from rootIds
    const attachedAsChild = repositionNode(
      doc,
      "node-math",
      "node-shortcuts",
      "inside",
      childHint?.side
    );
    expect(attachedAsChild.rootIds).not.toContain("node-math");
    expect(attachedAsChild.nodes["node-math"].parentId).toBe("node-shortcuts");
    expect(attachedAsChild.nodes["node-math"].position).toBeUndefined();
    expect(attachedAsChild.nodes["node-shortcuts"].childrenIds).toContain("node-math");
    expect(attachedAsChild.nodes["node-math-chatgpt"].parentId).toBe("node-math");

    // Hovering top edge of "node-shortcuts" offers "Insert above" as sibling
    const siblingHint = computeDragDropHint(
      "node-math",
      shortcutsLayout.x + shortcutsLayout.width / 2,
      shortcutsLayout.y + 4,
      doc,
      layouts
    );
    expect(siblingHint?.placement).toBe("before");
    expect(siblingHint?.indicator.label).toBe("Insert above");

    const attachedAsSibling = repositionNode(
      doc,
      "node-math",
      "node-shortcuts",
      "before",
      siblingHint?.side
    );
    expect(attachedAsSibling.rootIds).not.toContain("node-math");
    expect(attachedAsSibling.nodes["node-math"].parentId).toBe(doc.rootIds[0]);

    // Hovering over left half of main root offers "Attach to Left"
    const rootAttachHint = computeDragDropHint(
      "node-math",
      mainRootLayout.x + 12,
      mainRootLayout.y + mainRootLayout.height / 2,
      doc,
      layouts
    );
    expect(rootAttachHint?.placement).toBe("inside");
    expect(rootAttachHint?.side).toBe("left");
    expect(rootAttachHint?.indicator.label).toBe("Attach to Left");
  });
});
