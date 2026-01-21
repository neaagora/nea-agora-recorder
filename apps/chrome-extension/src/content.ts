(() => {
  type EventRecord = {
    type: "page_visit" | "user_prompt";
    site: "chatgpt";
    url: string;
    timestamp: string;
    sessionId: string;
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

  function recordEvent(type: EventRecord["type"]) {
    try {
      // If the extension context is invalid, bail out early
      if (!chrome?.runtime?.id) {
        if (typeof console !== "undefined" && console && typeof console.warn === "function") {
          console.warn(
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
        sessionId: deriveSessionId(),
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


  recordEvent("page_visit");
  bindGlobalPromptListeners();

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
