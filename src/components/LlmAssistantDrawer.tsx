import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Crown,
  Eye,
  EyeOff,
  FileText,
  History,
  KeyRound,
  Loader2,
  Lock,
  MessageSquare,
  MessageSquarePlus,
  Paperclip,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserCheck,
  X,
} from "lucide-react";
import type {
  AiAccessMode,
  ByokStorageMode,
  LlmChatFile,
  LlmChatMessage,
  LlmConfig,
  LlmConversation,
  LlmNodeChangeRecord,
  LlmProviderId,
  MindMapDocument,
  UserAccountState,
} from "../types/mindmap";
import { deleteByokVaultKey, saveByokVaultKey } from "../utils/accountApi";
import { renderRichNodeContent } from "../utils/llmMathNormalizer";
import {
  buildMindMapSystemPrompt,
  callLlmProvider,
  createNewConversation,
  deriveConversationTitle,
  findRelatedNodes,
  getNodeShortLabel,
  LLM_PROVIDER_META,
  LlmApiError,
  loadActiveConversationId,
  loadLlmConfig,
  loadLlmConversations,
  parseAndApplyLlmResponse,
  readFileForChat,
  saveActiveConversationId,
  saveLlmConfig,
  saveLlmConversations,
} from "../utils/llmMindMapAgent";
import { makeId } from "../utils/treeOps";

