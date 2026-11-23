export type LayoutMode = "mindmap" | "tree-right" | "org-chart";

export type ConnectorStyle = "bezier" | "orthogonal" | "straight";

export type NodeShape = "rounded" | "card" | "underline" | "cloud";

export type ThemeId = "ocean" | "midnight" | "pastel" | "solarized" | "emerald";

export type ColorSchemePreference = "system" | "light" | "dark";

export type NodeAlign = "left" | "center" | "right";

export type CanvasTool = "select" | "hand";

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
}

export interface MindMapDocument {
  id: string;
  title: string;
  rootIds: string[];
  nodes: Record<string, MindMapNode>;
  crossLinks: CrossLink[];
  layout: LayoutMode;
  theme: ThemeId;
  connectorStyle: ConnectorStyle;
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
