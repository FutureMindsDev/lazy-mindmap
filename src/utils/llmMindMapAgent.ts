import type {
  LlmChatFile,
  LlmChatMessage,
  LlmConfig,
  LlmConversation,
  LlmNodeChangeRecord,
  LlmProviderId,
  MindMapDocument,
  MindMapNode,
} from "../types/mindmap";
import { parseMarkdownToSubtree, type SubtreeBranch } from "./markdownToSubtree";
import { fileToDataUrl, uploadFileDual } from "./storage";
import { cloneDocument, insertSubtreeBranches, makeId } from "./treeOps";

export const LLM_CONFIG_STORAGE_KEY = "lazymindmap:llmConfig";
export const LLM_HISTORY_STORAGE_KEY = "lazymindmap:llmChatHistory";
export const LLM_CONVERSATIONS_STORAGE_KEY = "lazymindmap:llmConversations";
export const LLM_ACTIVE_CONV_STORAGE_KEY = "lazymindmap:llmActiveConversationId";

export const LLM_PROVIDER_META: Record<
  LlmProviderId,
  {
    label: string;
    defaultModel: string;
    models: string[];
    keyPlaceholder: string;
    baseUrlPlaceholder?: string;
  }
> = {
  openai: {
    label: "OpenAI",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "o4-mini"],
    keyPlaceholder: "sk-...",
  },
  gemini: {
    label: "Google Gemini",
    defaultModel: "gemini-2.5-flash",
    models: ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    keyPlaceholder: "AIza...",
  },
  anthropic: {
    label: "Anthropic Claude",
    defaultModel: "claude-3-5-sonnet-latest",
    models: ["claude-3-5-sonnet-latest", "claude-3-7-sonnet-latest", "claude-3-5-haiku-latest"],
    keyPlaceholder: "sk-ant-...",
  },
  custom: {
    label: "Custom (OpenAI-Compatible)",
    defaultModel: "gpt-4o-mini",
    models: ["gpt-4o-mini", "deepseek-chat", "llama-3.3-70b-versatile"],
    keyPlaceholder: "Provider API key...",
    baseUrlPlaceholder: "https://api.openai.com/v1",
  },
};

export const DEFAULT_LLM_CONFIG: LlmConfig = {
  provider: "openai",
  apiKey: "",
  model: LLM_PROVIDER_META.openai.defaultModel,
  baseUrl: "",
};

export class LlmApiError extends Error {
  status?: number;
  rawError?: string;

  constructor(message: string, status?: number, rawError?: string) {
    super(message);
    this.name = "LlmApiError";
    this.status = status;
    this.rawError = rawError;
  }
}

export function loadLlmConfig(): LlmConfig {
  try {
    const raw = localStorage.getItem(LLM_CONFIG_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_LLM_CONFIG };
    const parsed = JSON.parse(raw) as Partial<LlmConfig>;
    const provider: LlmProviderId =
      parsed.provider && parsed.provider in LLM_PROVIDER_META ? parsed.provider : "openai";
    return {
      provider,
      apiKey: typeof parsed.apiKey === "string" ? parsed.apiKey : "",
      model:
        typeof parsed.model === "string" && parsed.model.trim()
          ? parsed.model
          : LLM_PROVIDER_META[provider].defaultModel,
      baseUrl: typeof parsed.baseUrl === "string" ? parsed.baseUrl : "",
    };
  } catch {
    return { ...DEFAULT_LLM_CONFIG };
  }
}

