export type LayoutMode = "mindmap" | "tree-right" | "org-chart";

export type ConnectorStyle = "bezier" | "orthogonal" | "straight";

export type NodeShape = "rounded" | "card" | "underline" | "cloud";

export type ThemeId = "ocean" | "midnight" | "pastel" | "solarized" | "emerald";

export type ColorSchemePreference = "system" | "light" | "dark";

export type NodeAlign = "left" | "center" | "right";

export type CanvasTool = "select" | "hand";

export type SaveState = "saved" | "saving" | "unsaved" | "error";

export type ColorMode = "contrast" | "colorful" | "custom";

export type CrossLinkStrokeStyle = "dashed" | "dotted" | "solid";

export type CrossLinkLayer = "above" | "behind";

export type CanvasBackground = "dots" | "grid-sm" | "grid-md" | "grid-lg" | "plain";

export interface NodeImage {
  id: string;
  url: string;
  name: string;
  width?: number;
  height?: number;
  caption?: string;
  fit?: "contain" | "cover";
  position?: "top" | "bottom";
  align?: "left" | "center" | "right";
}

export interface NodeAttachment {
  id: string;
  url: string;
  name: string;
  mimeType: string;
  size: number;
}

export interface NodeStyle {
  color?: string;
  borderColor?: string;
  edgeColor?: string;
  textColor?: string;
  fontSize?: number;
  align?: NodeAlign;
  shape?: NodeShape;
  width?: number;
  minHeight?: number;
}

export interface MindMapNode {
  id: string;
  parentId: string | null;
  childrenIds: string[];
  text: string;
  notes?: string;
  collapsed?: boolean;
  side?: "left" | "right";
  position?: { x: number; y: number };
  style?: NodeStyle;
  stickers?: string[];
  images?: NodeImage[];
  attachments?: NodeAttachment[];
}

export interface CrossLink {
  id: string;
  fromId: string;
  toId: string;
  label?: string;
  color?: string;
  strokeStyle?: CrossLinkStrokeStyle;
  layer?: CrossLinkLayer;
}

export interface MindMapDocument {
  id: string;
  title: string;
  rootIds: string[];
  nodes: Record<string, MindMapNode>;
  crossLinks: CrossLink[];
  layout: LayoutMode;
  theme: ThemeId;
  colorMode?: ColorMode;
  connectorStyle: ConnectorStyle;
  horizontalGap?: number;
  backgroundPattern?: CanvasBackground;
  createdAt: string;
  updatedAt: string;
}

export interface MapSummary {
  id: string;
  title: string;
  updatedAt: string;
  nodeCount: number;
}

export interface LayoutNodeInfo {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  depth: number;
  branchColor: string;
  side: "center" | "left" | "right" | "down";
  rootId: string;
}

export type LlmProviderId = "openai" | "gemini" | "anthropic" | "custom";

export interface LlmConfig {
  provider: LlmProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface LlmChatFile {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
  textContent?: string;
  dataUrl?: string;
}

export interface LlmNodeChangeRecord {
  nodeId: string;
  nodeLabel: string;
  action: "modified" | "created_under" | "created_node" | "created_root";
}

export interface LlmChatMessage {
  id: string;
  role: "user" | "assistant" | "error";
  content: string;
  createdAt: string;
  files?: LlmChatFile[];
  affectedNodes?: LlmNodeChangeRecord[];
  rawError?: string;
}

export interface LlmConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: LlmChatMessage[];
}
