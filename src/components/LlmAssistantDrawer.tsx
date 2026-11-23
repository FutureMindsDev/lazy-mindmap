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
  Eye,
  EyeOff,
  FileText,
  History,
  KeyRound,
  Loader2,
  MessageSquare,
  Paperclip,
  Send,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type {
  LlmChatFile,
  LlmChatMessage,
  LlmConfig,
  LlmNodeChangeRecord,
  LlmProviderId,
  MindMapDocument,
} from "../types/mindmap";
import { renderRichNodeContent } from "../utils/llmMathNormalizer";
import {
  buildMindMapSystemPrompt,
  callLlmProvider,
  findRelatedNodes,
  getNodeShortLabel,
  LLM_PROVIDER_META,
  LlmApiError,
  loadLlmChatHistory,
  loadLlmConfig,
  parseAndApplyLlmResponse,
  readFileForChat,
  saveLlmChatHistory,
  saveLlmConfig,
} from "../utils/llmMindMapAgent";
import { makeId } from "../utils/treeOps";

interface LlmAssistantDrawerProps {
  open: boolean;
  doc: MindMapDocument;
  selectedIds: string[];
  primarySelectedId: string;
  onToggleOpen: () => void;
  onClose: () => void;
  onApplyDocChange: (nextDoc: MindMapDocument, focusNodeId: string | null) => void;
  onFocusNode: (nodeId: string) => void;
  onOpenClassicMarkdownPaste: () => void;
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
  onToggleOpen,
  onClose,
  onApplyDocChange,
  onFocusNode,
  onOpenClassicMarkdownPaste,
  onAnnounce,
}: LlmAssistantDrawerProps) {
  const [config, setConfig] = useState<LlmConfig>(() => loadLlmConfig());
  const [draftConfig, setDraftConfig] = useState<LlmConfig>(() => loadLlmConfig());
  const [settingsOpen, setSettingsOpen] = useState<boolean>(() => !loadLlmConfig().apiKey.trim());
  const [showKey, setShowKey] = useState(false);
  const [historyViewOpen, setHistoryViewOpen] = useState(false);

  const [messages, setMessages] = useState<LlmChatMessage[]>(() => loadLlmChatHistory());
  const [prompt, setPrompt] = useState("");
  const [stagedFiles, setStagedFiles] = useState<LlmChatFile[]>([]);
  const [uploadingFiles, setUploadingFiles] = useState(false);
  const [sending, setSending] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [expandedRawErrors, setExpandedRawErrors] = useState<Record<string, boolean>>({});

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

  const hasApiKey = Boolean(config.apiKey.trim());

  useEffect(() => {
    saveLlmChatHistory(messages);
  }, [messages]);

  useEffect(() => {
    if (open) {
      if (!config.apiKey.trim()) {
        setSettingsOpen(true);
      }
      requestAnimationFrame(() => {
        if (!config.apiKey.trim()) {
          apiKeyInputRef.current?.focus();
        } else if (!historyViewOpen) {
          textareaRef.current?.focus();
        }
      });
    }
  }, [open, config.apiKey, historyViewOpen]);

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

  const handleSaveConfig = (e?: FormEvent) => {
    e?.preventDefault();
    const cleaned: LlmConfig = {
      provider: draftConfig.provider,
      apiKey: draftConfig.apiKey.trim(),
      model:
        draftConfig.model.trim() || LLM_PROVIDER_META[draftConfig.provider].defaultModel,
      baseUrl: draftConfig.baseUrl?.trim() || "",
    };
    setConfig(cleaned);
    setDraftConfig(cleaned);
    saveLlmConfig(cleaned);
    if (cleaned.apiKey) {
      setSettingsOpen(false);
      onAnnounce(`${LLM_PROVIDER_META[cleaned.provider].label} API key saved`);
      requestAnimationFrame(() => textareaRef.current?.focus());
    } else {
      onAnnounce("Please enter an API key");
    }
  };

  const submitPrompt = async () => {
    const trimmed = prompt.trim();
    if ((!trimmed && stagedFiles.length === 0) || sending || uploadingFiles) return;

    if (!config.apiKey.trim()) {
      setSettingsOpen(true);
      setHistoryViewOpen(false);
      setMessages((prev) => [
        ...prev,
        {
          id: makeId("msg"),
          role: "error",
          content:
            "LLM provider API key is missing. Please add your API key in the settings panel above to send prompts.",
          createdAt: new Date().toISOString(),
        },
      ]);
      requestAnimationFrame(() => apiKeyInputRef.current?.focus());
      return;
    }

    const userMessage: LlmChatMessage = {
      id: makeId("msg"),
      role: "user",
      content: trimmed || `Analyze attached file(s): ${stagedFiles.map((f) => f.name).join(", ")}`,
      createdAt: new Date().toISOString(),
      files: stagedFiles,
    };

    const nextHistory = [...messages, userMessage];
    setMessages(nextHistory);
    setPrompt("");
    const currentFiles = stagedFiles;
    setStagedFiles([]);
    setHistoryViewOpen(false);
    setSending(true);

    try {
      const systemPrompt = buildMindMapSystemPrompt(doc, selectedIds, currentFiles);
      const rawReply = await callLlmProvider({
        config,
        systemPrompt,
        messages: nextHistory,
      });

      const applied = parseAndApplyLlmResponse(
        doc,
        rawReply,
        primarySelectedId,
        currentFiles
      );

      if (applied.doc !== doc) {
        onApplyDocChange(applied.doc, applied.firstAffectedNodeId);
      }

      const assistantMessage: LlmChatMessage = {
        id: makeId("msg"),
        role: "assistant",
        content: applied.explanation,
        createdAt: new Date().toISOString(),
        affectedNodes: applied.affectedNodes,
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (err) {
      const errorMsg =
        err instanceof Error ? err.message : "LLM API request failed with an unknown error.";
      const status = err instanceof LlmApiError && err.status ? ` (HTTP ${err.status})` : "";
      const rawError = err instanceof LlmApiError ? err.rawError : undefined;

      setMessages((prev) => [
        ...prev,
        {
          id: makeId("msg"),
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

  const historyPairs = useMemo(() => {
    return messages.filter((m) => m.role === "user" || m.role === "assistant" || m.role === "error");
  }, [messages]);

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
          className={`mf-llm-fab-status ${hasApiKey ? "is-ready" : "is-missing-key"}`}
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
            <span>AI Mind Map Assistant</span>
            <span className="mf-llm-provider-pill">
              {LLM_PROVIDER_META[config.provider].label}
            </span>
          </div>

          <div className="mf-llm-header-actions">
            <button
              type="button"
              className={`mf-btn ${historyViewOpen ? "is-active" : ""}`}
              aria-pressed={historyViewOpen}
              title="View Chat History"
              aria-label="View Chat History"
              onClick={() => setHistoryViewOpen((v) => !v)}
            >
              <History size={15} aria-hidden="true" />
              <span className="mf-llm-badge-count">{messages.length}</span>
            </button>
            <button
              type="button"
              className={`mf-btn ${settingsOpen ? "is-active" : ""}`}
              aria-pressed={settingsOpen}
              title="LLM Provider & API Key Settings"
              aria-label="LLM Provider & API Key Settings"
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

        {/* Provider & API Key Panel (Auto-shown when key is missing) */}
        {(settingsOpen || !hasApiKey) && (
          <form className="mf-llm-key-panel" onSubmit={handleSaveConfig}>
            <div className="mf-llm-key-header">
              <div className="mf-llm-key-title">
                <KeyRound size={14} aria-hidden="true" />
                <span>
                  {hasApiKey
                    ? "LLM Provider Settings"
                    : "Add LLM Provider API Key to Continue"}
                </span>
              </div>
              {hasApiKey && (
                <button
                  type="button"
                  className="mf-chip-btn"
                  onClick={() => setSettingsOpen(false)}
                >
                  Hide
                </button>
              )}
            </div>

            {!hasApiKey && (
              <p className="mf-llm-key-notice">
                Please add your LLM provider key (stored locally in your browser) so the assistant
                can create and modify nodes from your prompts and files.
              </p>
            )}

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
                <label htmlFor={baseUrlInputId}>Base URL</label>
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
              <label htmlFor={apiKeyInputId}>API Key</label>
              <div className="mf-llm-key-input-row">
                <input
                  ref={apiKeyInputRef}
                  id={apiKeyInputId}
                  type={showKey ? "text" : "password"}
                  value={draftConfig.apiKey}
                  onChange={(e) =>
                    setDraftConfig((prev) => ({ ...prev, apiKey: e.target.value }))
                  }
                  placeholder={LLM_PROVIDER_META[draftConfig.provider].keyPlaceholder}
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
                <button type="submit" className="mf-btn mf-btn-primary">
                  <Check size={14} aria-hidden="true" />
                  <span>Save</span>
                </button>
              </div>
            </div>
          </form>
        )}

        {/* Chat History Overview Panel OR Active Chat Feed */}
        {historyViewOpen ? (
          <div className="mf-llm-history-view" role="region" aria-label="Chat history">
            <div className="mf-llm-history-toolbar">
              <span className="mf-llm-history-title">
                Chat History ({messages.length} message{messages.length === 1 ? "" : "s"})
              </span>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className="mf-chip-btn"
                  onClick={() => setHistoryViewOpen(false)}
                >
                  <MessageSquare size={12} aria-hidden="true" /> Back to Chat
                </button>
                {messages.length > 0 && (
                  <button
                    type="button"
                    className="mf-chip-btn mf-ctx-danger-btn"
                    onClick={() => {
                      setMessages([]);
                      onAnnounce("Cleared LLM chat history");
                    }}
                  >
                    <Trash2 size={12} aria-hidden="true" /> Clear
                  </button>
                )}
              </div>
            </div>

            <div className="mf-llm-history-list">
              {historyPairs.length === 0 ? (
                <div className="mf-llm-empty-state">
                  <History size={24} aria-hidden="true" />
                  <p>No chat history yet. Send a prompt below to build or edit nodes.</p>
                </div>
              ) : (
                historyPairs.map((m) => (
                  <div key={m.id} className={`mf-llm-history-card is-${m.role}`}>
                    <div className="mf-llm-history-meta">
                      <strong>
                        {m.role === "user"
                          ? "You"
                          : m.role === "error"
                          ? "API Error"
                          : "Assistant"}
                      </strong>
                      <span>{formatDateTime(m.createdAt)}</span>
                    </div>
                    <div className="mf-llm-history-snippet">{m.content}</div>
                    {m.files && m.files.length > 0 && (
                      <div className="mf-llm-history-tags">
                        {m.files.map((f) => (
                          <span key={f.id} className="mf-llm-mini-tag">
                            📎 {f.name}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.affectedNodes && m.affectedNodes.length > 0 && (
                      <div className="mf-llm-history-tags">
                        {m.affectedNodes.map((an, idx) => (
                          <button
                            key={`${an.nodeId}-${idx}`}
                            type="button"
                            className="mf-llm-node-chip"
                            onClick={() => {
                              onFocusNode(an.nodeId);
                              setHistoryViewOpen(false);
                            }}
                          >
                            {actionLabel(an.action)}: {an.nodeLabel}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
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
                        : "MindForge AI"}
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
                          className="mf-chip-btn"
                          onClick={() => {
                            setSettingsOpen(true);
                            requestAnimationFrame(() => apiKeyInputRef.current?.focus());
                          }}
                        >
                          <KeyRound size={12} aria-hidden="true" /> Check API Key
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
