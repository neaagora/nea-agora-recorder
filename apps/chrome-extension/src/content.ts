(() => {
  type Platform = "chatgpt" | "moltbot_webchat";

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
      | "feedback_good"
      | "feedback_bad";
    platform: Platform;
    site: "chatgpt" | "other";
    url: string;
    timestamp: string;
    sessionId: string;
    metadata?: CopyEventMetadata | FeedbackEventMetadata | LlmResponseEventMetadata;
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
  const countedAssistantMessageEls = new WeakSet<HTMLElement>();
  const pendingAssistantMessageEls = new WeakSet<HTMLElement>();
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

  function getOrCreateSessionId(platform: Platform): string {
    if (platform === "moltbot_webchat") {
      return deriveMoltbotSessionId();
    }
    return deriveChatGptSessionId();
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
    chrome.storage.local.set({ neaAgoraSessionMetrics: serialized });
  }

  function updateSessionTitle(sessionId: string, platform: Platform) {
    if (platform !== "chatgpt") return;
    let title = "";

    const titleEl = document.querySelector(
      '[data-testid="conversation-name"]'
    ) as HTMLElement | null;

    if (titleEl && titleEl.textContent) {
      title = titleEl.textContent.trim();
    }

    if (!title && document.title) {
      title = document.title.trim();
    }

    if (!title) {
      title = sessionId;
    }

    chrome.storage.local.get(["neaAgoraSessionFlags"], (data) => {
      const flags: Record<string, any> = data.neaAgoraSessionFlags ?? {};
      const current = flags[sessionId] ?? {};

      if (current.title && current.title !== sessionId) {
        return;
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
    const recent = recentUserTextBySession.get(sessionId);
    const now = Date.now();
    if (recent && recent.text === trimmed && now - recent.at < 2000) {
      return;
    }
    recentUserTextBySession.set(sessionId, { text: trimmed, at: now });
    recordEvent("user_prompt", undefined, sessionId, platform);
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

    recordEvent(
      "llm_response",
      {
        charCount: text.length,
        latencyMs,
        turnIndex,
      },
      sessionId,
      platform
    );

    incrementAssistantMessageCount(sessionId, messageId);
  }

  function recordEvent(
    type: EventRecord["type"],
    metadata?: EventRecord["metadata"],
    sessionIdOverride?: string,
    platformOverride?: Platform
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
    const platform =
      platformOverride ?? (isMoltbot ? "moltbot_webchat" : "chatgpt");
    const newEvent: EventRecord = {
      type,
      platform,
      site: platform === "chatgpt" ? "chatgpt" : "other",
      url: window.location.href,
      timestamp: new Date().toISOString(),
      sessionId: sessionIdOverride ?? getOrCreateSessionId(platform),
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


  function scheduleAssistantMessageCount(messageEl: HTMLElement) {
    if (pendingAssistantMessageEls.has(messageEl)) return;
    pendingAssistantMessageEls.add(messageEl);

    const messageId = resolveMessageId(messageEl);
    if (messageId && countedAssistantMessageIds.has(messageId)) return;
    if (!messageId && countedAssistantMessageEls.has(messageEl)) return;

    // Heuristic: wait briefly for streaming to settle and copy button to appear.
    setTimeout(() => {
      pendingAssistantMessageEls.delete(messageEl);
      if (!messageEl.isConnected) return;
      if (!isFinalAssistantMessage(messageEl)) return;

      if (messageId) {
        if (countedAssistantMessageIds.has(messageId)) return;
        countedAssistantMessageIds.add(messageId);
      } else {
        if (countedAssistantMessageEls.has(messageEl)) return;
        countedAssistantMessageEls.add(messageEl);
      }

      const sessionId = getOrCreateSessionId("chatgpt");
      if (DEBUG_COUNTS) {
        console.debug(
          "[nea-agora] llmMessageCount++",
          sessionId,
          sessionMetricsById.get(sessionId)?.llmMessageCount
        );
      }
      recordAssistantResponse(
        "chatgpt",
        messageEl.innerText ?? "",
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

    recordEvent("copy_output", metadata, sessionId);
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
    if (!assistantMessageEl && !chatArea) return;

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

    recordEvent("copy_output", metadata, sessionId);
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

    recordEvent("copy_output", metadata, sessionId);
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

    recordEvent(
      "copy_output",
      metadata,
      getOrCreateSessionId("moltbot_webchat"),
      "moltbot_webchat"
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
    recordEvent("page_visit", undefined, undefined, "chatgpt");
    bindGlobalPromptListeners();
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
            recordUserPrompt("chatgpt", text);
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
          recordUserPrompt("chatgpt", text);
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
        recordUserPrompt("chatgpt", text);
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
        recordUserPrompt("chatgpt", text);
        // console.debug("[Nea Agora Recorder] user message detected (enter)");
      },
      true
    );

  }

  const assistantObserver = new MutationObserver((mutations) => {
    // console.debug("[nea-agora][llm] mutation observed", mutations);
    if (!isChatGptConversationPage()) return;
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        const assistantEls = collectAssistantMessageElements(node);
        for (const messageEl of assistantEls) {
          // console.debug("[nea-agora][llm] assistant node detected", messageEl);
          scheduleAssistantMessageCount(messageEl);
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

  function startAssistantObserver() {
    let lastContainer: HTMLElement | null = null;

    setInterval(() => {
      const container = document.querySelector("main") as HTMLElement | null;
      if (!container) {
        return;
      }

      if (container !== lastContainer) {
        // console.debug("[nea-agora][llm] message container changed or found");
        lastContainer = container;
        attachAssistantObserverTo(container);
      }
    }, 1000);
  }

  if (isChatgpt) {
    setupChatgptObserver();
  }

  if (isMoltbot) {
    recordEvent("page_visit", undefined, undefined, "moltbot_webchat");
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


  //const observer = new MutationObserver(() => {
  //  bindPromptSendListeners(document);
  //});

  // observer.observe(document.documentElement, { childList: true, subtree: true,  });
})();

