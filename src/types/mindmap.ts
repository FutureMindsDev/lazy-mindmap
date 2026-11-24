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

export type CrossLinkHeadType = "arrow" | "circle-outline" | "circle-filled" | "none";

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
  startHead?: CrossLinkHeadType;
  endHead?: CrossLinkHeadType;
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

export type AiAccessMode = "managed" | "trial" | "byok_vault" | "byok_session";

export type ByokStorageMode = "vault" | "session";

export interface LlmConfig {
  provider: LlmProviderId;
  apiKey: string;
  model: string;
  baseUrl?: string;
  mode?: AiAccessMode;
  byokStorage?: ByokStorageMode;
}

export type SubscriptionPlan = "free" | "monthly" | "yearly";
export type SubscriptionStatus = "none" | "pending" | "active" | "expired" | "revoked";

export interface ByokVaultInfo {
  configured: boolean;
  provider?: LlmProviderId;
  model?: string;
  baseUrl?: string;
  keyHint?: string;
  updatedAt?: string | null;
}

export interface UserAccountState {
  authenticated: boolean;
  firebaseConfigured: boolean;
  isAdmin: boolean;
  user?: {
    uid: string;
    email: string;
    displayName: string;
    photoURL: string;
    emailVerified: boolean;
    providers: string[];
    role: "user" | "admin";
    status: "active" | "suspended";
    createdAt: string;
  };
  subscription?: {
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
    startedAt: string | null;
    expiresAt: string | null;
  };
  trial?: {
    used: number;
    limit: number;
    remaining: number;
    lastUsedAt: string | null;
  };
  quota?: {
    dailyUsed: number;
    dailyLimit: number;
    dailyRemaining: number;
    monthlyUsed: number;
    monthlyLimit: number;
    monthlyRemaining: number;
  };
  byok?: ByokVaultInfo;
  billing: {
    referenceCode?: string;
    monthlyPriceMmk: number;
    yearlyPriceMmk: number;
    managedModel: string;
    trialModel: string;
    dailyQuota: number;
    monthlyQuota: number;
    maxTrialCount: number;
  };
}

export interface PaymentSubmission {
  id: string;
  uid: string;
  userEmail: string;
  userDisplayName: string;
  plan: "monthly" | "yearly";
  amountMmk: number;
  transactionId: string;
  referenceCode: string;
  note: string;
  status: "pending" | "approved" | "rejected";
  createdAt: string;
  reviewedAt: string | null;
  reviewNote: string;
  hasReceipt: boolean;
  reviewedBy?: string | null;
  receiptUrl?: string | null;
}

export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPrevPage: boolean;
}

export interface AdminOverview {
  totalUsers: number;
  activeSubscribers: number;
  pendingPayments: number;
  totalTrialsUsed: number;
  monthlyManagedCalls: number;
  dailyManagedCalls: number;
}

export interface AdminUserRow {
  uid: string;
  email: string;
  displayName: string;
  emailVerified: boolean;
  providers: string[];
  role: "user" | "admin";
  status: "active" | "suspended";
  subscription: {
    plan: SubscriptionPlan;
    status: SubscriptionStatus;
    startedAt: string | null;
    expiresAt: string | null;
  };
  trial: {
    used: number;
    limit: number;
    lastUsedAt: string | null;
  };
  quota: {
    dailyUsed: number;
    dailyLimit: number;
    monthlyUsed: number;
    monthlyLimit: number;
  };
  lastGeo: { country?: string | null; city?: string | null } | null;
  hasDeviceSignal: boolean;
  lastIpHashPrefix: string;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
}

export interface AdminAiConfig {
  managedProvider: string;
  managedModel: string;
  trialModel: string;
  monthlyQuota: number;
  dailyQuota: number;
  monthlyPriceMmk: number;
  yearlyPriceMmk: number;
  maxTrialCount: number;
  hasManagedKey: boolean;
  managedKeyHint: string;
  managedKeySource: "vault" | "env" | "none";
  hasTrialKey: boolean;
  trialKeyHint: string;
  trialKeySource: "vault" | "env" | "none";
  curatedModels: string[];
  updatedAt: string | null;
  updatedBy: string | null;
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
