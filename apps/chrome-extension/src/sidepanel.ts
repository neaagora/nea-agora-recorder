(() => {
  type EventKind =
    | "page_visit"
    | "user_prompt"
    | "copy_output"
    | "feedback_good"
    | "feedback_bad";

  type CopyTrigger = "selection" | "button_full_reply" | "button_code_block";

  type CopyEventMetadata = {
    site: "chatgpt" | "other";
    messageId?: string;
    charCount: number;
    isCodeLike: boolean;
    languageHint?: string;
    trigger?: CopyTrigger;
  };

  type FeedbackEventMetadata = {
    site: "chatgpt" | "other";
    messageId?: string;
  };

  type EventRecord = {
    type: EventKind;
    site: "chatgpt";
    url: string;
    timestamp: string;
    sessionId: string;
    metadata?: CopyEventMetadata | FeedbackEventMetadata;
  };

  type SessionFlags = {
    [sessionId: string]: {
      humanOverrideRequired?: boolean;
    };
  };

  type SessionMetrics = {
    userMessageCount: number;
    llmMessageCount: number;
  };

  interface SessionSummary {
    userMessageCount: number;
    llmMessageCount: number;
    copyEventsTotal: number;
    approxDurationMs: number;
    feedbackGoodCount: number;
    feedbackBadCount: number;
    outcome: string | null;
    humanOverrideNeeded: boolean | null;
    isPartialHistory: boolean;
  }

  interface InteractionSession {
    sessionId: string;
    sessionEvents: EventRecord[];
    summary: SessionSummary;
  }

  function extractConversationId(url: string | undefined): string | null {
    if (!url) return null;
    try {
      const u = new URL(url);
      if (!u.hostname.includes("chatgpt.com")) return null;

      const match = u.pathname.match(/\/c\/([0-9a-f\-]+)/i);
      if (match && match[1]) {
        return match[1];
      }
      return null;
    } catch {
      return null;
    }
  }

  function isTrivialTabSession(session: InteractionSession): boolean {
    if (!session.sessionId.startsWith("chatgpt-tab-")) return false;
    const s = session.summary;
    const noUser = (s.userMessageCount ?? 0) === 0;
    const noLlm = (s.llmMessageCount ?? 0) === 0;
    const noCopies = (s.copyEventsTotal ?? 0) === 0;
    const noFeedback =
      (s.feedbackGoodCount ?? 0) === 0 &&
      (s.feedbackBadCount ?? 0) === 0;
    return noUser && noLlm && noCopies && noFeedback;
  }

  function downloadJsonFile(filename: string, data: unknown) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function buildServiceRecordJson(): Promise<unknown> {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        ["neaAgoraRecorder", "neaAgoraSessionFlags", "neaAgoraSessionMetrics"],
        (data) => {
          const events: EventRecord[] = Array.isArray(data.neaAgoraRecorder)
            ? (data.neaAgoraRecorder as EventRecord[])
            : [];
          const flags: SessionFlags =
            (data.neaAgoraSessionFlags as SessionFlags) ?? {};
          const metrics: Record<string, SessionMetrics> =
            (data.neaAgoraSessionMetrics as Record<string, SessionMetrics>) ?? {};

          const sessions = buildSessions(events, flags, metrics);
          const sessionsForExport = sessions.filter(
            (session) => !isTrivialTabSession(session)
          );

          const record = {
            recordType: "agent_service_record",
            version: "0.1.0",
            subject: {
              agent: "chatgpt.com",
              surface: "chat",
            },
            observer: {
              tool: "nea-agora-recorder",
              environment: "chrome-extension",
              localOnly: true,
            },
            generatedAt: new Date().toISOString(),
            agentLabel: "chatgpt.com",
            sessions: sessionsForExport.map((session) => ({
              sessionId: session.sessionId,
              platform: "chatgpt",
              startedAt: session.sessionEvents[0]?.timestamp,
              endedAt:
                session.sessionEvents[session.sessionEvents.length - 1]?.timestamp,
              toolLabel: "ChatGPT in Chrome",
              events: session.sessionEvents,
              metrics: {
                llmMessageCount: session.summary.llmMessageCount,
                userMessageCount: session.summary.userMessageCount,
              },
              summary: session.summary,
            })),
          };

          resolve(record);
        }
      );
    });
  }

  async function handleExportClick() {
    const record = await buildServiceRecordJson();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `service_record__chatgpt_${timestamp}.json`;
    downloadJsonFile(filename, record);
  }

  function handleClearClick() {
    const confirmed = window.confirm(
      "This will delete all recorded sessions and events. Are you sure?"
    );
    if (!confirmed) return;

    chrome.storage.local.remove(
      ["neaAgoraRecorder", "neaAgoraSessionFlags", "neaAgoraSessionMetrics"],
      () => {
        if (chrome.runtime.lastError) {
          console.error("Failed to clear records", chrome.runtime.lastError);
        }
        renderLiveView();
      }
    );
  }

  function buildSessions(
    events: EventRecord[],
    flags: SessionFlags,
    metrics: Record<string, SessionMetrics>
  ): InteractionSession[] {
    const byId = new Map<string, EventRecord[]>();

    for (const ev of events) {
      const list = byId.get(ev.sessionId) ?? [];
      list.push(ev);
      byId.set(ev.sessionId, list);
    }

    const sessions: InteractionSession[] = [];

    for (const [sessionId, sessionEvents] of byId.entries()) {
      sessionEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      const first = sessionEvents[0];
      const last = sessionEvents[sessionEvents.length - 1];

      const metricsForSession = metrics[sessionId] ?? {
        userMessageCount: 0,
        llmMessageCount: 0,
      };

      const copyEventsTotal = sessionEvents.filter(
        (e) => e.type === "copy_output"
      ).length;
      const feedbackGoodCount = sessionEvents.filter(
        (e) => e.type === "feedback_good"
      ).length;
      const feedbackBadCount = sessionEvents.filter(
        (e) => e.type === "feedback_bad"
      ).length;
      const isPartialHistory =
        metricsForSession.userMessageCount === 0 &&
        metricsForSession.llmMessageCount >= 5 &&
        (copyEventsTotal > 0 || feedbackGoodCount + feedbackBadCount > 0);

      const approxDurationMs = Math.max(
        0,
        new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime()
      );

      const f = flags[sessionId] ?? {};
      const humanOverrideNeeded = f.humanOverrideRequired ?? null;
      const outcome = humanOverrideNeeded ? "escalated_to_human" : null;

      const summary: SessionSummary = {
        userMessageCount: metricsForSession.userMessageCount,
        llmMessageCount: metricsForSession.llmMessageCount,
        copyEventsTotal,
        feedbackGoodCount,
        feedbackBadCount,
        approxDurationMs,
        outcome,
        humanOverrideNeeded,
        isPartialHistory,
      };

      sessions.push({ sessionId, sessionEvents, summary });
    }

    sessions.sort((a, b) => {
      const aLast = a.sessionEvents[a.sessionEvents.length - 1];
      const bLast = b.sessionEvents[b.sessionEvents.length - 1];
      return bLast.timestamp.localeCompare(aLast.timestamp);
    });

    return sessions;
  }

  function pickCurrentSession(
    sessions: InteractionSession[]
  ): InteractionSession | null {
    if (sessions.length === 0) return null;
    return sessions[0];
  }

  function renderLiveView() {
    const statusEl = document.getElementById("status");
    const headerEl = document.getElementById("session-header");
    const outcomeEl = document.getElementById(
      "live-outcome"
    ) as HTMLDivElement | null;
    const overrideCheckbox = document.getElementById(
      "live-human-override"
    ) as HTMLInputElement | null;
    const listEl = document.getElementById("event-list");

    if (!statusEl || !headerEl || !outcomeEl || !overrideCheckbox || !listEl) {
      return;
    }

    chrome.storage.local.get(
      ["neaAgoraRecorder", "neaAgoraSessionFlags", "neaAgoraSessionMetrics"],
      (data) => {
        const events: EventRecord[] = Array.isArray(data.neaAgoraRecorder)
          ? (data.neaAgoraRecorder as EventRecord[])
          : [];
        const flags: SessionFlags =
          (data.neaAgoraSessionFlags as SessionFlags) ?? {};
        const metrics: Record<string, SessionMetrics> =
          (data.neaAgoraSessionMetrics as Record<string, SessionMetrics>) ?? {};

        if (events.length === 0) {
          statusEl.textContent = "No events yet.";
          headerEl.textContent = "";
          outcomeEl.textContent = "Outcome: Unreviewed";
          overrideCheckbox.checked = false;
          listEl.innerHTML = "";
          return;
        }

        const sessions = buildSessions(events, flags, metrics);

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          let current: InteractionSession | null = null;

          const tab = tabs[0];
          const convId = extractConversationId(tab?.url);
          if (convId) {
            const sessionId = `chatgpt-c-${convId}`;
            current = sessions.find((s) => s.sessionId === sessionId) ?? null;
          }

          if (!current) {
            current = pickCurrentSession(sessions);
          }

          if (!current) {
            statusEl.textContent = "No active session.";
            headerEl.textContent = "";
            outcomeEl.textContent = "Outcome: Unreviewed";
            overrideCheckbox.checked = false;
            listEl.innerHTML = "";
            return;
          }

          const s = current.summary;
          const durationSec = Math.max(
            0,
            Math.round((s.approxDurationMs ?? 0) / 1000)
          );

          statusEl.textContent = `Sessions: ${sessions.length} | Events: ${events.length}`;
          headerEl.textContent =
            `Session ${current.sessionId} ` +
            `(u:${s.userMessageCount} llm:${s.llmMessageCount} copies:${s.copyEventsTotal} ~${durationSec}s)`;

          if (s.isPartialHistory) {
            headerEl.textContent += " [Partial history, joined late]";
          }

          outcomeEl.textContent = `Outcome: ${s.outcome ?? "Unreviewed"}`;
          overrideCheckbox.checked = Boolean(s.humanOverrideNeeded);

          listEl.innerHTML = "";
          for (const ev of current.sessionEvents.slice().reverse()) {
            const li = document.createElement("li");
            li.textContent = `${ev.timestamp} -- ${ev.type}`;
            listEl.appendChild(li);
          }
        });
      }
    );
  }

  function handleOverrideChange(ev: Event) {
    const checkbox = ev.target as HTMLInputElement;
    const checked = checkbox.checked;

    chrome.storage.local.get(
      ["neaAgoraRecorder", "neaAgoraSessionFlags", "neaAgoraSessionMetrics"],
      (data) => {
        const events: EventRecord[] = Array.isArray(data.neaAgoraRecorder)
          ? (data.neaAgoraRecorder as EventRecord[])
          : [];
        const flags: SessionFlags =
          (data.neaAgoraSessionFlags as SessionFlags) ?? {};
        const metrics: Record<string, SessionMetrics> =
          (data.neaAgoraSessionMetrics as Record<string, SessionMetrics>) ?? {};

        if (events.length === 0) return;

        const sessions = buildSessions(events, flags, metrics);
        const current = pickCurrentSession(sessions);
        if (!current) return;

        const sessionId = current.sessionId;
        const currentFlags = flags[sessionId] ?? {};
        currentFlags.humanOverrideRequired = checked;
        flags[sessionId] = currentFlags;

        chrome.storage.local.set({ neaAgoraSessionFlags: flags }, () => {
          renderLiveView();
        });
      }
    );
  }

  document.addEventListener("DOMContentLoaded", () => {
    const overrideCheckbox = document.getElementById(
      "live-human-override"
    ) as HTMLInputElement | null;
    if (overrideCheckbox) {
      overrideCheckbox.addEventListener("change", handleOverrideChange);
    }

    const exportBtn = document.getElementById(
      "export-service-record"
    ) as HTMLButtonElement | null;
    if (exportBtn) {
      exportBtn.addEventListener("click", () => {
        handleExportClick().catch((err) =>
          console.error("Export failed", err)
        );
      });
    }

    const clearBtn = document.getElementById(
      "clear-service-records"
    ) as HTMLButtonElement | null;
    if (clearBtn) {
      clearBtn.addEventListener("click", handleClearClick);
    }

    renderLiveView();

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== "local") return;
      if (
        changes.neaAgoraRecorder ||
        changes.neaAgoraSessionFlags ||
        changes.neaAgoraSessionMetrics
      ) {
        renderLiveView();
      }
    });
  });
})();
