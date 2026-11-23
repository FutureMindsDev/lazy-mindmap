export interface SubtreeBranch {
  text: string;
  children: SubtreeBranch[];
}

/**
 * Parses a structured LLM Markdown response (headings #, ##, ###, nested bullet/numbered lists,
 * fenced code blocks, and block math $$...$$ / \[...\]) into a hierarchical subtree ready
 * to attach beneath the currently selected mind map node.
 */
export function parseMarkdownToSubtree(markdown: string): SubtreeBranch[] {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const roots: SubtreeBranch[] = [];

  interface StackFrame {
    depth: number;
    node: SubtreeBranch;
    kind: "heading" | "list";
  }

  const stack: StackFrame[] = [];
  let inFence = false;
  let fenceDelim = "";
  let inMathBlock = false;
  let mathEndDelim = "";
  let currentBuffer: string[] = [];

  const getActiveNode = (): SubtreeBranch | null => {
    if (stack.length > 0) return stack[stack.length - 1].node;
    if (roots.length > 0) return roots[roots.length - 1];
    return null;
  };

  const flushBufferToActive = () => {
    if (currentBuffer.length === 0) return;
    const blockText = currentBuffer.join("\n").trimEnd();
    currentBuffer = [];
    if (!blockText.trim()) return;

    const target = getActiveNode();
    if (target) {
      target.text = target.text ? `${target.text}\n${blockText}` : blockText;
    } else {
      const node: SubtreeBranch = { text: blockText.trim(), children: [] };
      roots.push(node);
      stack.push({ depth: 1, node, kind: "heading" });
    }
  };

  const pushNode = (depth: number, kind: "heading" | "list", text: string) => {
    flushBufferToActive();
    const node: SubtreeBranch = { text: text.trim(), children: [] };

    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      if (kind === "heading") {
        if (top.kind === "heading" && top.depth < depth) break;
        stack.pop();
      } else {
        if (top.kind === "heading") break;
        if (top.kind === "list" && top.depth < depth) break;
        stack.pop();
      }
    }

    if (stack.length > 0) {
      stack[stack.length - 1].node.children.push(node);
    } else {
      roots.push(node);
    }
    stack.push({ depth, node, kind });
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();

    // Keep fenced code blocks atomic inside the current node
    if (!inMathBlock) {
      const fenceMatch = rawLine.match(/^\s*(`{3,}|~{3,})/);
      if (fenceMatch) {
        if (!inFence) {
          inFence = true;
          fenceDelim = fenceMatch[1][0];
          currentBuffer.push(rawLine);
          continue;
        } else if (fenceMatch[1][0] === fenceDelim && trimmed.replace(/[`~]/g, "") === "") {
          inFence = false;
          fenceDelim = "";
          currentBuffer.push(rawLine);
          continue;
        }
      }
    }

    if (inFence) {
      currentBuffer.push(rawLine);
      continue;
    }

    // Keep multi-line $$...$$ or \[...\] blocks atomic inside the current node
    if (!inMathBlock) {
      if (trimmed === "$$" || (trimmed.startsWith("$$") && !trimmed.endsWith("$$"))) {
        inMathBlock = true;
        mathEndDelim = "$$";
        currentBuffer.push(rawLine);
        continue;
      }
      if (trimmed === "\\[" || (trimmed.startsWith("\\[") && !trimmed.endsWith("\\]"))) {
        inMathBlock = true;
        mathEndDelim = "\\]";
        currentBuffer.push(rawLine);
        continue;
      }
    } else {
      currentBuffer.push(rawLine);
      if (trimmed.endsWith(mathEndDelim)) {
        inMathBlock = false;
        mathEndDelim = "";
      }
      continue;
    }

    // Heading (#, ##, ...)
    const headingMatch = rawLine.match(/^\s*(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      pushNode(headingMatch[1].length, "heading", headingMatch[2]);
      continue;
    }

    // Bullet or numbered list item
    const listMatch = rawLine.match(/^(\s*)(?:[-*+]|\d+\.)\s+(.+)$/);
    if (listMatch) {
      const indent = listMatch[1].replace(/\t/g, "  ").length;
      const depth = Math.floor(indent / 2) + 1;
      pushNode(depth, "list", listMatch[2]);
      continue;
    }

    if (trimmed === "") {
      if (currentBuffer.length > 0) {
        currentBuffer.push("");
      }
      continue;
    }

    // Continuation paragraph / inline math / table row
    if (getActiveNode()) {
      currentBuffer.push(rawLine);
    } else {
      pushNode(1, "heading", rawLine);
    }
  }

  flushBufferToActive();
  return roots;
}