export function saveLlmConfig(config: LlmConfig): void {
  try {
    localStorage.setItem(LLM_CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadLlmChatHistory(): LlmChatMessage[] {
  try {
    const raw = localStorage.getItem(LLM_HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as LlmChatMessage[]) : [];
  } catch {
    return [];
  }
}

export function saveLlmChatHistory(messages: LlmChatMessage[]): void {
  try {
    // Strip heavy base64 dataUrl blobs from persisted history to avoid localStorage quota issues
    const trimmed = messages.slice(-80).map((m) => ({
      ...m,
      files: m.files?.map((f) => ({
        id: f.id,
        name: f.name,
        url: f.url,
        mimeType: f.mimeType,
        size: f.size,
        textContent:
          f.textContent && f.textContent.length > 4000
            ? f.textContent.slice(0, 4000)
            : f.textContent,
      })),
    }));
    localStorage.setItem(LLM_HISTORY_STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore storage quota errors
  }
}

export function deriveConversationTitle(messages: LlmChatMessage[]): string {
  const firstUser = messages.find((m) => m.role === "user" && m.content.trim());
  if (!firstUser) return "New Conversation";
  const singleLine = firstUser.content
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[*#`~>\r\n]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!singleLine) return "New Conversation";
  return singleLine.length > 42 ? `${singleLine.slice(0, 39)}…` : singleLine;
}

export function createNewConversation(initialMessages: LlmChatMessage[] = []): LlmConversation {
  const now = new Date().toISOString();
  return {
    id: makeId("conv"),
    title: deriveConversationTitle(initialMessages),
    createdAt: initialMessages[0]?.createdAt || now,
    updatedAt: initialMessages[initialMessages.length - 1]?.createdAt || now,
    messages: initialMessages,
  };
}

export function saveLlmConversations(conversations: LlmConversation[]): void {
  try {
    const sanitized = conversations.slice(0, 50).map((conv) => ({
      ...conv,
      messages: conv.messages.slice(-80).map((m) => ({
        ...m,
        files: m.files?.map((f) => ({
          id: f.id,
          name: f.name,
          url: f.url,
          mimeType: f.mimeType,
          size: f.size,
          textContent:
            f.textContent && f.textContent.length > 4000
              ? f.textContent.slice(0, 4000)
              : f.textContent,
        })),
      })),
    }));
    localStorage.setItem(LLM_CONVERSATIONS_STORAGE_KEY, JSON.stringify(sanitized));
  } catch {
    // Ignore storage quota errors
  }
}

export function loadLlmConversations(): LlmConversation[] {
  try {
    const raw = localStorage.getItem(LLM_CONVERSATIONS_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const valid = (parsed as LlmConversation[]).filter(
          (c) => c && typeof c.id === "string" && Array.isArray(c.messages)
        );
        if (valid.length > 0) return valid;
      }
    }
  } catch {
    // Fallback to legacy migration or fresh conversation
  }

  const legacy = loadLlmChatHistory();
  if (legacy.length > 0) {
    const migrated = [createNewConversation(legacy)];
    saveLlmConversations(migrated);
    return migrated;
  }

  return [createNewConversation()];
}

export function loadActiveConversationId(conversations: LlmConversation[]): string {
  try {
    const savedId = localStorage.getItem(LLM_ACTIVE_CONV_STORAGE_KEY);
    if (savedId && conversations.some((c) => c.id === savedId)) {
      return savedId;
    }
  } catch {
    // Ignore storage errors
  }
  return conversations[0]?.id || "";
}

export function saveActiveConversationId(id: string): void {
  try {
    localStorage.setItem(LLM_ACTIVE_CONV_STORAGE_KEY, id);
  } catch {
    // Ignore storage errors
  }
}

const TEXT_FILE_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".rb",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".cs",
  ".php",
  ".sh",
  ".bash",
  ".zsh",
  ".sql",
  ".tex",
  ".mup",
  ".mm",
  ".svg",
  ".log",
  ".ini",
  ".toml",
  ".env",
  ".gitignore",
  ".dockerfile",
]);

function isTextLikeFile(file: File): boolean {
  const mime = (file.type || "").toLowerCase();
  if (
    mime.startsWith("text/") ||
    mime === "application/json" ||
    mime === "application/xml" ||
    mime === "application/javascript" ||
    mime === "application/typescript" ||
    mime === "application/x-yaml" ||
    mime === "application/csv" ||
    mime === "image/svg+xml"
  ) {
    return true;
  }
  const name = file.name.toLowerCase();
  const dotIdx = name.lastIndexOf(".");
  if (dotIdx >= 0) {
    return TEXT_FILE_EXTENSIONS.has(name.slice(dotIdx));
  }
  return false;
}

export async function readFileForChat(file: File): Promise<LlmChatFile> {
  const uploaded = await uploadFileDual(file);
  let textContent: string | undefined;
  let dataUrl: string | undefined;

  if (isTextLikeFile(file) && file.size <= 512 * 1024) {
    try {
      textContent = await file.text();
    } catch {
      textContent = undefined;
    }
  }

  if (file.size <= 15 * 1024 * 1024) {
    try {
      dataUrl = await fileToDataUrl(file);
    } catch {
      dataUrl = undefined;
    }
  }

  return {
    id: makeId("chatf"),
    name: uploaded.name,
    url: uploaded.url,
    mimeType: uploaded.mimeType,
    size: uploaded.size,
    textContent,
    dataUrl,
  };
}

export function getNodeShortLabel(node: MindMapNode): string {
  const firstLine = (node.text || "").split(/\r?\n/)[0] || "";
  const cleaned = firstLine.replace(/[*#`~>]/g, "").trim();
  if (!cleaned) return "Untitled Node";
  return cleaned.length > 52 ? `${cleaned.slice(0, 49)}…` : cleaned;
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "under",
  "about",
  "node",
  "nodes",
  "mind",
  "map",
  "add",
  "create",
  "new",
  "update",
  "modify",
  "edit",
  "change",
  "please",
  "can",
  "you",
  "make",
  "put",
  "all",
  "related",
  "existing",
]);

export function findRelatedNodes(
  doc: MindMapDocument,
  prompt: string,
  selectedIds: string[]
): MindMapNode[] {
  const allNodes = Object.values(doc.nodes);
  if (allNodes.length === 0) return [];

  const tokens = Array.from(
    new Set(
      prompt
        .toLowerCase()
        .split(/[^a-z0-9_+-]+/i)
        .filter((t) => t.length >= 2 && !STOP_WORDS.has(t))
    )
  );
  const selectedSet = new Set(selectedIds);

  const scored = allNodes.map((node) => {
    const labelLower = getNodeShortLabel(node).toLowerCase();
    const textLower = (node.text || "").toLowerCase();
    const notesLower = (node.notes || "").toLowerCase();
    let keywordScore = 0;

    for (const token of tokens) {
      if (labelLower.includes(token)) keywordScore += 6;
      else if (textLower.includes(token)) keywordScore += 3;
      else if (notesLower.includes(token)) keywordScore += 1.5;
    }

    const selectionBoost = selectedSet.has(node.id) ? 1.5 : 0;
    return { node, keywordScore, totalScore: keywordScore + selectionBoost };
  });

  const keywordMatched = scored
    .filter((item) => item.keywordScore > 0)
    .sort((a, b) => b.totalScore - a.totalScore);

  if (keywordMatched.length > 0) {
    const picked = keywordMatched.slice(0, 5).map((item) => item.node);
    // Also include primary selected node if not already in picked and list is short
    for (const sid of selectedIds) {
      const selNode = doc.nodes[sid];
      if (selNode && !picked.some((n) => n.id === sid) && picked.length < 6) {
        picked.push(selNode);
      }
    }
    return picked;
  }

  const selectedNodes = selectedIds
    .map((id) => doc.nodes[id])
    .filter((n): n is MindMapNode => Boolean(n));
  if (selectedNodes.length > 0) {
    return selectedNodes.slice(0, 5);
  }

  const primaryRoot = doc.rootIds[0] ? doc.nodes[doc.rootIds[0]] : allNodes[0];
  return primaryRoot ? [primaryRoot] : [];
}

export function buildMindMapSystemPrompt(
  doc: MindMapDocument,
  selectedIds: string[],
  files: LlmChatFile[]
): string {
  const nodesSummary = Object.values(doc.nodes).map((n) => ({
    id: n.id,
    parentId: n.parentId,
    label: getNodeShortLabel(n),
    text: n.text.length > 400 ? `${n.text.slice(0, 400)}...` : n.text,
    notes: n.notes ? (n.notes.length > 240 ? `${n.notes.slice(0, 240)}...` : n.notes) : undefined,
    childrenIds: n.childrenIds,
  }));

  const fileListText =
    files.length > 0
      ? files
          .map((f) => `- ${f.name} (${f.mimeType || "application/octet-stream"}, ${Math.max(1, Math.round(f.size / 1024))} KB)`)
          .join("\n")
      : "None";

  return `You are LazyMindmap AI, an assistant that directly reads, creates, and modifies nodes in the user's mind map.

Current Map Title: ${doc.title}
Primary Root ID: ${doc.rootIds[0] || ""}
Currently Selected Node IDs: ${JSON.stringify(selectedIds)}

Current Mind Map Nodes (JSON):
${JSON.stringify(nodesSummary, null, 2)}

Files Attached in Current Request:
${fileListText}

INSTRUCTIONS:
1. Analyze the user's prompt and any attached files carefully.
2. Decide which EXISTING nodes should be modified (if the prompt asks to update, expand, fix, summarize, or attach info to an existing topic) and/or which NEW child/root nodes should be created.
3. Return ONLY a valid JSON object matching this exact schema (no extra prose outside JSON, or inside a \`\`\`json code fence):
{
  "explanation": "Concise response explaining the changes made and explicitly naming the nodes modified or created.",
  "operations": [
    {
      "type": "modify_node",
      "nodeId": "exact-existing-node-id",
      "newText": "optional full replacement Markdown/LaTeX text for this node",
      "appendText": "optional Markdown text to append to the node",
      "newNotes": "optional detailed side notes (Markdown/LaTeX)",
      "attachFiles": true
    },
    {
      "type": "create_child_nodes",
      "parentId": "exact-existing-parent-node-id",
      "branches": [
        {
          "text": "Child node Markdown/LaTeX/code",
          "notes": "optional extended side notes",
          "attachFiles": false,
          "children": [
            { "text": "Nested grandchild node" }
          ]
        }
      ]
    },
    {
      "type": "create_root_node",
      "text": "New detached floating root node Markdown",
      "notes": "optional extended side notes",
      "attachFiles": false,
      "children": []
    }
  ]
}

RULES:
- Use exact node IDs from the provided Current Mind Map Nodes JSON.
- If the user didn't specify a target node and no existing node is clearly related, create child nodes under the currently selected node (or Primary Root ID if nothing is selected), OR create a new root node if they asked for a separate topic.
- Use rich Markdown, KaTeX math ($...$ or $$...$$), task lists (- [ ]), tables, or fenced code/mermaid blocks inside node text when appropriate.
- Set "attachFiles": true on the target modified or newly created node if the user uploaded files that should be attached to that node.`;
}

interface LlmBranchInput {
  text?: string;
  notes?: string;
  attachFiles?: boolean;
  children?: LlmBranchInput[];
}

interface LlmOperationInput {
  type?: string;
  nodeId?: string;
  targetId?: string;
  newText?: string;
  appendText?: string;
  newNotes?: string;
  attachFiles?: boolean;
  parentId?: string;
  branches?: LlmBranchInput[];
  text?: string;
  notes?: string;
  children?: LlmBranchInput[];
}

interface LlmStructuredPayload {
  explanation?: string;
  operations?: LlmOperationInput[];
}

function extractJsonPayload(rawText: string): LlmStructuredPayload | null {
  const trimmed = rawText.trim();
  if (!trimmed) return null;

  const candidates: string[] = [trimmed];

  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    candidates.push(fenceMatch[1].trim());
  }

  const firstBrace = trimmed.indexOf("{");
  const lastBrace = trimmed.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as LlmStructuredPayload | LlmOperationInput;
      if (parsed && typeof parsed === "object") {
        if ("operations" in parsed && Array.isArray(parsed.operations)) {
          return parsed as LlmStructuredPayload;
        }
        if ("type" in parsed && typeof parsed.type === "string") {
          return { operations: [parsed as LlmOperationInput] };
        }
      }
    } catch {
      // Try next candidate
    }
  }

  return null;
}

