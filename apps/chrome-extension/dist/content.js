"use strict";
(() => {
    const DEBUG_COUNTS = false;
    const DEBUG_RECORDER = false;
    if (DEBUG_RECORDER) {
        console.log("[Nea Agora Recorder] content script loaded on this page");
    }
    const tabSessionSuffix = Math.random().toString(36).slice(2);
    const sessionMetricsById = new Map();
    const countedAssistantMessageIds = new Set();
    const countedAssistantMessageEls = new WeakSet();
    const pendingAssistantMessageEls = new WeakSet();
    let observedMessageContainer = null;
    const USER_PROMPT_DEDUP_MS = 500;
    let lastUserPromptAt = 0;
    let lastUserPromptText = "";
    chrome.storage.local.get(["neaAgoraSessionMetrics"], (result) => {
        const stored = result.neaAgoraSessionMetrics;
        if (stored && typeof stored === "object") {
            for (const [sessionId, metrics] of Object.entries(stored)) {
                if (!metrics || typeof metrics !== "object")
                    continue;
                const userMessageCount = Number(metrics.userMessageCount ?? 0);
                const llmMessageCount = Number(metrics.llmMessageCount ?? 0);
                sessionMetricsById.set(sessionId, {
                    userMessageCount,
                    llmMessageCount,
                });
            }
        }
    });
    function getChatGptConversationIdFromUrl(url = location.href) {
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
        }
        catch {
            return null;
        }
    }
    function deriveSessionId() {
        // Prefer conversation scoped session ids when a conversation is active.
        const convId = getChatGptConversationIdFromUrl();
        if (convId) {
            return `chatgpt-c-${convId}`;
        }
        // Fallback: tab scoped session id
        return `chatgpt-tab-${tabSessionSuffix}`;
    }
    function ensureSessionMetrics(sessionId) {
        if (sessionMetricsById.has(sessionId))
            return;
        sessionMetricsById.set(sessionId, {
            userMessageCount: 0,
            llmMessageCount: 0,
        });
    }
    function persistSessionMetrics() {
        const serialized = {};
        for (const [sessionId, metrics] of sessionMetricsById.entries()) {
            serialized[sessionId] = {
                userMessageCount: metrics.userMessageCount,
                llmMessageCount: metrics.llmMessageCount,
            };
        }
        chrome.storage.local.set({ neaAgoraSessionMetrics: serialized });
    }
    function updateSessionTitle(sessionId) {
        let title = "";
        const titleEl = document.querySelector('[data-testid="conversation-name"]');
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
            const flags = data.neaAgoraSessionFlags ?? {};
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
    function incrementUserMessageCount(sessionId, messageText) {
        const normalized = messageText.trim();
        if (!normalized)
            return;
        // Heuristic: avoid double-counting when multiple hooks fire for the same send.
        const now = Date.now();
        if (now - lastUserPromptAt < USER_PROMPT_DEDUP_MS && normalized === lastUserPromptText) {
            return;
        }
        lastUserPromptAt = now;
        lastUserPromptText = normalized;
        ensureSessionMetrics(sessionId);
        const metrics = sessionMetricsById.get(sessionId);
        metrics.userMessageCount += 1;
        persistSessionMetrics();
        if (DEBUG_RECORDER) {
            console.debug("[Nea Agora Recorder] user message counted", {
                sessionId,
                userMessageCount: metrics.userMessageCount,
            });
        }
    }
    function incrementAssistantMessageCount(sessionId, messageId) {
        ensureSessionMetrics(sessionId);
        const metrics = sessionMetricsById.get(sessionId);
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
    function recordEvent(type, metadata, sessionIdOverride) {
        try {
            // If the extension context is invalid, bail out early
            if (!chrome?.runtime?.id) {
                if (typeof console !== "undefined" && console && typeof console.warn === "function") {
                    if (DEBUG_RECORDER) {
                        console.debug("[Nea Agora Recorder] recordEvent skipped: extension context invalidated");
                    }
                }
                return;
            }
            const newEvent = {
                type,
                site: "chatgpt",
                url: window.location.href,
                timestamp: new Date().toISOString(),
                sessionId: sessionIdOverride ?? deriveSessionId(),
                metadata,
            };
            updateSessionTitle(newEvent.sessionId);
            // Safe debug log – this will not crash the script
            if (typeof console !== "undefined" && console && typeof console.log === "function") {
                if (DEBUG_RECORDER) {
                    console.log("[Nea Agora Recorder] event", newEvent);
                }
            }
            chrome.storage.local.get(["neaAgoraRecorder"], (result) => {
                const events = Array.isArray(result.neaAgoraRecorder)
                    ? result.neaAgoraRecorder
                    : [];
                const updatedEvents = [...events, newEvent];
                chrome.storage.local.set({ neaAgoraRecorder: updatedEvents }, () => {
                    if (typeof console !== "undefined" && console && typeof console.log === "function") {
                        if (DEBUG_RECORDER) {
                            console.log("[Nea Agora Recorder] stored", updatedEvents.length, "events");
                        }
                    }
                });
            });
        }
        catch (err) {
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
    function getSelectionContainer(selection) {
        const anchor = selection.anchorNode;
        if (!anchor)
            return null;
        if (anchor.nodeType === Node.ELEMENT_NODE) {
            return anchor;
        }
        return anchor.parentElement;
    }
    function findAssistantMessageElement(container) {
        if (!container)
            return null;
        const direct = container.closest('[data-message-author-role="assistant"]');
        if (direct)
            return direct;
        const turn = container.closest('article[data-testid^="conversation-turn"], div[data-testid^="conversation-turn"]');
        if (turn && turn.querySelector('[data-message-author-role="assistant"]')) {
            return turn;
        }
        return null;
    }
    function resolveMessageId(messageEl) {
        if (!messageEl)
            return undefined;
        const idCarrier = messageEl.closest("[data-message-id]");
        const carrierId = idCarrier?.getAttribute("data-message-id") ?? undefined;
        if (carrierId)
            return carrierId;
        const directId = messageEl.getAttribute("data-message-id") ??
            messageEl.getAttribute("data-id") ??
            undefined;
        if (directId)
            return directId;
        const testId = messageEl.getAttribute("data-testid");
        if (testId && testId.startsWith("conversation-turn-")) {
            return testId;
        }
        return undefined;
    }
    function findChatInputText(element) {
        if (!element)
            return "";
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
    function isFinalAssistantMessage(messageEl) {
        // For v0.5 we keep it simple:
        // If the assistant message element has some non-empty text, we treat it as "final".
        const text = (messageEl.textContent ?? "").trim();
        return text.length > 0;
    }
    function scheduleAssistantMessageCount(messageEl) {
        if (pendingAssistantMessageEls.has(messageEl))
            return;
        pendingAssistantMessageEls.add(messageEl);
        const messageId = resolveMessageId(messageEl);
        if (messageId && countedAssistantMessageIds.has(messageId))
            return;
        if (!messageId && countedAssistantMessageEls.has(messageEl))
            return;
        // Heuristic: wait briefly for streaming to settle and copy button to appear.
        setTimeout(() => {
            pendingAssistantMessageEls.delete(messageEl);
            if (!messageEl.isConnected)
                return;
            if (!isFinalAssistantMessage(messageEl))
                return;
            if (messageId) {
                if (countedAssistantMessageIds.has(messageId))
                    return;
                countedAssistantMessageIds.add(messageId);
            }
            else {
                if (countedAssistantMessageEls.has(messageEl))
                    return;
                countedAssistantMessageEls.add(messageEl);
            }
            const sessionId = deriveSessionId();
            if (DEBUG_COUNTS) {
                console.debug("[nea-agora] llmMessageCount++", sessionId, sessionMetricsById.get(sessionId)?.llmMessageCount);
            }
            incrementAssistantMessageCount(sessionId, messageId);
        }, 700);
    }
    function collectAssistantMessageElements(node) {
        if (!(node instanceof HTMLElement))
            return [];
        const results = [];
        if (node.matches('[data-message-author-role="assistant"]')) {
            results.push(node);
        }
        node.querySelectorAll('[data-message-author-role="assistant"]').forEach((el) => {
            if (el instanceof HTMLElement)
                results.push(el);
        });
        node.querySelectorAll('article[data-testid^="conversation-turn"], div[data-testid^="conversation-turn"]').forEach((turn) => {
            if (!(turn instanceof HTMLElement))
                return;
            const assistant = turn.querySelector('[data-message-author-role="assistant"]');
            if (assistant instanceof HTMLElement)
                results.push(assistant);
        });
        return results;
    }
    function extractLanguageHint(container) {
        if (!container)
            return undefined;
        const languageAttr = container.getAttribute("data-language") ??
            container.getAttribute("data-code-language");
        if (languageAttr)
            return languageAttr.trim().toLowerCase();
        const classMatch = Array.from(container.classList).find((cls) => cls.startsWith("language-"));
        if (classMatch) {
            return classMatch.replace("language-", "").trim().toLowerCase();
        }
        return undefined;
    }
    function looksLikeCodeText(text) {
        if (!text.includes("\n"))
            return false;
        const lines = text
            .split("\n")
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        if (lines.length === 0)
            return false;
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
    function emitCopyEvent(metadata, attemptsLeft = 1) {
        if (!isChatGptConversationPage())
            return;
        // v0.2 already guarantees a stable per-tab sessionId via deriveSessionId.
        const sessionId = deriveSessionId();
        recordEvent("copy_output", metadata, sessionId);
    }
    function handleCopyEvent() {
        if (!isChatGptConversationPage())
            return;
        const selection = window.getSelection();
        if (!selection)
            return;
        const text = selection.toString();
        if (!text || text.trim().length === 0)
            return;
        const container = getSelectionContainer(selection);
        if (!container)
            return;
        if (container.closest("textarea, [contenteditable='true']")) {
            return;
        }
        const assistantMessageEl = findAssistantMessageElement(container);
        const chatArea = container.closest("main, [role='main']");
        if (!assistantMessageEl && !chatArea)
            return;
        const messageId = resolveMessageId(assistantMessageEl);
        const codeContainer = container.closest("pre, code, [data-language], [data-code-language]");
        const languageHint = extractLanguageHint(codeContainer ? codeContainer : null);
        const isCodeLike = Boolean(codeContainer) || looksLikeCodeText(text);
        const metadata = {
            site: "chatgpt",
            messageId,
            charCount: text.length,
            isCodeLike,
            languageHint,
            trigger: "selection",
        };
        emitCopyEvent(metadata);
    }
    function handleCopyFullReplyClick(buttonEl) {
        if (!isChatGptHost())
            return;
        const messageEl = findAssistantMessageElement(buttonEl);
        if (!messageEl)
            return;
        const text = messageEl.innerText || "";
        const charCount = text.length;
        if (!charCount)
            return;
        const sessionId = deriveSessionId();
        const messageId = resolveMessageId(messageEl);
        const metadata = {
            site: "chatgpt",
            messageId,
            charCount,
            isCodeLike: false,
            languageHint: undefined,
            trigger: "button_full_reply",
        };
        recordEvent("copy_output", metadata, sessionId);
    }
    function handleCopyCodeClick(buttonEl) {
        if (!isChatGptHost())
            return;
        const codeContainer = buttonEl.closest("pre") ??
            buttonEl.closest("code") ??
            buttonEl.closest("[data-language], [data-code-language]") ??
            buttonEl.closest("div")?.querySelector("pre, code, [data-language], [data-code-language]") ??
            null;
        if (!codeContainer)
            return;
        const text = codeContainer.innerText || "";
        const charCount = text.length;
        if (!charCount)
            return;
        const sessionId = deriveSessionId();
        const messageEl = findAssistantMessageElement(codeContainer);
        const messageId = messageEl ? resolveMessageId(messageEl) : undefined;
        const languageHint = extractLanguageHint(codeContainer);
        const metadata = {
            site: "chatgpt",
            messageId,
            charCount,
            isCodeLike: true,
            languageHint,
            trigger: "button_code_block",
        };
        recordEvent("copy_output", metadata, sessionId);
    }
    function handleFeedbackClick(buttonEl, kind) {
        if (!isChatGptHost())
            return;
        const sessionId = deriveSessionId();
        const messageEl = findAssistantMessageElement(buttonEl);
        const messageId = messageEl ? resolveMessageId(messageEl) : undefined;
        const metadata = {
            site: "chatgpt",
            messageId,
        };
        recordEvent(kind, metadata, sessionId);
    }
    recordEvent("page_visit");
    bindGlobalPromptListeners();
    document.addEventListener("copy", handleCopyEvent, true);
    document.addEventListener("click", (event) => {
        const target = event.target;
        if (!target)
            return;
        if (!isChatGptHost())
            return;
        const fullReplyButton = target.closest("button[data-testid='copy-turn-action-button'], button[aria-label='Copy response'], button[aria-label='Copy reply']");
        const copyCodeButton = !fullReplyButton && target.closest("button[aria-label='Copy'], button[aria-label='Copy code']");
        if (fullReplyButton) {
            handleCopyFullReplyClick(fullReplyButton);
            return;
        }
        if (copyCodeButton) {
            handleCopyCodeClick(copyCodeButton);
            return;
        }
        const thumbsUpButton = target.closest("button[data-testid='good-response-turn-action-button'], button[aria-label='Good response'], button[aria-label='Thumbs up']");
        const thumbsDownButton = target.closest("button[data-testid='bad-response-turn-action-button'], button[aria-label='Bad response'], button[aria-label='Thumbs down']");
        if (thumbsUpButton) {
            handleFeedbackClick(thumbsUpButton, "feedback_good");
            return;
        }
        if (thumbsDownButton) {
            handleFeedbackClick(thumbsDownButton, "feedback_bad");
            return;
        }
    }, true);
    const boundForms = new WeakSet();
    const boundButtons = new WeakSet();
    function bindPromptSendListeners(root) {
        const form = root.querySelector("form");
        if (form &&
            (form.querySelector("textarea") ||
                form.querySelector('[contenteditable="true"]'))) {
            if (!boundForms.has(form)) {
                boundForms.add(form);
                form.addEventListener("submit", () => {
                    const text = findChatInputText(form);
                    if (!text.trim())
                        return;
                    const sessionId = deriveSessionId();
                    recordEvent("user_prompt");
                    incrementUserMessageCount(sessionId, text);
                }, true);
            }
        }
        const sendButton = root.querySelector('button[type="submit"]') ??
            root.querySelector('button[aria-label*="Send"], button[data-testid*="send"]');
        if (sendButton && !boundButtons.has(sendButton)) {
            boundButtons.add(sendButton);
            sendButton.addEventListener("click", () => {
                const text = findChatInputText(root);
                if (!text.trim())
                    return;
                const sessionId = deriveSessionId();
                recordEvent("user_prompt");
                incrementUserMessageCount(sessionId, text);
            }, true);
        }
    }
    // bindPromptSendListeners(document);
    function bindGlobalPromptListeners() {
        const w = window;
        if (w.__neaAgoraPromptListenersBound)
            return;
        w.__neaAgoraPromptListenersBound = true;
        if (DEBUG_RECORDER) {
            console.log("[Nea Agora Recorder] binding global prompt listeners");
        }
        document.addEventListener("submit", (event) => {
            const target = event.target;
            if (!target)
                return;
            const form = target.closest("form");
            if (!form)
                return;
            const hasChatInput = form.querySelector("textarea, [contenteditable='true']");
            if (!hasChatInput)
                return;
            if (DEBUG_RECORDER) {
                console.log("[Nea Agora Recorder] submit from chat-like form");
            }
            const text = findChatInputText(form);
            if (!text.trim())
                return;
            const sessionId = deriveSessionId();
            recordEvent("user_prompt");
            incrementUserMessageCount(sessionId, text);
            if (DEBUG_RECORDER) {
                console.debug("[Nea Agora Recorder] user message detected (submit)");
            }
        }, true);
        document.addEventListener("keydown", (event) => {
            const ke = event;
            if (ke.key !== "Enter" || ke.shiftKey)
                return;
            const target = ke.target;
            const active = document.activeElement ?? target;
            if (!active)
                return;
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
            const isTextLike = isTextarea ||
                isEditable ||
                isRoleTextbox;
            if (!isTextLike)
                return;
            if (typeof console !== "undefined" && console && typeof console.log === "function") {
                if (DEBUG_RECORDER) {
                    console.log("[Nea Agora Recorder] Enter in chat-like input");
                }
            }
            const text = findChatInputText(active);
            if (!text.trim())
                return;
            const sessionId = deriveSessionId();
            recordEvent("user_prompt");
            incrementUserMessageCount(sessionId, text);
            // console.debug("[Nea Agora Recorder] user message detected (enter)");
        }, true);
    }
    const assistantObserver = new MutationObserver((mutations) => {
        // console.debug("[nea-agora][llm] mutation observed", mutations);
        if (!isChatGptConversationPage())
            return;
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
    function attachAssistantObserverTo(container) {
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
        let lastContainer = null;
        setInterval(() => {
            const container = document.querySelector("main");
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
    startAssistantObserver();
    //const observer = new MutationObserver(() => {
    //  bindPromptSendListeners(document);
    //});
    // observer.observe(document.documentElement, { childList: true, subtree: true,  });
})();
