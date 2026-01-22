(() => {
  type CopyEventMetadata = {
    site: "chatgpt" | "other";
    messageId?: string;
    charCount: number;
    isCodeLike: boolean;
    languageHint?: string;
  };

  type EventRecord = {
    type: "page_visit" | "user_prompt" | "copy_output";
    site: "chatgpt";
    url: string;
    timestamp: string;
    sessionId: string;
    metadata?: CopyEventMetadata;
  };

  console.log("[Nea Agora Recorder] content script loaded on this page");

  let currentSessionId: string | null = null;

  function deriveSessionId() {
    if (currentSessionId) return currentSessionId;

    const match = window.location.pathname.match(/\/c\/([^/]+)/);
    if (match?.[1]) {
      currentSessionId = `chatgpt-c-${match[1]}`;
      return currentSessionId;
    }

    // fallback: stable per-tab ID
    currentSessionId = `chatgpt-tab-${Math.random().toString(36).slice(2)}`;
    return currentSessionId;
  }

  function recordEvent(
    type: EventRecord["type"],
    metadata?: EventRecord["metadata"],
    sessionIdOverride?: string
  ) {
    try {
      // If the extension context is invalid, bail out early
      if (!chrome?.runtime?.id) {
        if (typeof console !== "undefined" && console && typeof console.warn === "function") {
          console.debug(
            "[Nea Agora Recorder] recordEvent skipped: extension context invalidated"
          );
        }
        return;
      }
      const newEvent: EventRecord = {
        type,
        site: "chatgpt",
        url: window.location.href,
        timestamp: new Date().toISOString(),
        sessionId: sessionIdOverride ?? deriveSessionId(),
        metadata,
      };

      // Safe debug log – this will not crash the script
      if (typeof console !== "undefined" && console && typeof console.log === "function") {
        console.log("[Nea Agora Recorder] event", newEvent);
      }

      chrome.storage.local.get(["neaAgoraRecorder"], (result) => {
        const events = Array.isArray(result.neaAgoraRecorder)
          ? (result.neaAgoraRecorder as EventRecord[])
          : [];

        const updatedEvents = [...events, newEvent];

        chrome.storage.local.set({ neaAgoraRecorder: updatedEvents }, () => {
          if (typeof console !== "undefined" && console && typeof console.log === "function") {
            console.log(
              "[Nea Agora Recorder] stored",
              updatedEvents.length,
              "events"
            );
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
    const host = window.location.hostname;
    return host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com";
  }

  function isChatGptConversationPage() {
    // For v0.3, treat any ChatGPT host as eligible.
    // Session scoping is handled by deriveSessionId() per tab.
    return isChatGptHost();
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

    // v0.2 already guarantees a stable per-tab sessionId via deriveSessionId.
    const sessionId = deriveSessionId();
    if (!sessionId) {
      if (attemptsLeft > 0) {
        setTimeout(() => emitCopyEvent(metadata, attemptsLeft - 1), 500);
      }
      return;
    }

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
    };

    emitCopyEvent(metadata);
  }


  recordEvent("page_visit");
  bindGlobalPromptListeners();
  document.addEventListener("copy", handleCopyEvent, true);

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
            recordEvent("user_prompt");
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
          recordEvent("user_prompt");
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

    console.log("[Nea Agora Recorder] binding global prompt listeners");

    document.addEventListener(
      "submit",
      (event) => {
        const target = event.target as HTMLElement | null;
        if (!target) return;

        const form = target.closest("form");
        if (!form) return;

        const hasChatInput = form.querySelector("textarea, [contenteditable='true']");
        if (!hasChatInput) return;

        console.log("[Nea Agora Recorder] submit from chat-like form");
        recordEvent("user_prompt");
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
          console.log("[Nea Agora Recorder] keydown Enter", {
            targetTag: target?.tagName,
            activeTag: active?.tagName,
            activeRole: active?.getAttribute("role"),
            isEditable: active?.isContentEditable,
          });
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
          console.log("[Nea Agora Recorder] Enter in chat-like input");
        }
        recordEvent("user_prompt");
      },
      true
    );

  }


  //const observer = new MutationObserver(() => {
  //  bindPromptSendListeners(document);
  //});

  // observer.observe(document.documentElement, { childList: true, subtree: true,  });
})();