function resolveExistingNodeId(doc: MindMapDocument, idOrLabel?: string): string | null {
  if (!idOrLabel) return null;
  const trimmed = idOrLabel.trim();
  if (!trimmed) return null;
  if (doc.nodes[trimmed]) return trimmed;

  const lower = trimmed.toLowerCase();
  for (const node of Object.values(doc.nodes)) {
    if (getNodeShortLabel(node).toLowerCase() === lower || node.text.trim().toLowerCase() === lower) {
      return node.id;
    }
  }
  for (const node of Object.values(doc.nodes)) {
    if (getNodeShortLabel(node).toLowerCase().includes(lower)) {
      return node.id;
    }
  }
  return null;
}

function attachChatFilesToNodeObject(node: MindMapNode, files: LlmChatFile[]): boolean {
  if (files.length === 0) return false;
  let addedAny = false;
  for (const f of files) {
    const isImage = (f.mimeType || "").toLowerCase().startsWith("image/");
    if (isImage) {
      const existing = node.images || [];
      if (!existing.some((img) => img.url === f.url && img.name === f.name)) {
        node.images = [
          ...existing,
          { id: makeId("img"), url: f.url, name: f.name, width: 210 },
        ];
        addedAny = true;
      }
    } else {
      const existing = node.attachments || [];
      if (!existing.some((att) => att.url === f.url && att.name === f.name)) {
        node.attachments = [
          ...existing,
          {
            id: makeId("att"),
            url: f.url,
            name: f.name,
            mimeType: f.mimeType || "application/octet-stream",
            size: f.size,
          },
        ];
        addedAny = true;
      }
    }
  }
  return addedAny;
}

