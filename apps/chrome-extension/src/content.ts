(() => {
  type Platform = "chatgpt" | "moltbot_webchat" | "claude_web" | "gemini_web";

  type CopyTrigger = "selection" | "button_full_reply" | "button_code_block";

  type CopyEventMetadata = {
    site: "chatgpt" | "other";
    messageId?: string;
    charCount: number;
    isCodeLike: boolean;
    languageHint?: string;
    trigger?: CopyTrigger;
  };

  const DEBUG_COUNTS = false;
  const DEBUG_RECORDER = false;

  const host = location.host;

  const isChatgpt =
    host === "chatgpt.com" ||
    host === "www.chatgpt.com" ||
    host.endsWith(".chatgpt.com") ||
    host === "chat.openai.com";

  const isMoltbot =
    host === "localhost:18789" || host === "127.0.0.1:18789";

  const isClaude =
    host === "claude.ai" || host.endsWith(".claude.ai");

  const isGemini =
    host === "gemini.google.com" || host.endsWith(".gemini.google.com");

  let chatgptObserverAttached = false;
  let claudeObserverAttached = false;
  let geminiObserverAttached = false;

  let chatgptModelDiagnosticSent = false;
  let claudeModelDiagnosticSent = false;
  let geminiModelDiagnosticSent = false;

  function getActivePlatform(): Platform {
    if (isMoltbot) return "moltbot_webchat";
    if (isClaude) return "claude_web";
    if (isGemini) return "gemini_web";
    return "chatgpt";
  }

  function recordDiagnostic(code: string, details?: Record<string, unknown>) {
    const platform = getActivePlatform();
    recordEvent(
      "diagnostic",
      {
        code,
        ...(details ?? {}),
      },
      undefined,
      platform
    );
  }

  function detectCurrentModel(platform: Platform): string | undefined {
    try {
      if (platform === "chatgpt") {
        const el = document.querySelector<HTMLElement>(
          '[data-testid="model-switcher-dropdown-button"]'
        );
        const text = el?.innerText?.trim();
        if (text) return text;
        if (!chatgptModelDiagnosticSent) {
          recordDiagnostic("NO_MODEL_LABEL", { platformHint: "chatgpt" });
          chatgptModelDiagnosticSent = true;
        }
        return undefined;
      }

      if (platform === "claude_web") {
        const el = document.querySelector<HTMLElement>(
          '[data-testid="model-selector-dropdown"]'
        );
        const text = el?.innerText?.trim();
        if (text) return text;
        if (!claudeModelDiagnosticSent) {
          recordDiagnostic("NO_MODEL_LABEL", { platformHint: "claude_web" });
          claudeModelDiagnosticSent = true;
        }
        return undefined;
      }

      if (platform === "gemini_web") {
        const pillEl = document.querySelector<HTMLElement>(
          '[data-test-id="logo-pill-label-container"]'
        );
        const pillText = pillEl?.innerText?.trim() ?? "";

        const promptEl = document.querySelector<HTMLElement>(
          '[data-placeholder^="Ask Gemini"], [data-placeholder*="Gemini"]'
        );
        const promptText = promptEl?.getAttribute("data-placeholder")?.trim() ?? "";

        if (promptText && pillText) {
          return `${promptText.replace(/^Ask\s+/i, "").trim()} ${pillText}`.trim();
        }

        const combined = promptText || pillText || undefined;
        if (combined) return combined;
        if (!geminiModelDiagnosticSent) {
          recordDiagnostic("NO_MODEL_LABEL", { platformHint: "gemini_web" });
          geminiModelDiagnosticSent = true;
        }
        return undefined;
      }
    } catch {
      // ignore DOM errors
    }

    return undefined;
  }

  function runDomDiagnostic() {
    const platform = getActivePlatform();
    const url = window.location.href;
    let observerAttached = false;
    if (platform === "chatgpt") observerAttached = chatgptObserverAttached;
    if (platform === "claude_web") observerAttached = claudeObserverAttached;
    if (platform === "gemini_web") observerAttached = geminiObserverAttached;

    const modelLabel = detectCurrentModel(platform) || null;

    const payload = {
      platform,
      url,
      observerAttached,
      modelLabel,
    };

    try {
      chrome.runtime.sendMessage({
        type: "DOM_DIAGNOSTIC_REPORT",
        payload,
      });
    } catch {
      // ignore messaging errors
    }

    try {
      recordDiagnostic("MANUAL_DOM_CHECK", payload as Record<string, unknown>);
    } catch {
      // ignore recording errors
    }
  }

  function recordCopyOutput(text: string) {
    const platform = getActivePlatform();
    const model = detectCurrentModel(platform);
    const trimmed = text.trim();
    if (!trimmed) return;
    const metadata: CopyEventMetadata = {
      site: platform === "chatgpt" ? "chatgpt" : "other",
      charCount: trimmed.length,
      isCodeLike: false,
    };
    recordEvent("copy_output", metadata, undefined, platform, model);
  }

  function recordCopyOutputWithMetadata(
    metadata: CopyEventMetadata,
    platform: Platform,
    sessionId?: string
  ) {
    const model = detectCurrentModel(platform);
    recordEvent("copy_output", metadata, sessionId, platform, model);
  }

  function recordThumbsUp() {
    const platform = getActivePlatform();
    const model = detectCurrentModel(platform);
    recordEvent("thumbs_up", undefined, undefined, platform, model);
  }

  function recordThumbsDown() {
    const platform = getActivePlatform();
    const model = detectCurrentModel(platform);
    recordEvent("thumbs_down", undefined, undefined, platform, model);
  }

  type FeedbackEventKind = "feedback_good" | "feedback_bad";

  type FeedbackEventMetadata = {
    site: "chatgpt" | "other";
    messageId?: string;
  };

  type LlmResponseEventMetadata = {
    charCount: number;
    latencyMs?: number;
    turnIndex: number;
  };

  type DiagnosticEventMetadata = {
    code: string;
    [key: string]: unknown;
  };

  type SessionMetrics = {
    userMessageCount: number;
    llmMessageCount: number;
  };

  type EventRecord = {
    type:
      | "page_visit"
      | "user_prompt"
      | "llm_response"
      | "copy_output"
      | "thumbs_up"
      | "thumbs_down"
      | "diagnostic"
      | "feedback_good"
      | "feedback_bad";
    platform: Platform;
    site: "chatgpt" | "other";
    url: string;
    timestamp: string;
    sessionId: string;
    pageTitle?: string;
    model?: string;
    metadata?:
      | CopyEventMetadata
      | FeedbackEventMetadata
      | LlmResponseEventMetadata
      | DiagnosticEventMetadata;
  };

  if (DEBUG_RECORDER) {
    console.log("[Nea Agora Recorder] content script loaded on this page");
  }

  const tabSessionSuffix = Math.random().toString(36).slice(2);
  const sessionMetricsById = new Map<string, SessionMetrics>();
  const lastUserPromptAtBySession = new Map<string, number>();
  const turnIndexBySession = new Map<string, number>();
  const recentUserTextBySession = new Map<string, { text: string; at: number }>();
  const countedAssistantMessageIds = new Set<string>();
  const countedAssistantMessageElsByPlatform = new Map<Platform, WeakSet<HTMLElement>>();
  const pendingAssistantMessageElsByPlatform = new Map<Platform, WeakSet<HTMLElement>>();
  let observedMessageContainer: HTMLElement | null = null;
  const USER_PROMPT_DEDUP_MS = 500;
  let lastUserPromptAt = 0;
  let lastUserPromptText = "";

  chrome.storage.local.get(["neaAgoraSessionMetrics"], (result) => {
    const stored = result.neaAgoraSessionMetrics;
    if (stored && typeof stored === "object") {
      for (const [sessionId, metrics] of Object.entries(stored as Record<string, SessionMetrics>)) {
        if (!metrics || typeof metrics !== "object") continue;
        const userMessageCount = Number((metrics as SessionMetrics).userMessageCount ?? 0);
        const llmMessageCount = Number((metrics as SessionMetrics).llmMessageCount ?? 0);
        sessionMetricsById.set(sessionId, {
          userMessageCount,
          llmMessageCount,
        });
      }
    }
  });

  function getChatGptConversationIdFromUrl(url: string = location.href): string | null {
    try {
      const u = new URL(url);
      // ChatGPT conversation URLs usually look like /c/<id>
      const parts = u.pathname.split("/");
      const idx = parts.indexOf("c");
      if (idx >= 0 && parts.length > idx + 1) {
        const convId = parts[idx + 1].trim();
        return convId || null;
      }
      return null;
    } catch {
      return null;
    }
  }

  function getMoltbotSessionIdFromUrl(url: string = location.href): string | null {
    try {
      const u = new URL(url);
      const sessionParam = u.searchParams.get("session");
      return sessionParam ? sessionParam.trim() : null;
    } catch {
      return null;
    }
  }

  function getClaudeChatIdFromUrl(url: string = location.href): string | null {
    try {
      const u = new URL(url);
      if (!u.hostname.endsWith("claude.ai")) return null;
      const parts = u.pathname.split("/");
      const idx = parts.indexOf("chat");
      if (idx >= 0 && parts.length > idx + 1) {
        const chatId = parts[idx + 1].trim();
        return chatId || null;
      }
      return null;
    } catch {
      return null;
    }
  }

  function getGeminiAppIdFromUrl(url: string = location.href): string | null {
    try {
      const u = new URL(url);
      if (!u.hostname.endsWith("gemini.google.com")) return null;
      const parts = u.pathname.split("/");
      const idx = parts.indexOf("app");
      if (idx >= 0 && parts.length > idx + 1) {
        const appId = parts[idx + 1].trim();
        return appId || null;
      }
      return null;
    } catch {
      return null;
    }
  }

  function deriveChatGptSessionId(): string {
    // Prefer conversation scoped session ids when a conversation is active.
    const convId = getChatGptConversationIdFromUrl();
    if (convId) {
      return `chatgpt-c-${convId}`;
    }

    // Fallback: tab scoped session id
    return `chatgpt-tab-${tabSessionSuffix}`;
  }

  function deriveMoltbotSessionId(): string {
    const session = getMoltbotSessionIdFromUrl();
    if (session) {
      return `moltbot-s-${session}`;
    }
    return `moltbot-tab-${tabSessionSuffix}`;
  }

  function deriveClaudeSessionId(): string {
    const chatId = getClaudeChatIdFromUrl();
    if (chatId) {
      return `claude-chat-${chatId}`;
    }
    return deriveGenericTabSessionId("claude");
  }

  function deriveGeminiSessionId(): string {
    const appId = getGeminiAppIdFromUrl();
    if (appId) {
      return `gemini-app-${appId}`;
    }
    return deriveGenericTabSessionId("gemini");
  }

  function deriveGenericTabSessionId(prefix: string): string {
    return `${prefix}-tab-${tabSessionSuffix}`;
  }

  function getOrCreateSessionId(platform: Platform): string {
    if (platform === "moltbot_webchat") {
      return deriveMoltbotSessionId();
    }
    if (platform === "chatgpt") {
      return deriveChatGptSessionId();
    }
    if (platform === "claude_web") {
      return deriveClaudeSessionId();
    }
    if (platform === "gemini_web") {
      return deriveGeminiSessionId();
    }
    return deriveGenericTabSessionId("unknown");
  }

  function ensureSessionMetrics(sessionId: string) {
    if (sessionMetricsById.has(sessionId)) return;
    sessionMetricsById.set(sessionId, {
      userMessageCount: 0,
      llmMessageCount: 0,
    });
  }

  function persistSessionMetrics() {
    const serialized: Record<string, SessionMetrics> = {};
    for (const [sessionId, metrics] of sessionMetricsById.entries()) {
      serialized[sessionId] = {
        userMessageCount: metrics.userMessageCount,
        llmMessageCount: metrics.llmMessageCount,
      };
    }
    try {
      if (!chrome?.runtime?.id) {
        return;
      }
      chrome.storage.local.set({ neaAgoraSessionMetrics: serialized });
    } catch (err) {
      if (typeof console !== "undefined" && console && typeof console.warn === "function") {
        console.warn("[Nea Agora Recorder] persistSessionMetrics skipped", err);
      }
    }
  }

  function getCurrentPageTitle(): string {
    const platform = getActivePlatform();

    if (platform === "chatgpt") {
      const titleEl = document.querySelector(
        '[data-testid="conversation-name"]'
      ) as HTMLElement | null;

      if (titleEl && titleEl.textContent) {
        const text = titleEl.textContent.trim();
        if (text) return text;
      }
    }

    if (platform === "claude_web") {
      const titleEl = document.querySelector<HTMLElement>(
        '[data-testid="chat-title-button"] .truncate'
      );
      const text = titleEl?.innerText?.trim();
      if (text) return text;
    }

    if (platform === "gemini_web") {
      const titleEl = document.querySelector<HTMLElement>(
        ".conversation-title.gds-title-m"
      );
      const text = titleEl?.innerText?.trim();
      if (text) return text;
    }

    if (document.title) {
      return document.title.trim();
    }

    return "";
  }

  function isGenericTitle(title: string): boolean {
    const normalized = title.trim().toLowerCase();
    if (!normalized) return true;
    if (normalized === "chatgpt") return true;
    if (normalized.startsWith("chatgpt")) return true;
    if (normalized === "claude") return true;
    if (normalized.startsWith("claude")) return true;
    if (normalized === "google gemini") return true;
    if (normalized === "gemini") return true;
    if (normalized.startsWith("gemini")) return true;
    if (normalized === "moltbot") return true;
    if (normalized.startsWith("moltbot")) return true;
    return false;
  }

  function updateSessionTitle(sessionId: string, platform: Platform) {
    let title = getCurrentPageTitle();

    if (!title) {
      title = sessionId;
    }

    chrome.storage.local.get(["neaAgoraSessionFlags"], (data) => {
      const flags: Record<string, any> = data.neaAgoraSessionFlags ?? {};
      const current = flags[sessionId] ?? {};

      if (current.title && current.title !== sessionId) {
        const existing = String(current.title);
        if (!isGenericTitle(existing) && isGenericTitle(title)) {
          return;
        }
        if (existing === title) {
          return;
        }
      }

      current.title = title;
      flags[sessionId] = current;

      chrome.storage.local.set({ neaAgoraSessionFlags: flags }, () => {
        // no-op
      });
    });
  }

  function incrementUserMessageCount(sessionId: string, messageText: string) {
    const normalized = messageText.trim();
    if (!normalized) return;

    // Heuristic: avoid double-counting when multiple hooks fire for the same send.
    const now = Date.now();
    if (now - lastUserPromptAt < USER_PROMPT_DEDUP_MS && normalized === lastUserPromptText) {
      return;
    }
    lastUserPromptAt = now;
    lastUserPromptText = normalized;

    ensureSessionMetrics(sessionId);
    const metrics = sessionMetricsById.get(sessionId)!;
    metrics.userMessageCount += 1;
    persistSessionMetrics();
    if (DEBUG_RECORDER) {
      console.debug("[Nea Agora Recorder] user message counted", {
        sessionId,
        userMessageCount: metrics.userMessageCount,
      });
    }
  }

  function incrementAssistantMessageCount(sessionId: string, messageId?: string) {
    ensureSessionMetrics(sessionId);
    const metrics = sessionMetricsById.get(sessionId)!;
    metrics.llmMessageCount += 1;
    persistSessionMetrics();
    if (DEBUG_RECORDER) {
      console.debug("[Nea Agora Recorder] assistant message counted", {
        sessionId,
        messageId,
        llmMessageCount: metrics.llmMessageCount,
      });
    }
  }

  function recordUserPrompt(platform: Platform, messageText: string) {
    const sessionId = getOrCreateSessionId(platform);
    const trimmed = messageText.trim();
    if (!trimmed) return;
    if (/dom diagnostic/i.test(trimmed)) {
      runDomDiagnostic();
    }
    const recent = recentUserTextBySession.get(sessionId);
    const now = Date.now();
    if (recent && recent.text === trimmed && now - recent.at < 2000) {
      return;
    }
    recentUserTextBySession.set(sessionId, { text: trimmed, at: now });
    const model = detectCurrentModel(platform);
    recordEvent("user_prompt", undefined, sessionId, platform, model);
    incrementUserMessageCount(sessionId, trimmed);
    lastUserPromptAtBySession.set(sessionId, Date.now());
    const nextTurn = (turnIndexBySession.get(sessionId) ?? 0) + 1;
    turnIndexBySession.set(sessionId, nextTurn);
  }

  function recordAssistantResponse(
    platform: Platform,
    messageText: string,
    sessionId: string,
    messageId?: string
  ) {
    const text = messageText.trim();
    if (!text) return;
    const now = Date.now();
    const lastPromptAt = lastUserPromptAtBySession.get(sessionId);
    const latencyMs = lastPromptAt != null ? now - lastPromptAt : 0;
    const turnIndex = turnIndexBySession.get(sessionId) ?? 0;

    const model = detectCurrentModel(platform);
    recordEvent(
      "llm_response",
      {
        charCount: text.length,
        latencyMs,
        turnIndex,
      },
      sessionId,
      platform,
      model
    );

    incrementAssistantMessageCount(sessionId, messageId);
  }

  function recordEvent(
    type: EventRecord["type"],
    metadata?: EventRecord["metadata"],
    sessionIdOverride?: string,
    platformOverride?: Platform,
    model?: string
  ) {
    try {
      // If the extension context is invalid, bail out early
      if (!chrome?.runtime?.id) {
        if (typeof console !== "undefined" && console && typeof console.warn === "function") {
          if (DEBUG_RECORDER) {
            console.debug(
              "[Nea Agora Recorder] recordEvent skipped: extension context invalidated"
            );
          }
        }
        return;
      }
    const platform: Platform =
      platformOverride ??
      (isMoltbot
        ? "moltbot_webchat"
        : isClaude
        ? "claude_web"
        : isGemini
        ? "gemini_web"
        : "chatgpt");
    const newEvent: EventRecord = {
      type,
      platform,
      site: platform === "chatgpt" ? "chatgpt" : "other",
      url: window.location.href,
      timestamp: new Date().toISOString(),
      sessionId: sessionIdOverride ?? getOrCreateSessionId(platform),
      pageTitle: type === "page_visit" ? getCurrentPageTitle() : undefined,
      ...(model ? { model } : {}),
      metadata,
    };
    updateSessionTitle(newEvent.sessionId, platform);

      // Safe debug log – this will not crash the script
      if (typeof console !== "undefined" && console && typeof console.log === "function") {
        if (DEBUG_RECORDER) {
          console.log("[Nea Agora Recorder] event", newEvent);
        }
      }

      chrome.storage.local.get(["neaAgoraRecorder"], (result) => {
        const events = Array.isArray(result.neaAgoraRecorder)
          ? (result.neaAgoraRecorder as EventRecord[])
          : [];

        const updatedEvents = [...events, newEvent];

        chrome.storage.local.set({ neaAgoraRecorder: updatedEvents }, () => {
          if (typeof console !== "undefined" && console && typeof console.log === "function") {
            if (DEBUG_RECORDER) {    
              console.log(
                "[Nea Agora Recorder] stored",
                updatedEvents.length,
                "events"
              );
            }
          }
        });
      });
    } catch (err) {
      if (typeof console !== "undefined" && console && typeof console.error === "function") {
        console.error("[Nea Agora Recorder] recordEvent error", err);
      }
    }
  }

  function isChatGptHost() {
    return isChatgpt;
  }

  function isChatGptConversationPage() {
    // For v0.3, treat any ChatGPT host as eligible.
    // Session scoping is handled by getOrCreateSessionId("chatgpt") per tab.
    return isChatGptHost();
  }

  const MOLTBOT_CHAT_CONTAINER_SELECTORS = [
    ".chat-thread",
    ".chat-messages",
    ".chat-list",
    ".chat-scroll",
    "#chat-messages",
    "main",
  ];

  const MOLTBOT_USER_GROUP_SELECTOR = ".chat-group.user";
  const MOLTBOT_BOT_GROUP_SELECTOR = ".chat-group.assistant";
  const MOLTBOT_BUBBLE_SELECTOR = ".chat-bubble";

  function findFirstElement(
    selectors: string[],
    root: Document | HTMLElement = document
  ): HTMLElement | null {
    for (const selector of selectors) {
      const found = root.querySelector(selector);
      if (found instanceof HTMLElement) {
        return found;
      }
    }
    return null;
  }

  function findClosestMatch(node: Node, selector: string): HTMLElement | null {
    if (node instanceof HTMLElement) {
      if (node.matches(selector)) return node;
      const closest = node.closest(selector);
      if (closest instanceof HTMLElement) return closest;
    }
    const parent = node.parentElement;
    if (!parent) return null;
    const closest = parent.closest(selector);
    return closest instanceof HTMLElement ? closest : null;
  }

  function extractMoltbotMessageText(bubbleEl: HTMLElement): string {
    const textEl = bubbleEl.querySelector(".chat-text");
    if (textEl instanceof HTMLElement) {
      return textEl.innerText.trim();
    }
    return bubbleEl.innerText.trim();
  }

  function collectMoltbotBubbles(node: Node): HTMLElement[] {
    const results: HTMLElement[] = [];
    if (node instanceof HTMLElement) {
      if (node.matches(MOLTBOT_BUBBLE_SELECTOR)) {
        results.push(node);
      }
      node
        .querySelectorAll(MOLTBOT_BUBBLE_SELECTOR)
        .forEach((el) => {
          if (el instanceof HTMLElement) results.push(el);
        });
    }
    return results;
  }

  function findMoltbotContainer(): HTMLElement | null {
    const direct = findFirstElement(MOLTBOT_CHAT_CONTAINER_SELECTORS);
    if (direct) return direct;

    const groups = Array.from(document.querySelectorAll(".chat-group")).filter(
      (el): el is HTMLElement => el instanceof HTMLElement
    );
    if (groups.length === 0) return null;

    for (const group of groups) {
      let current: HTMLElement | null = group.parentElement;
      while (current && current !== document.body) {
        const count = current.querySelectorAll(".chat-group").length;
        if (count >= 2) {
          return current;
        }
        current = current.parentElement;
      }
    }

    return groups[0].parentElement ?? null;
  }

  function setupMoltbotObserver(attempt: number = 0) {
    const container = findMoltbotContainer();
    if (!container) {
      if (attempt < 10) {
        setTimeout(() => setupMoltbotObserver(attempt + 1), 1000);
      } else {
        console.warn("[neaagora] MoltBot chat container not found");
      }
      return;
    }

    const seenUserBubbles = new WeakSet<HTMLElement>();
    const seenAssistantBubbles = new WeakSet<HTMLElement>();

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        const nodes: Node[] =
          mutation.type === "childList"
            ? Array.from(mutation.addedNodes)
            : [mutation.target];

        for (const node of nodes) {
          const bubbles = collectMoltbotBubbles(node);
          for (const bubble of bubbles) {
            const userGroup = bubble.closest(MOLTBOT_USER_GROUP_SELECTOR);
            const botGroup = bubble.closest(MOLTBOT_BOT_GROUP_SELECTOR);

            if (userGroup && !seenUserBubbles.has(bubble)) {
              const text = extractMoltbotMessageText(bubble);
              if (text) {
                seenUserBubbles.add(bubble);
                recordUserPrompt("moltbot_webchat", text);
              }
              continue;
            }

            if (botGroup && !seenAssistantBubbles.has(bubble)) {
              const text = extractMoltbotMessageText(bubble);
              if (text) {
                seenAssistantBubbles.add(bubble);
                const sessionId = getOrCreateSessionId("moltbot_webchat");
                recordAssistantResponse("moltbot_webchat", text, sessionId);
              }
            }
          }
        }
      }
    });

    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    console.log("[neaagora] MoltBot observer attached");
  }

  function getSelectionContainer(selection: Selection): HTMLElement | null {
    const anchor = selection.anchorNode;
    if (!anchor) return null;
    if (anchor.nodeType === Node.ELEMENT_NODE) {
      return anchor as HTMLElement;
    }
    return anchor.parentElement;
  }

  function findAssistantMessageElement(container: HTMLElement | null): HTMLElement | null {
    if (!container) return null;

    const direct = container.closest('[data-message-author-role="assistant"]');
    if (direct) return direct as HTMLElement;

    const turn = container.closest(
      'article[data-testid^="conversation-turn"], div[data-testid^="conversation-turn"]'
    ) as HTMLElement | null;
    if (turn && turn.querySelector('[data-message-author-role="assistant"]')) {
      return turn;
    }

    return null;
  }

  function resolveMessageId(messageEl: HTMLElement | null): string | undefined {
    if (!messageEl) return undefined;
    const idCarrier = messageEl.closest("[data-message-id]");
    const carrierId = idCarrier?.getAttribute("data-message-id") ?? undefined;
    if (carrierId) return carrierId;

    const directId =
      messageEl.getAttribute("data-message-id") ??
      messageEl.getAttribute("data-id") ??
      undefined;
    if (directId) return directId;

    const testId = messageEl.getAttribute("data-testid");
    if (testId && testId.startsWith("conversation-turn-")) {
      return testId;
    }

    return undefined;
  }

  function findChatInputText(element: HTMLElement | Document | null): string {
    if (!element) return "";

    if (element instanceof HTMLTextAreaElement) {
      return element.value ?? "";
    }

    if (element instanceof HTMLElement && element.isContentEditable) {
      return element.textContent ?? "";
    }

    const textarea = element.querySelector("textarea");
    if (textarea instanceof HTMLTextAreaElement) {
      return textarea.value ?? "";
    }

    const editable = element.querySelector("[contenteditable='true']");
    if (editable instanceof HTMLElement) {
      return editable.textContent ?? "";
    }

    return "";
  }

  function isFinalAssistantMessage(messageEl: HTMLElement): boolean {
    // For v0.5 we keep it simple:
    // If the assistant message element has some non-empty text, we treat it as "final".
    const text = (messageEl.textContent ?? "").trim();
    return text.length > 0;
  }

  function getWeakSetForPlatform(
    map: Map<Platform, WeakSet<HTMLElement>>,
    platform: Platform
  ): WeakSet<HTMLElement> {
    const existing = map.get(platform);
    if (existing) return existing;
    const created = new WeakSet<HTMLElement>();
    map.set(platform, created);
    return created;
  }

  function scheduleAssistantMessageCount(messageEl: HTMLElement, platform: Platform) {
    const pendingSet = getWeakSetForPlatform(pendingAssistantMessageElsByPlatform, platform);
    const countedSet = getWeakSetForPlatform(countedAssistantMessageElsByPlatform, platform);
    if (pendingSet.has(messageEl)) return;
    pendingSet.add(messageEl);

    const messageId = platform === "chatgpt" ? resolveMessageId(messageEl) : undefined;
    if (messageId && countedAssistantMessageIds.has(messageId)) return;
    if (!messageId && countedSet.has(messageEl)) return;

    // Heuristic: wait briefly for streaming to settle and copy button to appear.
    setTimeout(() => {
      pendingSet.delete(messageEl);
      if (!messageEl.isConnected) return;
      if (!isFinalAssistantMessage(messageEl)) return;

      if (messageId) {
        if (countedAssistantMessageIds.has(messageId)) return;
        countedAssistantMessageIds.add(messageId);
      } else {
        if (countedSet.has(messageEl)) return;
        countedSet.add(messageEl);
      }

      const sessionId = getOrCreateSessionId(platform);
      if (DEBUG_COUNTS) {
        console.debug(
          "[nea-agora] llmMessageCount++",
          sessionId,
          sessionMetricsById.get(sessionId)?.llmMessageCount
        );
      }
      const text = extractAssistantMessageText(messageEl, platform);
      if (!text.trim()) return;
      recordAssistantResponse(
        platform,
        text,
        sessionId,
        messageId
      );
    }, 700);
  }

  function collectAssistantMessageElements(node: Node): HTMLElement[] {
    if (!(node instanceof HTMLElement)) return [];
    const results: HTMLElement[] = [];

    if (node.matches('[data-message-author-role="assistant"]')) {
      results.push(node);
    }

    node.querySelectorAll('[data-message-author-role="assistant"]').forEach((el) => {
      if (el instanceof HTMLElement) results.push(el);
    });

    node.querySelectorAll(
      'article[data-testid^="conversation-turn"], div[data-testid^="conversation-turn"]'
    ).forEach((turn) => {
      if (!(turn instanceof HTMLElement)) return;
      const assistant = turn.querySelector('[data-message-author-role="assistant"]');
      if (assistant instanceof HTMLElement) results.push(assistant);
    });

    return results;
  }

  const CLAUDE_ASSISTANT_MESSAGE_SELECTORS = [
    ".standard-markdown",
    ".font-claude-response-body",
    '[data-message-author-role="assistant"]',
  ];

  const CLAUDE_USER_MESSAGE_SELECTORS = [
    '[data-testid="user-message"]',
    '[data-message-author-role="user"]',
    '[data-testid="chat-message"][data-is-user="true"]',
    '[data-testid="chat-message"][data-author="user"]',
    ".font-user-message",
    ".font-claude-user-body",
    ".user-message",
  ];

  const GEMINI_ASSISTANT_MESSAGE_SELECTORS = [
    "structured-content-container",
    "message-content",
    ".response-content",
  ];

  function collectElementsBySelectors(node: Node, selectors: string[]): HTMLElement[] {
    if (!(node instanceof HTMLElement)) return [];
    const results: HTMLElement[] = [];
    for (const selector of selectors) {
      if (node.matches(selector)) {
        results.push(node);
      }
      node.querySelectorAll(selector).forEach((el) => {
        if (el instanceof HTMLElement) results.push(el);
      });
    }
    return results;
  }

  function collectClaudeAssistantMessageElements(node: Node): HTMLElement[] {
    return collectElementsBySelectors(node, CLAUDE_ASSISTANT_MESSAGE_SELECTORS);
  }

  function collectClaudeUserMessageElements(node: Node): HTMLElement[] {
    return collectElementsBySelectors(node, CLAUDE_USER_MESSAGE_SELECTORS);
  }

  function collectGeminiAssistantMessageElements(node: Node): HTMLElement[] {
    return collectElementsBySelectors(node, GEMINI_ASSISTANT_MESSAGE_SELECTORS);
  }

  function extractAssistantMessageText(messageEl: HTMLElement, platform: Platform): string {
    if (platform === "chatgpt") {
      return messageEl.innerText ?? "";
    }

    if (platform === "claude_web") {
      const content =
        messageEl.querySelector<HTMLElement>(
          ".standard-markdown, .font-claude-response-body"
        ) ?? messageEl;
      return content.innerText ?? "";
    }

    if (platform === "gemini_web") {
      const content =
        messageEl.querySelector<HTMLElement>(
          "message-content, .markdown, .markdown-main-panel, .response-content"
        ) ?? messageEl;
      return content.innerText ?? "";
    }

    return messageEl.innerText ?? "";
  }

  function extractUserMessageText(messageEl: HTMLElement, platform: Platform): string {
    if (platform === "claude_web") {
      const content =
        messageEl.querySelector<HTMLElement>(
          ".whitespace-pre-wrap, .standard-markdown, .font-claude-user-body"
        ) ??
        messageEl;
      return content.innerText ?? "";
    }
    return messageEl.innerText ?? "";
  }

  function findAssistantMessageContainerFromTarget(
    target: HTMLElement,
    platform: Platform
  ): HTMLElement | null {
    const selectors =
      platform === "claude_web"
        ? CLAUDE_ASSISTANT_MESSAGE_SELECTORS
        : platform === "gemini_web"
        ? GEMINI_ASSISTANT_MESSAGE_SELECTORS
        : [];
    if (selectors.length === 0) return null;
    const selectorList = selectors.join(", ");
    return target.closest<HTMLElement>(selectorList);
  }

  function findAssistantMessageContainerFromButton(
    target: HTMLElement,
    platform: Platform
  ): HTMLElement | null {
    const selectors =
      platform === "claude_web"
        ? CLAUDE_ASSISTANT_MESSAGE_SELECTORS
        : platform === "gemini_web"
        ? GEMINI_ASSISTANT_MESSAGE_SELECTORS
        : [];
    if (selectors.length === 0) return null;
    const selectorList = selectors.join(", ");

    let current: HTMLElement | null = target;
    while (current && current !== document.body) {
      if (current.matches(selectorList)) return current;
      const found = current.querySelector<HTMLElement>(selectorList);
      if (found) return found;
      current = current.parentElement;
    }

    return null;
  }

  function extractLanguageHint(container: HTMLElement | null): string | undefined {
    if (!container) return undefined;
    const languageAttr =
      container.getAttribute("data-language") ??
      container.getAttribute("data-code-language");
    if (languageAttr) return languageAttr.trim().toLowerCase();

    const classMatch = Array.from(container.classList).find((cls) =>
      cls.startsWith("language-")
    );
    if (classMatch) {
      return classMatch.replace("language-", "").trim().toLowerCase();
    }

    return undefined;
  }

  function looksLikeCodeText(text: string): boolean {
    if (!text.includes("\n")) return false;

    const lines = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length === 0) return false;

    let codeLikeLines = 0;
    for (const line of lines) {
      const wordCount = line.split(/\s+/).filter(Boolean).length;
      const hasSymbols = /[;{}()=]/.test(line);
      if (hasSymbols && wordCount <= 4) {
        codeLikeLines += 1;
      }
    }

    return codeLikeLines / lines.length >= 0.3;
  }

  function emitCopyEvent(
    metadata: CopyEventMetadata,
    attemptsLeft: number = 1
  ) {
    if (!isChatGptConversationPage()) return;

    // v0.2 already guarantees a stable per-tab sessionId.
    const sessionId = getOrCreateSessionId("chatgpt");

    recordCopyOutputWithMetadata(metadata, "chatgpt", sessionId);
  }

  function handleCopyEvent() {
    if (!isChatGptConversationPage()) return;

    const selection = window.getSelection();
    if (!selection) return;

    const text = selection.toString();
    if (!text || text.trim().length === 0) return;

    const container = getSelectionContainer(selection);
    if (!container) return;

    if (container.closest("textarea, [contenteditable='true']")) {
      return;
    }

    const assistantMessageEl = findAssistantMessageElement(container);
    const chatArea = container.closest("main, [role='main']");
    if (!assistantMessageEl) return;

    const messageId = resolveMessageId(assistantMessageEl);
    const codeContainer =
      container.closest("pre, code, [data-language], [data-code-language]");
    const languageHint = extractLanguageHint(
      codeContainer ? (codeContainer as HTMLElement) : null
    );

    const isCodeLike =
      Boolean(codeContainer) || looksLikeCodeText(text);

    const metadata: CopyEventMetadata = {
      site: "chatgpt",
      messageId,
      charCount: text.length,
      isCodeLike,
      languageHint,
      trigger: "selection",
    };

    emitCopyEvent(metadata);
  }

  function handleSelectionCopyForPlatform(platform: Platform) {
    const selection = window.getSelection();
    if (!selection) return;

    const text = selection.toString();
    if (!text || text.trim().length === 0) return;

    const container = getSelectionContainer(selection);
    if (!container) return;

    if (container.closest("textarea, [contenteditable='true']")) {
      return;
    }

    const messageEl = findAssistantMessageContainerFromTarget(container, platform);
    if (!messageEl) return;

    const codeContainer =
      container.closest("pre, code, [data-language], [data-code-language]") ??
      messageEl.querySelector<HTMLElement>("pre, code, [data-language], [data-code-language]") ??
      null;
    const languageHint = extractLanguageHint(codeContainer as HTMLElement | null);
    const isCodeLike = Boolean(codeContainer) || looksLikeCodeText(text);

    const metadata: CopyEventMetadata = {
      site: platform === "chatgpt" ? "chatgpt" : "other",
      charCount: text.length,
      isCodeLike,
      languageHint,
      trigger: "selection",
    };

    recordCopyOutputWithMetadata(metadata, platform);
  }

  function handleCopyFullReplyClick(buttonEl: HTMLElement) {
    if (!isChatGptHost()) return;

    const messageEl = findAssistantMessageElement(buttonEl);
    if (!messageEl) return;

    const text = messageEl.innerText || "";
    const charCount = text.length;
    if (!charCount) return;

    const sessionId = getOrCreateSessionId("chatgpt");

    const messageId = resolveMessageId(messageEl);

    const metadata: CopyEventMetadata = {
      site: "chatgpt",
      messageId,
      charCount,
      isCodeLike: false,
      languageHint: undefined,
      trigger: "button_full_reply",
    };

    recordCopyOutputWithMetadata(metadata, "chatgpt", sessionId);
  }

  function handleCopyCodeClick(buttonEl: HTMLElement) {

    if (!isChatGptHost()) return;

    const codeContainer =
      buttonEl.closest<HTMLElement>("pre") ??
      buttonEl.closest<HTMLElement>("code") ??
      buttonEl.closest<HTMLElement>("[data-language], [data-code-language]") ??
      buttonEl.closest<HTMLElement>("div")?.querySelector<HTMLElement>(
        "pre, code, [data-language], [data-code-language]"
      ) ??
      null;
    if (!codeContainer) return;

    const text = codeContainer.innerText || "";
    const charCount = text.length;
    if (!charCount) return;

    const sessionId = getOrCreateSessionId("chatgpt");

    const messageEl = findAssistantMessageElement(codeContainer);
    const messageId = messageEl ? resolveMessageId(messageEl) : undefined;
    const languageHint = extractLanguageHint(codeContainer);

    const metadata: CopyEventMetadata = {
      site: "chatgpt",
      messageId,
      charCount,
      isCodeLike: true,
      languageHint,
      trigger: "button_code_block",
    };

    recordCopyOutputWithMetadata(metadata, "chatgpt", sessionId);
  }

  function handleFeedbackClick(buttonEl: HTMLElement, kind: FeedbackEventKind) {
    if (!isChatGptHost()) return;

    const sessionId = getOrCreateSessionId("chatgpt");

    const messageEl = findAssistantMessageElement(buttonEl);
    const messageId = messageEl ? resolveMessageId(messageEl) : undefined;

    const metadata: FeedbackEventMetadata = {
      site: "chatgpt",
      messageId,
    };

    recordEvent(kind, metadata, sessionId);
  }

  function emitMoltbotCopyEvent(
    trigger: CopyTrigger,
    text: string
  ) {
    const normalized = text.trim();
    if (!normalized) return;

    const metadata: CopyEventMetadata = {
      site: "other",
      charCount: normalized.length,
      isCodeLike: false,
      trigger,
    };

    recordCopyOutputWithMetadata(
      metadata,
      "moltbot_webchat",
      getOrCreateSessionId("moltbot_webchat")
    );
  }

  function handleMoltbotCopyButtonClick(buttonEl: HTMLElement) {
    const bubble = buttonEl.closest<HTMLElement>(".chat-bubble");
    if (!bubble) return;
    const textEl = bubble.querySelector(".chat-text");
    const text =
      (textEl instanceof HTMLElement ? textEl.innerText : bubble.innerText) ?? "";
    emitMoltbotCopyEvent("button_full_reply", text);
  }

  function handleMoltbotSelectionCopy() {
    const selection = window.getSelection();
    if (!selection) return;
    const text = selection.toString();
    if (!text || !text.trim()) return;
    const container = getSelectionContainer(selection);
    if (!container) return;
    if (!container.closest(".chat-bubble")) return;
    emitMoltbotCopyEvent("selection", text);
  }

  function setupChatgptObserver() {
    document.addEventListener("copy", handleCopyEvent, true);
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;

        if (!isChatGptHost()) return;

        const fullReplyButton = target.closest<HTMLElement>(
          "button[data-testid='copy-turn-action-button'], button[aria-label='Copy response'], button[aria-label='Copy reply']"
        );

        const copyCodeButton = !fullReplyButton && target.closest<HTMLElement>(
          "button[aria-label='Copy'], button[aria-label='Copy code']"
        );

        
        if (fullReplyButton) {
          handleCopyFullReplyClick(fullReplyButton);
          return;
        }
        if (copyCodeButton) {
          handleCopyCodeClick(copyCodeButton);
          return;
        }

        const thumbsUpButton = target.closest<HTMLElement>(
          "button[data-testid='good-response-turn-action-button'], button[aria-label='Good response'], button[aria-label='Thumbs up']"
        );

        const thumbsDownButton = target.closest<HTMLElement>(
          "button[data-testid='bad-response-turn-action-button'], button[aria-label='Bad response'], button[aria-label='Thumbs down']"
        );

        if (thumbsUpButton) {
          handleFeedbackClick(thumbsUpButton, "feedback_good");
          return;
        }
        
        if (thumbsDownButton) {
          handleFeedbackClick(thumbsDownButton, "feedback_bad");
          return;
        }
      },
      true
    );
    startAssistantObserver();
  }

  const boundForms = new WeakSet<HTMLFormElement>();
  const boundButtons = new WeakSet<HTMLButtonElement>();

  function bindPromptSendListeners(root: Document | HTMLElement) {
    const form = root.querySelector("form");
    if (
      form &&
      (form.querySelector("textarea") ||
        form.querySelector('[contenteditable="true"]'))
    ) {
      if (!boundForms.has(form)) {
        boundForms.add(form);
        form.addEventListener(
          "submit",
          () => {
            const text = findChatInputText(form);
            if (!text.trim()) return;
            recordUserPrompt(getActivePlatform(), text);
          },
          true
        );
      }
    }

    const sendButton =
      root.querySelector<HTMLButtonElement>('button[type="submit"]') ??
      root.querySelector<HTMLButtonElement>(
        'button[aria-label*="Send"], button[data-testid*="send"]'
      );
    if (sendButton && !boundButtons.has(sendButton)) {
      boundButtons.add(sendButton);
      sendButton.addEventListener(
        "click",
        () => {
          const text = findChatInputText(root);
          if (!text.trim()) return;
          recordUserPrompt(getActivePlatform(), text);
        },
        true
      );
    }
  }

  // bindPromptSendListeners(document);

  function bindGlobalPromptListeners() {
    const w = window as any;
    if (w.__neaAgoraPromptListenersBound) return;
    w.__neaAgoraPromptListenersBound = true;

    if (DEBUG_RECORDER) {        
        console.log("[Nea Agora Recorder] binding global prompt listeners");
    }
    document.addEventListener(
      "submit",
      (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;

        const form = target.closest("form");
        if (!form) return;

        const hasChatInput = form.querySelector("textarea, [contenteditable='true']");
        if (!hasChatInput) return;

        if (DEBUG_RECORDER) {
          console.log("[Nea Agora Recorder] submit from chat-like form");
        }
        const text = findChatInputText(form);
        if (!text.trim()) return;
        recordUserPrompt(getActivePlatform(), text);
        if (DEBUG_RECORDER) {
          console.debug("[Nea Agora Recorder] user message detected (submit)");
        }
      },
      true
    );

    document.addEventListener(
      "keydown",
      (event) => {
        const ke = event as KeyboardEvent;
        if (ke.key !== "Enter" || ke.shiftKey) return;

        const target = ke.target as HTMLElement | null;
        const active = (document.activeElement as HTMLElement | null) ?? target;
        if (!active) return;

        // Be noisy for now so we can see what /c/... is doing
        if (typeof console !== "undefined" && console && typeof console.log === "function") {
          if (DEBUG_RECORDER) {
            console.log("[Nea Agora Recorder] keydown Enter", {
              targetTag: target?.tagName,
              activeTag: active?.tagName,
              activeRole: active?.getAttribute("role"),
              isEditable: active?.isContentEditable,
            });
          }
        }

        const isTextarea = active instanceof HTMLTextAreaElement;
        const isEditable = active.isContentEditable;
        const isRoleTextbox = active.getAttribute("role") === "textbox";

        const isTextLike =
          isTextarea ||
          isEditable ||
          isRoleTextbox;

        if (!isTextLike) return;

        if (typeof console !== "undefined" && console && typeof console.log === "function") {
          if (DEBUG_RECORDER) {
            console.log("[Nea Agora Recorder] Enter in chat-like input");
          }
        }
        const text = findChatInputText(active);
        if (!text.trim()) return;
        recordUserPrompt(getActivePlatform(), text);
        // console.debug("[Nea Agora Recorder] user message detected (enter)");
      },
      true
    );

  }

  const assistantObserver = new MutationObserver((mutations) => {
    // console.debug("[nea-agora][llm] mutation observed", mutations);
    const platform = getActivePlatform();
    if (platform === "moltbot_webchat") return;
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (platform === "claude_web") {
          const userEls = collectClaudeUserMessageElements(node);
          for (const userEl of userEls) {
            const text = extractUserMessageText(userEl, platform).trim();
            if (text) {
              recordUserPrompt(platform, text);
            }
          }
        }
        const assistantEls =
          platform === "chatgpt"
            ? collectAssistantMessageElements(node)
            : platform === "claude_web"
            ? collectClaudeAssistantMessageElements(node)
            : platform === "gemini_web"
            ? collectGeminiAssistantMessageElements(node)
            : [];
        for (const messageEl of assistantEls) {
          // console.debug("[nea-agora][llm] assistant node detected", messageEl);
          scheduleAssistantMessageCount(messageEl, platform);
        }
      }
    }
  });

  function attachAssistantObserverTo(container: HTMLElement) {
    if (observedMessageContainer === container) {
      return;
    }

    if (observedMessageContainer) {
      assistantObserver.disconnect();
    }

    observedMessageContainer = container;
    assistantObserver.observe(container, {
      childList: true,
      subtree: true,
    });

    // console.debug("[nea-agora][llm] attached observer to message container");
  }

  function findAssistantContainer(platform: Platform): HTMLElement | null {
    if (platform === "chatgpt") {
      return document.querySelector("main") as HTMLElement | null;
    }
    if (platform === "claude_web" || platform === "gemini_web") {
      return (
        (document.querySelector("main") as HTMLElement | null) ??
        (document.querySelector("[role='main']") as HTMLElement | null) ??
        document.body
      );
    }
    return null;
  }

  function startAssistantObserver() {
    let lastContainer: HTMLElement | null = null;

    setInterval(() => {
      const platform = getActivePlatform();
      const container = findAssistantContainer(platform);
      if (!container) {
        return;
      }

      if (container !== lastContainer) {
        // console.debug("[nea-agora][llm] message container changed or found");
        lastContainer = container;
        if (platform === "chatgpt") {
          chatgptObserverAttached = true;
        } else if (platform === "claude_web") {
          claudeObserverAttached = true;
        } else if (platform === "gemini_web") {
          geminiObserverAttached = true;
        }
        attachAssistantObserverTo(container);
      }
    }, 1000);
  }

  if (isChatgpt) {
    setupChatgptObserver();
  }

  if (isClaude || isGemini) {
    startAssistantObserver();
  }

  if (isChatgpt || isMoltbot || isClaude || isGemini) {
    bindGlobalPromptListeners();
  }

  if (isMoltbot) {
    setupMoltbotObserver();
    document.addEventListener("copy", handleMoltbotSelectionCopy, true);
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;
        const copyButton = target.closest<HTMLElement>(".chat-copy-btn");
        if (!copyButton) return;
        handleMoltbotCopyButtonClick(copyButton);
      },
      true
    );
  }

  if (isClaude) {
    document.addEventListener(
      "copy",
      () => {
        handleSelectionCopyForPlatform("claude_web");
      },
      true
    );
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;

        const copyButton = target.closest<HTMLElement>(
          '[data-testid="action-bar-copy"], [aria-label="Copy"]'
        );
        if (copyButton) {
          const messageEl = findAssistantMessageContainerFromButton(
            copyButton,
            "claude_web"
          );
          const text = messageEl
            ? extractAssistantMessageText(messageEl, "claude_web")
            : "";
          if (text.trim()) {
            recordCopyOutput(text);
          }
        }

        const upButton = target.closest<HTMLElement>(
          '[aria-label="Give positive feedback"]'
        );
        if (upButton) {
          recordThumbsUp();
          return;
        }

        const downButton = target.closest<HTMLElement>(
          '[aria-label="Give negative feedback"]'
        );
        if (downButton) {
          recordThumbsDown();
        }
      },
      true
    );
  }

  if (isGemini) {
    document.addEventListener(
      "copy",
      () => {
        handleSelectionCopyForPlatform("gemini_web");
      },
      true
    );
    document.addEventListener(
      "click",
      (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;

        const copyButton = target.closest<HTMLElement>(
          '[data-test-id="copy-button"], [aria-label="Copy"]'
        );
        if (copyButton) {
          const messageEl = findAssistantMessageContainerFromButton(
            copyButton,
            "gemini_web"
          );
          const text = messageEl
            ? extractAssistantMessageText(messageEl, "gemini_web")
            : "";
          if (text.trim()) {
            recordCopyOutput(text);
          }
        }

        const upButton = target.closest<HTMLElement>(
          'thumb-up-button, [aria-label="Good response"]'
        );
        if (upButton) {
          recordThumbsUp();
          return;
        }

        const downButton = target.closest<HTMLElement>(
          'thumb-down-button, [aria-label="Bad response"]'
        );
        if (downButton) {
          recordThumbsDown();
        }
      },
      true
    );
  }


  //const observer = new MutationObserver(() => {
  //  bindPromptSendListeners(document);
  //});

  // observer.observe(document.documentElement, { childList: true, subtree: true,  });

  // Fire a page_visit event once on load for supported hosts.
  if (isChatgpt || isMoltbot || isClaude || isGemini) {
    recordEvent("page_visit");
  }

  if (isChatgpt) {
    setTimeout(() => {
      if (!chatgptObserverAttached) {
        recordDiagnostic("NO_ASSISTANT_CONTAINER", {
          platformHint: "chatgpt",
          url: window.location.href,
        });
      }
    }, 3000);
  }

  if (isClaude) {
    setTimeout(() => {
      if (!claudeObserverAttached) {
        recordDiagnostic("NO_ASSISTANT_CONTAINER", {
          platformHint: "claude_web",
          url: window.location.href,
        });
      }
    }, 3000);
  }

  if (isGemini) {
    setTimeout(() => {
      if (!geminiObserverAttached) {
        recordDiagnostic("NO_ASSISTANT_CONTAINER", {
          platformHint: "gemini_web",
          url: window.location.href,
        });
      }
    }, 3000);
  }
})();