interface LlmAssistantDrawerProps {
  open: boolean;
  doc: MindMapDocument;
  selectedIds: string[];
  primarySelectedId: string;
  account: UserAccountState;
  onToggleOpen: () => void;
  onClose: () => void;
  onApplyDocChange: (nextDoc: MindMapDocument, focusNodeId: string | null) => void;
  onFocusNode: (nodeId: string) => void;
  onOpenClassicMarkdownPaste: () => void;
  onOpenAuth: () => void;
  onOpenSubscription: () => void;
  onRefreshAccount: () => Promise<unknown>;
  onAnnounce: (msg: string) => void;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatDateTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString([], {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function actionLabel(action: LlmNodeChangeRecord["action"]): string {
  switch (action) {
    case "modified":
      return "Modified";
    case "created_under":
      return "Added under";
    case "created_root":
      return "New root";
    case "created_node":
    default:
      return "Created";
  }
}

export function LlmAssistantDrawer({
  open,
  doc,
  selectedIds,
  primarySelectedId,
  account,
  onToggleOpen,
  onClose,
  onApplyDocChange,
  onFocusNode,
  onOpenClassicMarkdownPaste,
  onOpenAuth,
  onOpenSubscription,
  onRefreshAccount,
  onAnnounce,
}: LlmAssistantDrawerProps) {
  const [config, setConfig] = useState<LlmConfig>(() => loadLlmConfig());
  const [draftConfig, setDraftConfig] = useState<LlmConfig>(() => loadLlmConfig());
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [savingSettings, setSavingSettings] = useState<boolean>(false);
  const [settingsFeedback, setSettingsFeedback] = useState<string | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [historyViewOpen, setHistoryViewOpen] = useState(false);

  const [conversations, setConversations] = useState<LlmConversation[]>(() =>
    loadLlmConversations()
  );
  const [activeConversationId, setActiveConversationId] = useState<string>(() =>
    loadActiveConversationId(conversations)
  );
  const [prompt, setPrompt] = useState("");
  const [stagedFiles, setStagedFiles] = useState<LlmChatFile[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [expandedRawErrors, setExpandedRawErrors] = useState<Record<string, boolean>>({});
  const [errorCodes, setErrorCodes] = useState<Record<string, string>>({});

  const drawerId = useId();
  const inputId = useId();
  const providerSelectId = useId();
  const modelInputId = useId();
  const apiKeyInputId = useId();
  const baseUrlInputId = useId();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const apiKeyInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const docRef = useRef(doc);
  docRef.current = doc;
  const selectedIdsRef = useRef(selectedIds);
  selectedIdsRef.current = selectedIds;
  const primarySelectedIdRef = useRef(primarySelectedId);
  primarySelectedIdRef.current = primarySelectedId;

  const activeConversation = useMemo(
    () => conversations.find((c) => c.id === activeConversationId) || conversations[0],
    [conversations, activeConversationId]
  );
  const messages = activeConversation?.messages || [];

  const isUsingByok = config.mode === "byok_vault" || config.mode === "byok_session";
  const isDraftByok = draftConfig.mode === "byok_vault" || draftConfig.mode === "byok_session";
  const isProActive = Boolean(account.authenticated && account.subscription?.status === "active");

  const effectiveRunMode: AiAccessMode = useMemo(() => {
    if (isUsingByok) {
      return config.byokStorage === "session" ? "byok_session" : "byok_vault";
    }
    return isProActive ? "managed" : "trial";
  }, [isUsingByok, config.byokStorage, isProActive]);

  const isAiReady = useMemo(() => {
    if (effectiveRunMode === "byok_session") return Boolean(config.apiKey.trim());
    if (effectiveRunMode === "byok_vault") {
      return Boolean(account.authenticated && account.byok?.configured);
    }
    if (effectiveRunMode === "managed") {
      return Boolean(
        account.authenticated &&
          account.subscription?.status === "active" &&
          (account.quota?.monthlyRemaining ?? 0) > 0 &&
          (account.quota?.dailyRemaining ?? 0) > 0
      );
    }
    return Boolean(
      account.authenticated &&
        (account.user?.emailVerified || !account.firebaseConfigured) &&
        (account.trial?.remaining ?? 0) > 0
    );
  }, [effectiveRunMode, config.apiKey, account]);

  const headerModeLabel = useMemo(() => {
    if (effectiveRunMode === "byok_session") {
      return `BYOK RAM · ${LLM_PROVIDER_META[config.provider].label}`;
    }
    if (effectiveRunMode === "byok_vault") {
      const p = account.byok?.provider || config.provider;
      return `BYOK Vault · ${LLM_PROVIDER_META[p].label}`;
    }
    if (effectiveRunMode === "managed") {
      return `Pro · ${account.billing.managedModel}`;
    }
    if (!account.authenticated) {
      return `Trial (${account.billing.maxTrialCount} Free)`;
    }
    return `Trial (${account.trial?.remaining ?? 0}/${account.billing.maxTrialCount})`;
  }, [effectiveRunMode, config.provider, account]);

  // Wipe in-memory session key if user signs out so keys never leak across sessions
  const prevUidRef = useRef<string | null>(account.user?.uid || null);
  useEffect(() => {
    const nextUid = account.user?.uid || null;
    if (prevUidRef.current && prevUidRef.current !== nextUid) {
      setConfig((prev) => ({ ...prev, apiKey: "" }));
      setDraftConfig((prev) => ({ ...prev, apiKey: "" }));
    }
    prevUidRef.current = nextUid;
  }, [account.user?.uid]);

  // Sync non-secret provider/model display from vaulted BYOK when configured
  useEffect(() => {
    if (account.byok?.configured && account.byok.provider) {
      setDraftConfig((prev) => ({
        ...prev,
        provider: account.byok?.provider || prev.provider,
        model: account.byok?.model || prev.model,
        baseUrl: account.byok?.baseUrl ?? prev.baseUrl,
      }));
    }
  }, [account.byok]);

  useEffect(() => {
    saveLlmConversations(conversations);
  }, [conversations]);

  useEffect(() => {
    if (activeConversation?.id) {
      saveActiveConversationId(activeConversation.id);
    }
  }, [activeConversation?.id]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        if (!historyViewOpen) {
          textareaRef.current?.focus();
        }
      });
    }
  }, [open, historyViewOpen]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.querySelector("dialog[open]")) return;
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onClose]);

  useEffect(() => {
    if (open && !historyViewOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messages.length, sending, open, historyViewOpen]);

  // Live preview of existing nodes related to the prompt / selection that may be modified
  const relatedTargetNodes = useMemo(
    () => findRelatedNodes(doc, prompt, selectedIds),
    [doc, prompt, selectedIds]
  );

  const handleFilesSelected = async (fileList: FileList | File[]) => {
    const incoming = Array.from(fileList);
    if (incoming.length === 0) return;
    setUploadingFiles(true);
    try {
      const processed: LlmChatFile[] = [];
      for (const file of incoming) {
        processed.push(await readFileForChat(file));
      }
      setStagedFiles((prev) => [...prev, ...processed]);
      onAnnounce(`Staged ${processed.length} file(s) for AI prompt`);
    } catch (err) {
      onAnnounce(err instanceof Error ? err.message : "Failed to attach file");
    } finally {
      setUploadingFiles(false);
    }
  };

  const handleSwitchMode = (nextMode: "managed" | "byok") => {
    setSettingsFeedback(null);
    const resolvedMode: AiAccessMode =
      nextMode === "byok"
        ? draftConfig.byokStorage === "session"
          ? "byok_session"
          : "byok_vault"
        : isProActive
        ? "managed"
        : "trial";
    const nextCfg: LlmConfig = { ...config, mode: resolvedMode };
    setConfig(nextCfg);
    setDraftConfig((prev) => ({ ...prev, mode: resolvedMode }));
    saveLlmConfig(nextCfg);
    onAnnounce(
      nextMode === "byok" ? "Switched AI Assistant to BYOK (Free)" : "Switched AI Assistant to Managed AI"
    );
  };

  const handleDeleteVaultKey = async () => {
    setSavingSettings(true);
    setSettingsFeedback(null);
    try {
      await deleteByokVaultKey();
      await onRefreshAccount();
      setSettingsFeedback("Deleted BYOK API key from Encrypted Cloud Vault.");
      onAnnounce("Deleted vaulted BYOK key");
    } catch (err) {
      setSettingsFeedback(err instanceof Error ? err.message : "Failed to delete vaulted key.");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveConfig = async (e?: FormEvent) => {
    e?.preventDefault();
    setSettingsFeedback(null);
    const storageMode: ByokStorageMode = draftConfig.byokStorage === "session" ? "session" : "vault";
    const resolvedMode: AiAccessMode = storageMode === "session" ? "byok_session" : "byok_vault";
    const model =
      draftConfig.model.trim() || LLM_PROVIDER_META[draftConfig.provider].defaultModel;
    const baseUrl = draftConfig.baseUrl?.trim() || "";
    const trimmedKey = draftConfig.apiKey.trim();

    if (storageMode === "vault") {
      if (!account.authenticated) {
        setSettingsFeedback("Sign in to store your key in the AES-256-GCM Encrypted Cloud Vault, or pick Session-Only (RAM).");
        onOpenAuth();
        return;
      }
      if (!trimmedKey && !account.byok?.configured) {
        setSettingsFeedback("Please enter an API key to encrypt and store in your Cloud Vault.");
        return;
      }
      setSavingSettings(true);
      try {
        await saveByokVaultKey({
          provider: draftConfig.provider,
          model,
          baseUrl,
          apiKey: trimmedKey || undefined,
        });
        await onRefreshAccount();
        const cleaned: LlmConfig = {
          provider: draftConfig.provider,
          apiKey: "", // Never retained in client memory once vaulted
          model,
          baseUrl,
          mode: "byok_vault",
          byokStorage: "vault",
        };
        setConfig(cleaned);
        setDraftConfig(cleaned);
        saveLlmConfig(cleaned);
        setSettingsOpen(false);
        onAnnounce("BYOK key encrypted and saved in Cloud Vault");
        requestAnimationFrame(() => textareaRef.current?.focus());
      } catch (err) {
        setSettingsFeedback(err instanceof Error ? err.message : "Failed to save vaulted key.");
      } finally {
        setSavingSettings(false);
      }
      return;
    }

    // Session-Only (RAM): kept strictly in React state, never written to localStorage
    if (!trimmedKey) {
      setSettingsFeedback("Please enter an API key for this session.");
      return;
    }
    const sessionCfg: LlmConfig = {
      provider: draftConfig.provider,
      apiKey: trimmedKey,
      model,
      baseUrl,
      mode: resolvedMode,
      byokStorage: "session",
    };
    setConfig(sessionCfg);
    setDraftConfig(sessionCfg);
    saveLlmConfig(sessionCfg); // Automatically strips apiKey before localStorage persistence
    setSettingsOpen(false);
    onAnnounce(`${LLM_PROVIDER_META[sessionCfg.provider].label} session key ready (RAM only)`);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const updateConversationMessages = (
    convId: string,
    updater: (prevMsgs: LlmChatMessage[]) => LlmChatMessage[]
  ) => {
    const now = new Date().toISOString();
    setConversations((prev) =>
      prev.map((c) => {
        if (c.id !== convId) return c;
        const nextMsgs = updater(c.messages);
        return {
          ...c,
          title: deriveConversationTitle(nextMsgs),
          updatedAt: now,
          messages: nextMsgs,
        };
      })
    );
  };

  const handleNewConversation = () => {
    if (activeConversation && activeConversation.messages.length === 0) {
      setHistoryViewOpen(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
      return;
    }
    const fresh = createNewConversation();
    setConversations((prev) => [fresh, ...prev]);
    setActiveConversationId(fresh.id);
    setHistoryViewOpen(false);
    setPrompt("");
    setStagedFiles([]);
    onAnnounce("Started a new AI conversation");
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  const handleDeleteConversation = (convId: string) => {
    setConversations((prev) => {
      const remaining = prev.filter((c) => c.id !== convId);
      if (remaining.length === 0) {
        const fresh = createNewConversation();
        setActiveConversationId(fresh.id);
        return [fresh];
      }
      if (convId === activeConversation?.id) {
        setActiveConversationId(remaining[0].id);
      }
      return remaining;
    });
    onAnnounce("Deleted conversation");
  };

  const handleClearAllConversations = () => {
    const fresh = createNewConversation();
    setConversations([fresh]);
    setActiveConversationId(fresh.id);
    onAnnounce("Cleared all AI conversations");
  };

  const executeLlmTurn = async (
    convId: string,
    historyUpToUserMsg: LlmChatMessage[],
    userFiles: LlmChatFile[]
  ) => {
    setSending(true);
    try {
      const curDoc = docRef.current;
      const curSelected = selectedIdsRef.current;
      const curPrimary = primarySelectedIdRef.current;
      const systemPrompt = buildMindMapSystemPrompt(curDoc, curSelected, userFiles);
      const rawReply = await callLlmProvider({
        config,
        mode: effectiveRunMode,
        systemPrompt,
        messages: historyUpToUserMsg,
      });

      const applied = parseAndApplyLlmResponse(
        docRef.current,
        rawReply,
        curPrimary,
        userFiles
      );

      if (applied.doc !== docRef.current) {
        onApplyDocChange(applied.doc, applied.firstAffectedNodeId);
      }

      const assistantMessage: LlmChatMessage = {
        id: makeId("msg"),
        role: "assistant",
        content: applied.explanation,
        createdAt: new Date().toISOString(),
        affectedNodes: applied.affectedNodes,
      };
      updateConversationMessages(convId, (prev) => [...prev, assistantMessage]);
      if (effectiveRunMode === "trial" || effectiveRunMode === "managed") {
        void onRefreshAccount();
      }
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "LLM API request failed with an unknown error.";
      const status = err instanceof LlmApiError && err.status ? ` (HTTP ${err.status})` : "";
      const rawError = err instanceof LlmApiError ? err.rawError : undefined;
      const errCode = err instanceof LlmApiError ? err.code : undefined;
      const msgId = makeId("msg");

      if (errCode) {
        setErrorCodes((prev) => ({ ...prev, [msgId]: errCode }));
      }

      updateConversationMessages(convId, (prev) => [
        ...prev,
        {
          id: msgId,
          role: "error",
          content: `API Error${status}: ${errorMsg}`,
          createdAt: new Date().toISOString(),
          rawError,
        },
      ]);
    } finally {
      setSending(false);
    }
  };

  const pushPreflightError = (convId: string, msgText: string, code: string) => {
    const errId = makeId("msg");
    setErrorCodes((prev) => ({ ...prev, [errId]: code }));
    updateConversationMessages(convId, (prev) => [
      ...prev,
      {
        id: errId,
        role: "error",
        content: msgText,
        createdAt: new Date().toISOString(),
      },
    ]);
  };

  const checkPreflightAccess = (convId: string): boolean => {
    if (effectiveRunMode === "byok_session" && !config.apiKey.trim()) {
      setSettingsOpen(true);
      pushPreflightError(
        convId,
        "Your Session BYOK key is empty (RAM-only keys reset on reload). Add your API key above or switch to Managed AI.",
        "BYOK_MISSING"
      );
      requestAnimationFrame(() => apiKeyInputRef.current?.focus());
      return false;
    }
    if (effectiveRunMode === "byok_vault") {
      if (!account.authenticated) {
        pushPreflightError(
          convId,
          "Sign in to use your Encrypted Cloud Vault BYOK key, or switch to Session-Only (RAM).",
          "AUTH_REQUIRED"
        );
        return false;
      }
      if (!account.byok?.configured) {
        setSettingsOpen(true);
        pushPreflightError(
          convId,
          "No API key is saved in your Encrypted Cloud Vault yet. Save your key above and click Retry.",
          "BYOK_NOT_CONFIGURED"
        );
        return false;
      }
    }
    if (effectiveRunMode === "trial") {
      if (!account.authenticated) {
        pushPreflightError(
          convId,
          `Sign in (Email, Google, or Facebook) to use your ${account.billing.maxTrialCount} free AI trials — or switch to BYOK for free.`,
          "AUTH_REQUIRED"
        );
        return false;
      }
      if (account.firebaseConfigured && !account.user?.emailVerified) {
        pushPreflightError(
          convId,
          "Please verify your email address in Account Settings before using your 3 free AI trials.",
          "EMAIL_NOT_VERIFIED"
        );
        return false;
      }
      if ((account.trial?.remaining ?? 0) <= 0) {
        pushPreflightError(
          convId,
          `You have used all ${account.billing.maxTrialCount} free AI trials. Upgrade via KBZPay (${account.billing.monthlyPriceMmk.toLocaleString()} MMK/mo) or switch to free BYOK.`,
          "TRIAL_EXHAUSTED"
        );
        return false;
      }
    }
    return true;
  };

  const submitPrompt = async () => {
    const trimmed = prompt.trim();
    if ((!trimmed && stagedFiles.length === 0) || sending || uploadingFiles) return;
    if (!activeConversation) return;

    const convId = activeConversation.id;
    const currentFiles = stagedFiles;
    const userMessage: LlmChatMessage = {
      id: makeId("msg"),
      role: "user",
      content: trimmed || `Analyze attached file(s): ${currentFiles.map((f) => f.name).join(", ")}`,
      createdAt: new Date().toISOString(),
      files: currentFiles,
    };

    const nextHistory = [...activeConversation.messages, userMessage];
    updateConversationMessages(convId, () => nextHistory);
    setPrompt("");
    setStagedFiles([]);
    setHistoryViewOpen(false);

    if (!checkPreflightAccess(convId)) return;

    await executeLlmTurn(convId, nextHistory, currentFiles);
  };

  const handleRetryError = async (errorMessageId: string) => {
    if (sending || uploadingFiles || !activeConversation) return;

    const convId = activeConversation.id;
    const msgs = activeConversation.messages;
    const errIdx = msgs.findIndex((m) => m.id === errorMessageId);
    if (errIdx < 0) return;

    let userIdx = -1;
    for (let i = errIdx - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        userIdx = i;
        break;
      }
    }

    if (userIdx < 0) {
      updateConversationMessages(convId, (prev) => prev.filter((m) => m.id !== errorMessageId));
      return;
    }

    if (!checkPreflightAccess(convId)) return;

    const userFiles = msgs[userIdx].files || [];
    const retryHistory = msgs.slice(0, userIdx + 1);
    updateConversationMessages(convId, (prev) => prev.filter((m) => m.id !== errorMessageId));
    await executeLlmTurn(convId, retryHistory, userFiles);
  };

  const handleTextareaKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (e.nativeEvent.isComposing || e.keyCode === 229) {
        return;
      }
      void submitPrompt();
    }
  };

  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files || []);
    if (files.length > 0) {
      e.preventDefault();
      await handleFilesSelected(files);
    }
  };

  const handleDrop = async (e: DragEvent<HTMLElement>) => {
    e.preventDefault();
    setDragActive(false);
    const files = Array.from(e.dataTransfer?.files || []);
    if (files.length > 0) {
      await handleFilesSelected(files);
    }
  };

  const sortedConversations = useMemo(() => {
    return [...conversations].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }, [conversations]);

  return (
    <>
      {/* Bottom-right Circular LLM Trigger Button */}
      <button
        type="button"
        className={`mf-llm-fab ${open ? "is-open" : ""}`}
        aria-label={open ? "Close AI Mind Map Assistant" : "Open AI Mind Map Assistant (Ctrl+Shift+V)"}
        aria-expanded={open}
        aria-controls={drawerId}
        title="AI Mind Map Assistant (Ctrl+Shift+V)"
        onClick={onToggleOpen}
      >
        {open ? <X size={22} aria-hidden="true" /> : <Sparkles size={22} aria-hidden="true" />}
        <span
          className={`mf-llm-fab-status ${isAiReady ? "is-ready" : "is-missing-key"}`}
          aria-hidden="true"
        />
      </button>

      {/* Right-side Sliding Chatbox Section */}
      <aside
        id={drawerId}
        className={`mf-llm-drawer ${open ? "is-open" : ""} ${dragActive ? "is-drag-over" : ""}`}
        aria-label="AI Mind Map Assistant Chat"
        aria-hidden={!open}
        {...(!open ? ({ inert: "" } as Record<string, string>) : {})}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragActive(false);
        }}
        onDrop={(e) => void handleDrop(e)}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="mf-llm-drawer-header">
          <div className="mf-llm-drawer-title">
            <Sparkles size={16} aria-hidden="true" />
            <span>AI Assistant</span>
            <span className="mf-llm-provider-pill">{headerModeLabel}</span>
          </div>

          <div className="mf-llm-header-actions">
            <button
              type="button"
              className="mf-btn"
              title="Start New Conversation"
              aria-label="Start New Conversation"
              onClick={handleNewConversation}
            >
              <MessageSquarePlus size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`mf-btn ${historyViewOpen ? "is-active" : ""}`}
              aria-pressed={historyViewOpen}
              title="Conversations History"
              aria-label="Conversations History"
              onClick={() => setHistoryViewOpen((v) => !v)}
            >
              <History size={15} aria-hidden="true" />
              <span className="mf-llm-badge-count">{conversations.length}</span>
            </button>
            <button
              type="button"
              className={`mf-btn ${settingsOpen ? "is-active" : ""}`}
              aria-pressed={settingsOpen}
              title="AI Plan &amp; BYOK Key Settings"
              aria-label="AI Plan &amp; BYOK Key Settings"
              onClick={() => setSettingsOpen((v) => !v)}
            >
              <KeyRound size={15} aria-hidden="true" />
            </button>
            <button
              type="button"
              className="mf-btn"
              title="Close AI Assistant (Esc)"
              aria-label="Close AI Assistant"
              onClick={onClose}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>

        {/* Compact AI Mode & Status Bar */}
        <div className="mf-llm-mode-bar">
          <div className="mf-llm-mode-tabs" role="tablist" aria-label="AI access mode">
            <button
              type="button"
              role="tab"
              aria-selected={!isUsingByok}
              className={`mf-chip-btn ${!isUsingByok ? "is-active" : ""}`}
              onClick={() => handleSwitchMode("managed")}
            >
              <Crown size={12} aria-hidden="true" /> Managed AI
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isUsingByok}
              className={`mf-chip-btn ${isUsingByok ? "is-active" : ""}`}
              onClick={() => handleSwitchMode("byok")}
            >
              <KeyRound size={12} aria-hidden="true" /> BYOK (Free)
            </button>
          </div>

          {!isUsingByok ? (
            !account.authenticated ? (
              <button type="button" className="mf-chip-btn" onClick={onOpenAuth}>
                <UserCheck size={12} aria-hidden="true" /> Sign in for {account.billing.maxTrialCount} Free Tries
              </button>
            ) : isProActive ? (
              <button type="button" className="mf-chip-btn" onClick={onOpenSubscription}>
                {account.quota?.monthlyRemaining ?? 0}/{account.quota?.monthlyLimit ?? 150} left · Pro
              </button>
            ) : (
              <button type="button" className="mf-chip-btn" onClick={onOpenSubscription}>
                <Crown size={12} aria-hidden="true" />{" "}
                {(account.trial?.remaining ?? 0) > 0
                  ? `${account.trial?.remaining} tries left · Upgrade`
                  : "Upgrade (1,000 MMK/mo)"}
              </button>
            )
          ) : (
            <button
              type="button"
              className="mf-chip-btn"
              onClick={() => setSettingsOpen((o) => !o)}
            >
              <ShieldCheck size={12} aria-hidden="true" />{" "}
              {effectiveRunMode === "byok_vault"
                ? account.byok?.configured
                  ? `Vault ${account.byok.keyHint || "Ready"}`
                  : "Set Vault Key"
                : config.apiKey.trim()
                ? "RAM Key Ready"
                : "Set RAM Key"}
            </button>
          )}
        </div>

        {/* AI Settings / Hybrid BYOK Vault Panel */}
        {settingsOpen && (
          <form className="mf-llm-key-panel" onSubmit={handleSaveConfig}>
            <div className="mf-llm-key-header">
              <div className="mf-llm-key-title">
                <Lock size={14} aria-hidden="true" />
                <span>
                  {isDraftByok ? "BYOK Security & Provider Settings" : "Managed AI Plan Settings"}
                </span>
              </div>
              <button
                type="button"
                className="mf-chip-btn"
                onClick={() => setSettingsOpen(false)}
              >
                Hide
              </button>
            </div>

            {!isDraftByok ? (
              <div className="mf-llm-managed-card">
                {!account.authenticated ? (
                  <>
                    <p className="mf-llm-key-notice">
                      Guests get unlimited free mind mapping. Sign in (Email, Google, or Facebook)
                      to try AI {account.billing.maxTrialCount} times for free, or switch to{" "}
                      <strong>BYOK</strong> to use your own API key.
                    </p>
                    <div className="mf-inline-actions">
                      <button type="button" className="mf-btn mf-btn-primary" onClick={onOpenAuth}>
                        Sign In / Create Account
                      </button>
                      <button
                        type="button"
                        className="mf-chip-btn"
                        onClick={() => handleSwitchMode("byok")}
                      >
                        Use BYOK Instead
                      </button>
                    </div>
                  </>
                ) : isProActive ? (
                  <>
                    <p className="mf-llm-key-notice">
                      <strong>Pro Active</strong> ({account.subscription?.plan}) · Model:{" "}
                      <code>{account.billing.managedModel}</code> · Quota:{" "}
                      {account.quota?.dailyRemaining}/{account.quota?.dailyLimit} today,{" "}
                      {account.quota?.monthlyRemaining}/{account.quota?.monthlyLimit} this month.
                    </p>
                    <button type="button" className="mf-chip-btn" onClick={onOpenSubscription}>
                      Manage Subscription / Receipt History
                    </button>
                  </>
                ) : (
                  <>
                    <p className="mf-llm-key-notice">
                      Free trial: <strong>{account.trial?.remaining ?? 0}</strong> of{" "}
                      {account.billing.maxTrialCount} left (Model:{" "}
                      <code>{account.billing.trialModel}</code>). Upgrade via KBZPay for{" "}
                      <strong>{account.billing.monthlyPriceMmk.toLocaleString()} MMK/mo</strong> or{" "}
                      <strong>{account.billing.yearlyPriceMmk.toLocaleString()} MMK/yr</strong>.
                    </p>
                    <div className="mf-inline-actions">
                      <button
                        type="button"
                        className="mf-btn mf-btn-primary"
                        onClick={onOpenSubscription}
                      >
                        <Crown size={14} aria-hidden="true" /> Upgrade via KBZPay
                      </button>
                      <button
                        type="button"
                        className="mf-chip-btn"
                        onClick={() => handleSwitchMode("byok")}
                      >
                        Switch to Free BYOK
                      </button>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <>
                <div className="mf-llm-storage-toggle" role="radiogroup" aria-label="BYOK key storage">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={draftConfig.byokStorage !== "session"}
                    className={`mf-chip-btn ${
                      draftConfig.byokStorage !== "session" ? "is-active" : ""
                    }`}
                    onClick={() =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        mode: "byok_vault",
                        byokStorage: "vault",
                      }))
                    }
                  >
                    <ShieldCheck size={12} aria-hidden="true" /> Encrypted Cloud Vault (AES-256)
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={draftConfig.byokStorage === "session"}
                    className={`mf-chip-btn ${
                      draftConfig.byokStorage === "session" ? "is-active" : ""
                    }`}
                    onClick={() =>
                      setDraftConfig((prev) => ({
                        ...prev,
                        mode: "byok_session",
                        byokStorage: "session",
                      }))
                    }
                  >
                    <Lock size={12} aria-hidden="true" /> Session-Only (RAM)
                  </button>
                </div>

                <p className="mf-help-text" style={{ margin: 0 }}>
                  {draftConfig.byokStorage === "session"
                    ? "Session-Only keys live strictly in browser RAM, never touch localStorage or our database, and vanish on tab close."
                    : account.byok?.configured
                    ? `Vaulted key (${account.byok.keyHint}) is AES-256-GCM encrypted on the server and never sent back to browsers.`
                    : "Encrypted Vault keys are encrypted with AES-256-GCM on our server (never stored in localStorage)."}
                </p>

                <div className="mf-llm-key-grid">
                  <div className="mf-llm-field">
                    <label htmlFor={providerSelectId}>Provider</label>
                    <select
                      id={providerSelectId}
                      className="mf-select"
                      value={draftConfig.provider}
                      onChange={(e) => {
                        const nextProv = e.target.value as LlmProviderId;
                        setDraftConfig((prev) => ({
                          ...prev,
                          provider: nextProv,
                          model: LLM_PROVIDER_META[nextProv].defaultModel,
                        }));
                      }}
                    >
                      {(Object.keys(LLM_PROVIDER_META) as LlmProviderId[]).map((pid) => (
                        <option key={pid} value={pid}>
                          {LLM_PROVIDER_META[pid].label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="mf-llm-field">
                    <label htmlFor={modelInputId}>Model</label>
                    <input
                      id={modelInputId}
                      type="text"
                      list={`${modelInputId}-list`}
                      value={draftConfig.model}
                      onChange={(e) =>
                        setDraftConfig((prev) => ({ ...prev, model: e.target.value }))
                      }
                      placeholder={LLM_PROVIDER_META[draftConfig.provider].defaultModel}
                    />
                    <datalist id={`${modelInputId}-list`}>
                      {LLM_PROVIDER_META[draftConfig.provider].models.map((m) => (
                        <option key={m} value={m} />
                      ))}
                    </datalist>
                  </div>
                </div>

                {draftConfig.provider === "custom" && (
                  <div className="mf-llm-field">
                    <label htmlFor={baseUrlInputId}>Base URL (HTTPS only)</label>
                    <input
                      id={baseUrlInputId}
                      type="url"
                      value={draftConfig.baseUrl || ""}
                      onChange={(e) =>
                        setDraftConfig((prev) => ({ ...prev, baseUrl: e.target.value }))
                      }
                      placeholder={LLM_PROVIDER_META.custom.baseUrlPlaceholder}
                    />
                  </div>
                )}

                <div className="mf-llm-field">
                  <label htmlFor={apiKeyInputId}>
                    API Key{" "}
                    {draftConfig.byokStorage !== "session" && account.byok?.configured
                      ? `(Saved: ${account.byok.keyHint})`
                      : ""}
                  </label>
                  <div className="mf-llm-key-input-row">
                    <input
                      ref={apiKeyInputRef}
                      id={apiKeyInputId}
                      type={showKey ? "text" : "password"}
                      value={draftConfig.apiKey}
                      onChange={(e) =>
                        setDraftConfig((prev) => ({ ...prev, apiKey: e.target.value }))
                      }
                      placeholder={
                        draftConfig.byokStorage !== "session" && account.byok?.configured
                          ? "Enter new key to rotate (or leave blank to keep)"
                          : LLM_PROVIDER_META[draftConfig.provider].keyPlaceholder
                      }
                      autoComplete="off"
                    />
                    <button
                      type="button"
                      className="mf-btn"
                      aria-label={showKey ? "Hide API key" : "Show API key"}
                      onClick={() => setShowKey((s) => !s)}
                    >
                      {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                    <button type="submit" className="mf-btn mf-btn-primary" disabled={savingSettings}>
                      {savingSettings ? (
                        <Loader2 size={14} className="mf-spin" aria-hidden="true" />
                      ) : (
                        <Check size={14} aria-hidden="true" />
                      )}
                      <span>Save</span>
                    </button>
                    {draftConfig.byokStorage !== "session" && account.byok?.configured && (
                      <button
                        type="button"
                        className="mf-btn"
                        title="Delete vaulted key"
                        aria-label="Delete vaulted key"
                        disabled={savingSettings}
                        onClick={() => void handleDeleteVaultKey()}
                      >
                        <Trash2 size={14} aria-hidden="true" />
                      </button>
                    )}
                  </div>
                </div>
                {settingsFeedback && (
                  <p className="mf-help-text" role="status">
                    {settingsFeedback}
                  </p>
                )}
              </>
            )}
          </form>
        )}

        {/* Conversations History Panel OR Active Chat Feed */}
        {historyViewOpen ? (
          <div className="mf-llm-history-view" role="region" aria-label="Conversations history">
            <div className="mf-llm-history-toolbar">
              <span className="mf-llm-history-title">
                Conversations ({conversations.length})
              </span>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button
                  type="button"
                  className="mf-chip-btn"
                  onClick={handleNewConversation}
                >
                  <MessageSquarePlus size={12} aria-hidden="true" /> New Chat
                </button>
                <button
                  type="button"
                  className="mf-chip-btn"
                  onClick={() => setHistoryViewOpen(false)}
                >
                  <MessageSquare size={12} aria-hidden="true" /> Current Chat
                </button>
                {(conversations.length > 1 || messages.length > 0) && (
                  <button
                    type="button"
                    className="mf-chip-btn mf-ctx-danger-btn"
                    onClick={handleClearAllConversations}
                  >
                    <Trash2 size={12} aria-hidden="true" /> Clear All
                  </button>
                )}
              </div>
            </div>

            <div className="mf-llm-history-list">
              {sortedConversations.map((conv) => {
                const isActive = conv.id === activeConversation?.id;
                const lastMsg = conv.messages[conv.messages.length - 1];
                const previewText = lastMsg
                  ? lastMsg.content.replace(/\s+/g, " ").trim()
                  : "No messages yet";
                const nodeTouchCount = conv.messages.reduce(
                  (sum, m) => sum + (m.affectedNodes?.length || 0),
                  0
                );
                return (
                  <div
                    key={conv.id}
                    className={`mf-llm-conv-item ${isActive ? "is-active" : ""}`}
                  >
                    <button
                      type="button"
                      className="mf-llm-conv-main"
                      onClick={() => {
                        setActiveConversationId(conv.id);
                        setHistoryViewOpen(false);
                      }}
                    >
                      <div className="mf-llm-conv-top">
                        <span className="mf-llm-conv-title">{conv.title}</span>
                        {isActive && <span className="mf-llm-conv-active-pill">Active</span>}
                      </div>
                      <div className="mf-llm-conv-preview">{previewText}</div>
                      <div className="mf-llm-conv-meta">
                        <span>
                          {conv.messages.length} msg{conv.messages.length === 1 ? "" : "s"}
                          {nodeTouchCount > 0 ? ` · ${nodeTouchCount} node update(s)` : ""}
                        </span>
                        <span>{formatDateTime(conv.updatedAt)}</span>
                      </div>
                    </button>
                    <button
                      type="button"
                      className="mf-btn mf-llm-conv-delete"
                      title={`Delete conversation "${conv.title}"`}
                      aria-label={`Delete conversation ${conv.title}`}
                      onClick={() => handleDeleteConversation(conv.id)}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <>
            {(messages.length > 0 || conversations.length > 1) && activeConversation && (
              <div className="mf-llm-conv-banner">
                <button
                  type="button"
                  className="mf-llm-conv-banner-title"
                  title="Switch conversation"
                  onClick={() => setHistoryViewOpen(true)}
                >
                  <MessageSquare size={12} aria-hidden="true" />
                  <span>{activeConversation.title}</span>
                </button>
                <button
                  type="button"
                  className="mf-chip-btn"
                  onClick={handleNewConversation}
                >
                  <MessageSquarePlus size={12} aria-hidden="true" /> New Chat
                </button>
              </div>
            )}
            <div className="mf-llm-messages" role="log" aria-live="polite" aria-label="Chat messages">
            {messages.length === 0 && (
              <div className="mf-llm-empty-state">
                <Sparkles size={26} aria-hidden="true" />
                <h4>Ask AI to Build or Update Your Map</h4>
                <p>
                  Paste a prompt or drop any file (documents, code, PDFs, images, CSVs, archives).
                  AI will create new branches or update matching nodes and show you every node it
                  modified.
                </p>
                <button
                  type="button"
                  className="mf-chip-btn"
                  onClick={onOpenClassicMarkdownPaste}
                >
                  Or paste raw Markdown as Subtree (offline)
                </button>
              </div>
            )}

            {messages.map((msg) => {
              const showRaw = Boolean(expandedRawErrors[msg.id]);
              return (
                <div key={msg.id} className={`mf-llm-msg is-${msg.role}`}>
                  <div className="mf-llm-msg-header">
                    <span className="mf-llm-msg-role">
                      {msg.role === "user"
                        ? "You"
                        : msg.role === "error"
                        ? "API Error"
                        : "LazyMindmap AI"}
                    </span>
                    <span className="mf-llm-msg-time">{formatTime(msg.createdAt)}</span>
                  </div>

                  {msg.role === "error" ? (
                    <div className="mf-llm-error-box" role="alert">
                      <div className="mf-llm-error-head">
                        <AlertCircle size={15} aria-hidden="true" />
                        <span>{msg.content}</span>
                      </div>
                      <div className="mf-llm-error-actions">
                        <button
                          type="button"
                          className="mf-chip-btn mf-llm-retry-btn"
                          aria-disabled={sending || uploadingFiles ? "true" : undefined}
                          onClick={() => void handleRetryError(msg.id)}
                        >
                          <RotateCcw size={12} aria-hidden="true" /> Retry
                        </button>
                        {(errorCodes[msg.id] === "AUTH_REQUIRED" ||
                          errorCodes[msg.id] === "EMAIL_NOT_VERIFIED") && (
                          <button
                            type="button"
                            className="mf-chip-btn"
                            onClick={onOpenAuth}
                          >
                            <UserCheck size={12} aria-hidden="true" /> Sign In / Verify
                          </button>
                        )}
                        {(errorCodes[msg.id] === "TRIAL_EXHAUSTED" ||
                          errorCodes[msg.id] === "SUBSCRIPTION_REQUIRED" ||
                          errorCodes[msg.id] === "QUOTA_EXCEEDED" ||
                          errorCodes[msg.id]?.startsWith("TRIAL_ABUSE_")) && (
                          <>
                            <button
                              type="button"
                              className="mf-chip-btn"
                              onClick={onOpenSubscription}
                            >
                              <Crown size={12} aria-hidden="true" /> Upgrade KBZPay
                            </button>
                            <button
                              type="button"
                              className="mf-chip-btn"
                              onClick={() => {
                                handleSwitchMode("byok");
                                setSettingsOpen(true);
                              }}
                            >
                              <KeyRound size={12} aria-hidden="true" /> Use BYOK (Free)
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          className="mf-chip-btn"
                          onClick={() => {
                            setSettingsOpen(true);
                            requestAnimationFrame(() => apiKeyInputRef.current?.focus());
                          }}
                        >
                          <KeyRound size={12} aria-hidden="true" /> AI Settings
                        </button>
                        {msg.rawError && (
                          <button
                            type="button"
                            className="mf-chip-btn"
                            onClick={() =>
                              setExpandedRawErrors((prev) => ({
                                ...prev,
                                [msg.id]: !showRaw,
                              }))
                            }
                          >
                            {showRaw ? (
                              <ChevronDown size={12} aria-hidden="true" />
                            ) : (
                              <ChevronRight size={12} aria-hidden="true" />
                            )}
                            Raw API response
                          </button>
                        )}
                      </div>
                      {showRaw && msg.rawError && (
                        <pre className="mf-llm-raw-error">{msg.rawError}</pre>
                      )}
                    </div>
                  ) : (
                    <>
                      {msg.role === "assistant" ? (
                        <div
                          className="mf-node-content mf-llm-msg-body"
                          dangerouslySetInnerHTML={{
                            __html: renderRichNodeContent(msg.content),
                          }}
                        />
                      ) : (
                        <div className="mf-llm-msg-body mf-llm-user-text">{msg.content}</div>
                      )}

                      {msg.files && msg.files.length > 0 && (
                        <div className="mf-llm-msg-files">
                          {msg.files.map((f) => {
                            const isImg = (f.mimeType || "").startsWith("image/");
                            return (
                              <a
                                key={f.id}
                                href={f.url}
                                download={f.name}
                                target="_blank"
                                rel="noreferrer"
                                className="mf-llm-file-pill"
                                title={`${f.name} (${f.mimeType}, ${formatFileSize(f.size)})`}
                              >
                                {isImg ? (
                                  <img src={f.url} alt={f.name} className="mf-llm-file-thumb" />
                                ) : (
                                  <FileText size={13} aria-hidden="true" />
                                )}
                                <span className="mf-llm-file-name">{f.name}</span>
                                <span className="mf-llm-file-size">{formatFileSize(f.size)}</span>
                              </a>
                            );
                          })}
                        </div>
                      )}

                      {msg.affectedNodes && msg.affectedNodes.length > 0 && (
                        <div className="mf-llm-affected-box">
                          <div className="mf-llm-affected-title">
                            Nodes Modified / Created ({msg.affectedNodes.length})
                          </div>
                          <div className="mf-llm-affected-chips">
                            {msg.affectedNodes.map((item, idx) => (
                              <button
                                key={`${item.nodeId}-${idx}`}
                                type="button"
                                className={`mf-llm-node-chip is-${item.action}`}
                                title={`Click to focus node "${item.nodeLabel}"`}
                                onClick={() => onFocusNode(item.nodeId)}
                              >
                                <span className="mf-llm-node-action">
                                  {actionLabel(item.action)}:
                                </span>{" "}
                                <span>{item.nodeLabel}</span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}

            {sending && (
              <div className="mf-llm-msg is-assistant is-loading">
                <Loader2 size={15} className="mf-spin" aria-hidden="true" />
                <span>Analyzing map &amp; applying node updates…</span>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>
          </>
        )}

        {/* Composer with Live Related Nodes Target Preview & Universal File Upload */}
        <form
          className="mf-llm-composer"
          onSubmit={(e) => {
            e.preventDefault();
            void submitPrompt();
          }}
        >
          <div className="mf-llm-target-preview" title="Related existing nodes that will be considered for modification or branching">
            <span className="mf-llm-target-label">Target / Related Nodes:</span>
            <div className="mf-llm-target-chips">
              {relatedTargetNodes.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  className="mf-llm-target-chip"
                  onClick={() => onFocusNode(n.id)}
                >
                  {getNodeShortLabel(n)}
                </button>
              ))}
            </div>
          </div>

          {stagedFiles.length > 0 && (
            <div className="mf-llm-staged-files">
              {stagedFiles.map((f) => (
                <div key={f.id} className="mf-llm-staged-chip">
                  <FileText size={12} aria-hidden="true" />
                  <span className="mf-llm-file-name">{f.name}</span>
                  <span className="mf-llm-file-size">{formatFileSize(f.size)}</span>
                  <button
                    type="button"
                    className="mf-llm-staged-remove"
                    aria-label={`Remove ${f.name}`}
                    onClick={() =>
                      setStagedFiles((prev) => prev.filter((item) => item.id !== f.id))
                    }
                  >
                    <X size={11} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="mf-llm-input-wrap">
            <label htmlFor={inputId} className="sr-only">
              Prompt for AI Mind Map Assistant
            </label>
            <textarea
              ref={textareaRef}
              id={inputId}
              rows={3}
              className="mf-llm-textarea"
              placeholder="Paste prompt or describe nodes to create/modify… (Enter to send, Shift+Enter for newline)"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              onPaste={(e) => void handlePaste(e)}
            />
          </div>

          <div className="mf-llm-composer-actions">
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                hidden
                onChange={(e) => {
                  if (e.target.files && e.target.files.length > 0) {
                    void handleFilesSelected(e.target.files);
                    e.target.value = "";
                  }
                }}
              />
              <button
                type="button"
                className="mf-chip-btn"
                title="Upload any file type"
                aria-label="Upload any file type"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingFiles}
              >
                {uploadingFiles ? (
                  <Loader2 size={13} className="mf-spin" aria-hidden="true" />
                ) : (
                  <Paperclip size={13} aria-hidden="true" />
                )}
                <span>Upload File</span>
              </button>
              <button
                type="button"
                className="mf-chip-btn"
                title="Open offline Markdown to Subtree paste dialog"
                onClick={onOpenClassicMarkdownPaste}
              >
                MD Paste
              </button>
            </div>

            <button
              type="submit"
              className="mf-btn mf-btn-primary mf-llm-send-btn"
              aria-disabled={
                sending || uploadingFiles || (!prompt.trim() && stagedFiles.length === 0)
                  ? "true"
                  : undefined
              }
            >
              {sending ? (
                <Loader2 size={14} className="mf-spin" aria-hidden="true" />
              ) : (
                <Send size={14} aria-hidden="true" />
              )}
              <span>{sending ? "Applying…" : "Send"}</span>
            </button>
          </div>
        </form>
      </aside>
    </>
  );
}