function pushAffectedRecord(
  records: LlmNodeChangeRecord[],
  record: LlmNodeChangeRecord
): void {
  if (!records.some((r) => r.nodeId === record.nodeId && r.action === record.action)) {
    records.push(record);
  }
}

export function parseAndApplyLlmResponse(
  doc: MindMapDocument,
  rawResponse: string,
  fallbackParentId: string,
  uploadedFiles: LlmChatFile[] = []
): {
  doc: MindMapDocument;
  explanation: string;
  affectedNodes: LlmNodeChangeRecord[];
  firstAffectedNodeId: string | null;
} {
  const safeFallbackParentId = doc.nodes[fallbackParentId]
    ? fallbackParentId
    : doc.rootIds[0] || Object.keys(doc.nodes)[0];

  const structured = extractJsonPayload(rawResponse);

  // Fallback: treat plain Markdown response as subtree branches under fallbackParentId
  if (!structured || !Array.isArray(structured.operations) || structured.operations.length === 0) {
    const branches: SubtreeBranch[] = parseMarkdownToSubtree(rawResponse);
    if (branches.length === 0) {
      return {
        doc,
        explanation: rawResponse.trim() || "No changes were applied to the mind map.",
        affectedNodes: [],
        firstAffectedNodeId: null,
      };
    }

    const res = insertSubtreeBranches(doc, safeFallbackParentId, branches);
    let nextDoc = res.doc;
    const affectedNodes: LlmNodeChangeRecord[] = [];
    const parentNode = nextDoc.nodes[safeFallbackParentId];
    if (parentNode) {
      pushAffectedRecord(affectedNodes, {
        nodeId: parentNode.id,
        nodeLabel: getNodeShortLabel(parentNode),
        action: "created_under",
      });
    }
    if (res.firstAddedId && nextDoc.nodes[res.firstAddedId]) {
      if (uploadedFiles.length > 0) {
        nextDoc = cloneDocument(nextDoc);
        attachChatFilesToNodeObject(nextDoc.nodes[res.firstAddedId], uploadedFiles);
      }
      pushAffectedRecord(affectedNodes, {
        nodeId: res.firstAddedId,
        nodeLabel: getNodeShortLabel(nextDoc.nodes[res.firstAddedId]),
        action: "created_node",
      });
    }

    const parentLabel = parentNode ? getNodeShortLabel(parentNode) : "selected node";
    return {
      doc: nextDoc,
      explanation: `Added ${branches.length} new branch(es) under "${parentLabel}".`,
      affectedNodes,
      firstAffectedNodeId: res.firstAddedId || safeFallbackParentId,
    };
  }

  const next = cloneDocument(doc);
  const affectedNodes: LlmNodeChangeRecord[] = [];
  let firstAffectedNodeId: string | null = null;
  let filesAttached = false;

  const createBranchRecursive = (
    branch: LlmBranchInput,
    parentId: string,
    inheritedSide?: "left" | "right",
    isTopLevel = true
  ): string | null => {
    const pNode = next.nodes[parentId];
    if (!pNode) return null;
    const text = String(branch.text || "").trim();
    if (!text) return null;

    const id = makeId("node");
    if (!firstAffectedNodeId) firstAffectedNodeId = id;

    let side = inheritedSide;
    if (pNode.parentId === null && next.layout === "mindmap") {
      const rightCount = pNode.childrenIds.filter((c) => next.nodes[c]?.side === "right").length;
      const leftCount = pNode.childrenIds.filter((c) => next.nodes[c]?.side === "left").length;
      side = rightCount <= leftCount ? "right" : "left";
    }

    const newNode: MindMapNode = {
      id,
      parentId,
      childrenIds: [],
      text,
      notes: branch.notes ? String(branch.notes) : undefined,
      side,
    };

    if (branch.attachFiles && uploadedFiles.length > 0) {
      if (attachChatFilesToNodeObject(newNode, uploadedFiles)) {
        filesAttached = true;
      }
    }

    next.nodes[id] = newNode;
    pNode.collapsed = false;
    pNode.childrenIds.push(id);

    if (isTopLevel) {
      pushAffectedRecord(affectedNodes, {
        nodeId: id,
        nodeLabel: getNodeShortLabel(newNode),
        action: "created_node",
      });
    }

    if (Array.isArray(branch.children)) {
      for (const child of branch.children) {
        createBranchRecursive(child, id, side, false);
      }
    }
    return id;
  };

  for (const op of structured.operations) {
    if (!op || typeof op !== "object") continue;
    const opType = String(op.type || "").toLowerCase();

    if (opType === "modify_node") {
      const targetId = resolveExistingNodeId(next, op.nodeId || op.targetId);
      const target = targetId ? next.nodes[targetId] : null;
      if (!target) continue;

      if (typeof op.newText === "string" && op.newText.trim()) {
        target.text = op.newText;
        if (next.rootIds[0] === target.id) {
          const cleanTitle = target.text.split("\n")[0].replace(/[*#`]/g, "").trim();
          if (cleanTitle) next.title = cleanTitle;
        }
      } else if (typeof op.appendText === "string" && op.appendText.trim()) {
        target.text = `${target.text.trimEnd()}\n\n${op.appendText.trim()}`;
      }

      if (typeof op.newNotes === "string") {
        target.notes = op.newNotes;
      }

      if (op.attachFiles && uploadedFiles.length > 0) {
        if (attachChatFilesToNodeObject(target, uploadedFiles)) {
          filesAttached = true;
        }
      }

      if (!firstAffectedNodeId) firstAffectedNodeId = target.id;
      pushAffectedRecord(affectedNodes, {
        nodeId: target.id,
        nodeLabel: getNodeShortLabel(target),
        action: "modified",
      });
    } else if (opType === "create_child_nodes") {
      const resolvedParentId =
        resolveExistingNodeId(next, op.parentId || op.nodeId) || safeFallbackParentId;
      const parentNode = next.nodes[resolvedParentId];
      if (!parentNode) continue;

      const branches = Array.isArray(op.branches)
        ? op.branches
        : op.text
        ? [{ text: op.text, notes: op.notes, attachFiles: op.attachFiles, children: op.children }]
        : [];
      if (branches.length === 0) continue;

      pushAffectedRecord(affectedNodes, {
        nodeId: parentNode.id,
        nodeLabel: getNodeShortLabel(parentNode),
        action: "created_under",
      });

      for (const branch of branches) {
        createBranchRecursive(branch, parentNode.id, parentNode.side, true);
      }
    } else if (opType === "create_root_node") {
      const text = String(op.text || "").trim();
      if (!text) continue;
      const rootId = makeId("root");
      if (!firstAffectedNodeId) firstAffectedNodeId = rootId;

      const rootCount = next.rootIds.length;
      const newRoot: MindMapNode = {
        id: rootId,
        parentId: null,
        childrenIds: [],
        text,
        notes: op.notes ? String(op.notes) : undefined,
        position: { x: 0, y: 240 * rootCount },
        style: { shape: "rounded", fontSize: 15 },
      };

      if (op.attachFiles && uploadedFiles.length > 0) {
        if (attachChatFilesToNodeObject(newRoot, uploadedFiles)) {
          filesAttached = true;
        }
      }

      next.nodes[rootId] = newRoot;
      next.rootIds.push(rootId);
      pushAffectedRecord(affectedNodes, {
        nodeId: rootId,
        nodeLabel: getNodeShortLabel(newRoot),
        action: "created_root",
      });

      if (Array.isArray(op.children)) {
        for (const child of op.children) {
          createBranchRecursive(child, rootId, undefined, false);
        }
      }
    }
  }

  // Ensure uploaded files are always attached to an affected node if the LLM didn't mark attachFiles
  if (uploadedFiles.length > 0 && !filesAttached) {
    const targetForFiles =
      (firstAffectedNodeId && next.nodes[firstAffectedNodeId]) || next.nodes[safeFallbackParentId];
    if (targetForFiles) {
      attachChatFilesToNodeObject(targetForFiles, uploadedFiles);
      if (affectedNodes.length === 0) {
        pushAffectedRecord(affectedNodes, {
          nodeId: targetForFiles.id,
          nodeLabel: getNodeShortLabel(targetForFiles),
          action: "modified",
        });
      }
    }
  }

  if (affectedNodes.length === 0) {
    return {
      doc,
      explanation:
        (typeof structured.explanation === "string" && structured.explanation.trim()) ||
        "No node modifications were produced.",
      affectedNodes: [],
      firstAffectedNodeId: null,
    };
  }

  next.updatedAt = new Date().toISOString();

  const explanation =
    typeof structured.explanation === "string" && structured.explanation.trim()
      ? structured.explanation.trim()
      : `Updated mind map (${affectedNodes.map((a) => a.nodeLabel).join(", ")}).`;

  return {
    doc: next,
    explanation,
    affectedNodes,
    firstAffectedNodeId,
  };
}

function buildDirectFileSummary(file: LlmChatFile): string {
  const sizeKb = Math.max(1, Math.round((file.size || 0) / 1024));
  const header = `[Attached file: ${file.name} | type: ${file.mimeType || "application/octet-stream"} | size: ${sizeKb} KB | url: ${file.url || ""}]`;
  if (file.textContent) {
    const trimmed =
      file.textContent.length > 60000
        ? `${file.textContent.slice(0, 60000)}\n...(truncated)`
        : file.textContent;
    return `${header}\n\`\`\`\n${trimmed}\n\`\`\``;
  }
  return header;
}

function extractDirectError(rawText: string, statusText: string): string {
  if (!rawText) return statusText || "Unknown API error";
  try {
    const parsed = JSON.parse(rawText) as {
      error?: string | { message?: string };
      message?: string;
    };
    if (parsed?.error && typeof parsed.error === "object" && parsed.error.message) {
      return parsed.error.message;
    }
    if (typeof parsed?.error === "string") return parsed.error;
    if (parsed?.message) return parsed.message;
  } catch {
    // Plain text error
  }
  return rawText.slice(0, 1000);
}

export async function callLlmProvider(params: {
  config: LlmConfig;
  systemPrompt: string;
  messages: LlmChatMessage[];
}): Promise<string> {
  const { config, systemPrompt, messages } = params;
  const apiKey = config.apiKey.trim();
  if (!apiKey) {
    throw new LlmApiError(
      "Missing LLM provider API key. Please add your API key in the assistant settings.",
      400
    );
  }

  const sanitizedMessages = messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .slice(-16)
    .map((m) => ({
      role: m.role,
      content: m.content,
      files: m.files?.map((f) => ({
        name: f.name,
        url: f.url,
        mimeType: f.mimeType,
        size: f.size,
        textContent: f.textContent,
        dataUrl: f.dataUrl,
      })),
    }));

  // 1. Try local backend proxy first (/api/llm/chat)
  let shouldFallbackDirect = false;
  try {
    const proxyRes = await fetch("/api/llm/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        provider: config.provider,
        apiKey,
        model: config.model.trim() || LLM_PROVIDER_META[config.provider].defaultModel,
        baseUrl: config.baseUrl?.trim(),
        systemPrompt,
        messages: sanitizedMessages,
      }),
    });

    if (proxyRes.status === 404) {
      shouldFallbackDirect = true;
    } else {
      const rawBody = await proxyRes.text();
      if (!proxyRes.ok) {
        let errMsg = extractDirectError(rawBody, proxyRes.statusText);
        let rawError = rawBody;
        try {
          const parsed = JSON.parse(rawBody) as { error?: string; rawError?: string };
          if (parsed.error) errMsg = parsed.error;
          if (parsed.rawError) rawError = parsed.rawError;
        } catch {}
        throw new LlmApiError(errMsg, proxyRes.status, rawError);
      }
      const data = JSON.parse(rawBody) as { text?: string };
      return String(data.text || "");
    }
  } catch (err) {
    if (err instanceof LlmApiError) throw err;
    shouldFallbackDirect = true;
  }

  if (!shouldFallbackDirect) {
    throw new LlmApiError("Failed to contact LLM proxy.");
  }

  // 2. Direct browser fallback when running without backend proxy (e.g., static hosting)
  if (config.provider === "anthropic") {
    throw new LlmApiError(
      "Backend proxy (/api/llm/chat) is unreachable, and Anthropic API requests require the server proxy due to browser CORS restrictions.",
      502
    );
  }

  if (config.provider === "gemini") {
    const model = config.model.trim() || LLM_PROVIDER_META.gemini.defaultModel;
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const contents = sanitizedMessages.map((msg) => ({
      role: msg.role === "assistant" ? "model" : "user",
      parts: [
        {
          text:
            [
              msg.content,
              ...(msg.files || []).map((f) => buildDirectFileSummary(f as LlmChatFile)),
            ]
              .filter(Boolean)
              .join("\n\n") || "Analyze the attached files.",
        },
      ],
    }));

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: { temperature: 0.2 },
      }),
    });
    const raw = await res.text();
    if (!res.ok) {
      throw new LlmApiError(extractDirectError(raw, res.statusText), res.status, raw);
    }
    const parsed = JSON.parse(raw) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return (parsed.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  }

  // OpenAI / Custom direct fallback
  const base = (
    config.provider === "custom" && config.baseUrl ? config.baseUrl : "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
  const endpoint = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: config.model.trim() || LLM_PROVIDER_META[config.provider].defaultModel,
      messages: [
        { role: "system", content: systemPrompt },
        ...sanitizedMessages.map((m) => ({
          role: m.role,
          content:
            [m.content, ...(m.files || []).map((f) => buildDirectFileSummary(f as LlmChatFile))]
              .filter(Boolean)
              .join("\n\n") || "Analyze the attached files.",
        })),
      ],
      temperature: 0.2,
    }),
  });
  const raw = await res.text();
  if (!res.ok) {
    throw new LlmApiError(extractDirectError(raw, res.statusText), res.status, raw);
  }
  const parsed = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return String(parsed.choices?.[0]?.message?.content || "").trim();
}
