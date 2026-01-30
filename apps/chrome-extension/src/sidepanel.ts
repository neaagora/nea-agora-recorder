(() => {
  type Platform = "chatgpt" | "moltbot_webchat";

  type EventKind =
    | "page_visit"
    | "user_prompt"
    | "llm_response"
    | "copy_output"
    | "feedback_good"
    | "feedback_bad"
    | "feedback_partial";

  type OutcomeValue = "success" | "abandoned" | "escalated_to_human" | null;

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

  type LlmResponseEventMetadata = {
    charCount: number;
    latencyMs?: number;
    turnIndex: number;
  };

  type EventRecord = {
    type: EventKind;
    platform: Platform;
    site: "chatgpt" | "other";
    url: string;
    timestamp: string;
    sessionId: string;
    pageTitle?: string;
    metadata?: CopyEventMetadata | FeedbackEventMetadata | LlmResponseEventMetadata;
    scope?: string;
    sentiment?: "good" | "bad";
    note?: string;
    partial?: boolean;
  };

  type SessionFlags = {
    [sessionId: string]: {
      humanOverrideRequired?: boolean;
      outcome?: OutcomeValue;
      title?: string;
    };
  };

  type SessionMetrics = {
    userMessageCount: number;
    llmMessageCount: number;
    avgResponseTimeMs?: number;
    p95ResponseTimeMs?: number;
    maxResponseTimeMs?: number;
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
    responseMetrics?: {
      avgResponseTimeMs?: number;
      p95ResponseTimeMs?: number;
      maxResponseTimeMs?: number;
    };
    title?: string | null;
  }

  interface InteractionSession {
    sessionId: string;
    sessionEvents: EventRecord[];
    platform: Platform;
    metrics: SessionMetrics;
    summary: SessionSummary;
  }

  let selectedSessionId: string | null = null;

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

  function extractMoltbotSessionId(url: string | undefined): string | null {
    if (!url) return null;
    try {
      const u = new URL(url);
      if (
        u.host !== "localhost:18789" &&
        u.host !== "127.0.0.1:18789"
      ) {
        return null;
      }
      const sessionParam = u.searchParams.get("session");
      return sessionParam ? sessionParam.trim() : null;
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

  function computeResponseMetrics(events: EventRecord[]) {
    const latencies = events
      .filter((e) => e.type === "llm_response")
      .map((e) => (e.metadata as LlmResponseEventMetadata | undefined)?.latencyMs)
      .filter((v): v is number => typeof v === "number");

    let avgResponseTimeMs: number | undefined;
    let p95ResponseTimeMs: number | undefined;
    let maxResponseTimeMs: number | undefined;

    if (latencies.length) {
      const sorted = [...latencies].sort((a, b) => a - b);
      const sum = latencies.reduce((a, b) => a + b, 0);
      avgResponseTimeMs = sum / latencies.length;
      maxResponseTimeMs = sorted[sorted.length - 1];
      const p95Index = Math.floor(0.95 * (sorted.length - 1));
      p95ResponseTimeMs = sorted[p95Index];
    }

    return { avgResponseTimeMs, p95ResponseTimeMs, maxResponseTimeMs };
  }

  function computeMessageCounts(events: EventRecord[]) {
    let userMessageCount = 0;
    let llmMessageCount = 0;

    for (const ev of events) {
      if (ev.type === "user_prompt") userMessageCount += 1;
      if (ev.type === "llm_response") llmMessageCount += 1;
    }

    return { userMessageCount, llmMessageCount };
  }

  function deriveSessionTitle(
    session: Pick<InteractionSession, "sessionId" | "platform">,
    events: EventRecord[],
    storedTitle?: string | null
  ): string {
    if (storedTitle && storedTitle.trim().length > 0) {
      return storedTitle.trim();
    }
    const lastPageVisit = [...events]
      .reverse()
      .find((e) => e.type === "page_visit");

    if (lastPageVisit) {
      const rawTitle =
        (lastPageVisit as EventRecord).pageTitle ??
        (lastPageVisit as any).title ??
        (lastPageVisit as any).metadata?.pageTitle ??
        (lastPageVisit as any).metadata?.title;
      if (typeof rawTitle === "string" && rawTitle.trim().length > 0) {
        return rawTitle.trim();
      }
    }

    if (session.platform === "chatgpt") {
      return "ChatGPT";
    }
    if (session.platform === "moltbot_webchat") {
      return "MoltBot WebChat";
    }

    return session.sessionId;
  }

  function formatMs(ms: number | undefined) {
    if (ms == null || !Number.isFinite(ms)) return "";
    if (ms >= 1000) {
      return `${(ms / 1000).toFixed(1)} s`;
    }
    return `${Math.round(ms)} ms`;
  }

  function formatPlatform(platform: Platform) {
    return platform === "moltbot_webchat" ? "MoltBot (local)" : "ChatGPT";
  }

  function formatPlatformShort(platform: Platform) {
    return platform === "moltbot_webchat" ? "MoltBot" : "ChatGPT";
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
          const shouldKeepSession = (session: InteractionSession): boolean => {
            const m = session.metrics ?? {};
            const hasMessages =
              (m.userMessageCount ?? 0) > 0 || (m.llmMessageCount ?? 0) > 0;
            if (hasMessages) return true;
            return session.sessionEvents.some((e) => e.type !== "page_visit");
          };

          const sessionsForExport = sessions
            .filter((session) => !isTrivialTabSession(session))
            .filter(shouldKeepSession);

          const record = {
            recordType: "agent_service_record",
            version: "0.1.0",
            subject: {
              agent: "multi",
              surface: "chat",
            },
            observer: {
              tool: "nea-agora-recorder",
              environment: "chrome-extension",
              localOnly: true,
            },
            generatedAt: new Date().toISOString(),
            agentLabel: "multi",
            sessions: sessionsForExport.map((session) => ({
              sessionId: session.sessionId,
              platform: session.platform,
              startedAt: session.sessionEvents[0]?.timestamp,
              endedAt:
                session.sessionEvents[session.sessionEvents.length - 1]?.timestamp,
              toolLabel:
                session.platform === "moltbot_webchat"
                  ? "MoltBot (local)"
                  : "ChatGPT in Chrome",
              events: session.sessionEvents,
              metrics: session.metrics,
              summary: session.summary,
            })),
          };

          resolve(record);
        }
      );
    });
  }

  function appendScopedFeedbackEvent(
    sessionId: string,
    platform: Platform,
    url: string,
    sentiment: "good" | "bad",
    scope: string,
    note: string
  ) {
    chrome.storage.local.get(
      ["neaAgoraRecorder"],
      (data) => {
        const events: EventRecord[] = Array.isArray(data.neaAgoraRecorder)
          ? (data.neaAgoraRecorder as EventRecord[])
          : [];
        const now = new Date().toISOString();

        const event: EventRecord = {
          type: "feedback_partial",
          platform,
          site: platform === "chatgpt" ? "chatgpt" : "other",
          url,
          timestamp: now,
          sessionId,
          scope,
          sentiment,
          note: note || undefined,
          partial: true,
        };

        events.push(event);

        chrome.storage.local.set({ neaAgoraRecorder: events }, () => {
          renderLiveView();
        });
      }
    );
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
      if (sessionId.startsWith("chatgpt-tab-")) {
        continue;
      }

      sessionEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      const first = sessionEvents[0];
      const last = sessionEvents[sessionEvents.length - 1];

      const messageCounts = computeMessageCounts(sessionEvents);
      const metricsForSession = {
        ...(metrics[sessionId] ?? {}),
        ...messageCounts,
      };
      const responseMetrics = computeResponseMetrics(sessionEvents);
      const sessionMetrics: SessionMetrics = {
        ...metricsForSession,
        ...responseMetrics,
      };
      const platform =
        sessionEvents.find((ev) => ev.platform)?.platform ?? "chatgpt";

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
      const outcome = f.outcome ?? (humanOverrideNeeded ? "escalated_to_human" : null);
      const storedTitle = (f.title as string | undefined) ?? null;
      const title = deriveSessionTitle(
        { sessionId, platform },
        sessionEvents,
        storedTitle
      );

      const summary: SessionSummary = {
        userMessageCount: messageCounts.userMessageCount,
        llmMessageCount: messageCounts.llmMessageCount,
        copyEventsTotal,
        feedbackGoodCount,
        feedbackBadCount,
        approxDurationMs,
        outcome,
        humanOverrideNeeded,
        isPartialHistory,
        responseMetrics,
        title,
      };

      sessions.push({ sessionId, sessionEvents, summary, platform, metrics: sessionMetrics });
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
    const outcomeSelect = document.getElementById(
      "live-outcome-select"
    ) as HTMLSelectElement | null;
    const overrideCheckbox = document.getElementById(
      "live-human-override"
    ) as HTMLInputElement | null;
    const listEl = document.getElementById("event-list");
    const sessionListEl = document.getElementById("session-list");
    const weeklyTitle = document.getElementById("weekly-title");
    const weeklyMeta = document.getElementById("weekly-meta");
    const weeklySuccess = document.getElementById("weekly-success");
    const weeklyAbandoned = document.getElementById("weekly-abandoned");
    const weeklyEscalated = document.getElementById("weekly-escalated");

    if (!statusEl || !headerEl || !overrideCheckbox || !listEl) {
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
          if (outcomeSelect) {
            outcomeSelect.value = "";
          }
          overrideCheckbox.checked = false;
          listEl.innerHTML = "";
          if (
            weeklyTitle &&
            weeklyMeta &&
            weeklySuccess &&
            weeklyAbandoned &&
            weeklyEscalated
          ) {
            weeklyTitle.textContent = "This week";
            weeklySuccess.textContent = "✓ Success: 0%";
            weeklyAbandoned.textContent = "⛔ Abandoned: 0%";
            weeklyEscalated.textContent = "🧑‍💻 Escalated: 0%";
            weeklyMeta.textContent = "Sessions recorded: 0 - Platforms: -";
          }
          return;
        }

        const sessions = buildSessions(events, flags, metrics);

        // Weekly outcome summary (last 7 days, ignore partial history)
        const now = Date.now();
        const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

        const weeklySessions = sessions.filter((session) => {
          if (session.summary.isPartialHistory) return false;
          const first = session.sessionEvents[0];
          if (!first) return false;
          const startedAtMs = new Date(first.timestamp).getTime();
          if (!Number.isFinite(startedAtMs)) return false;
          return now - startedAtMs <= sevenDaysMs;
        });

        const totalWeekly = weeklySessions.length;

        const countByOutcome = {
          success: 0,
          abandoned: 0,
          escalated_to_human: 0,
        } as Record<"success" | "abandoned" | "escalated_to_human", number>;

        for (const session of weeklySessions) {
          const outcome = (session.summary.outcome ?? null) as
            | "success"
            | "abandoned"
            | "escalated_to_human"
            | null;
          if (!outcome) continue;
          if (countByOutcome[outcome] !== undefined) {
            countByOutcome[outcome] += 1;
          }
        }

        if (
          weeklyTitle &&
          weeklyMeta &&
          weeklySuccess &&
          weeklyAbandoned &&
          weeklyEscalated
        ) {
          const total = totalWeekly;
          const pct = (n: number) =>
            total === 0 ? 0 : Math.round((n / total) * 100);
          const platformLabels = Array.from(
            new Set(weeklySessions.map((session) => formatPlatform(session.platform)))
          );
          const platformLabelText =
            platformLabels.length > 0 ? platformLabels.join(", ") : "-";

          weeklyTitle.textContent = "This week";
          weeklySuccess.textContent = `✓ Success: ${pct(countByOutcome.success)}%`;
          weeklyAbandoned.textContent = `⛔ Abandoned: ${pct(countByOutcome.abandoned)}%`;
          weeklyEscalated.textContent = `🧑‍💻 Escalated: ${pct(countByOutcome.escalated_to_human)}%`;
          weeklyMeta.textContent = `Sessions recorded: ${total} - Platforms: ${platformLabelText}`;
        }

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          const tab = tabs[0];
          const convId = extractConversationId(tab?.url);
          const moltbotSession = extractMoltbotSessionId(tab?.url);
          const activeSessionId = convId
            ? `chatgpt-c-${convId}`
            : moltbotSession
            ? `moltbot-s-${moltbotSession}`
            : null;

          let current: InteractionSession | null = null;

          if (selectedSessionId) {
            current = sessions.find((s) => s.sessionId === selectedSessionId) ?? null;
          }

          if (!current && activeSessionId) {
            current = sessions.find((s) => s.sessionId === activeSessionId) ?? null;
          }

          if (!current) {
            current = pickCurrentSession(sessions);
          }

          if (!current) {
            statusEl.textContent = "No active session.";
            headerEl.textContent = "";
            if (outcomeSelect) {
              outcomeSelect.value = "";
            }
            overrideCheckbox.checked = false;
            listEl.innerHTML = "";
            if (sessionListEl) {
              sessionListEl.innerHTML = "";
            }
            return;
          }

          if (!selectedSessionId) {
            selectedSessionId = current.sessionId;
          }

          if (sessionListEl) {
            sessionListEl.innerHTML = "";
            const sessionsForList = sessions;
            for (const sObj of sessionsForList) {
              const s = sObj.summary;
              const row = document.createElement("div");
              row.className = "session-row";
              if (sObj.sessionId === current.sessionId) {
                row.classList.add("active");
              }
              row.dataset.sessionId = sObj.sessionId;

              const titleSpan = document.createElement("div");
              titleSpan.className = "session-row-title";
              const title =
                s.title && s.title.trim().length > 0 ? s.title : sObj.sessionId;
              titleSpan.textContent = title;

              const metaSpan = document.createElement("div");
              metaSpan.className = "session-row-meta";

              const outcomeLabel =
                s.outcome === "success"
                  ? "✓"
                  : s.outcome === "abandoned"
                  ? "⛔"
                  : s.outcome === "escalated_to_human"
                  ? "🧑‍💻"
                  : "-";
              const platformLabel = formatPlatformShort(sObj.platform);

              metaSpan.textContent =
                `${platformLabel} ${outcomeLabel} u:${s.userMessageCount} ` +
                `llm:${s.llmMessageCount} ` +
                `c:${s.copyEventsTotal}`;

              row.appendChild(titleSpan);
              row.appendChild(metaSpan);

              row.addEventListener("click", () => {
                selectedSessionId = sObj.sessionId;
                renderLiveView();
              });

              sessionListEl.appendChild(row);
            }
          }

          const s = current.summary;
          const durationSec = Math.max(
            0,
            Math.round((s.approxDurationMs ?? 0) / 1000)
          );
          const platformLabel = formatPlatform(current.platform);
          const responseMetrics = s.responseMetrics;
          let responseLabel = "";
          if (responseMetrics?.avgResponseTimeMs != null) {
            responseLabel = ` • Avg response ${formatMs(responseMetrics.avgResponseTimeMs)}`;
            if (responseMetrics.p95ResponseTimeMs != null) {
              responseLabel += ` - p95 ${formatMs(responseMetrics.p95ResponseTimeMs)}`;
            }
            if (responseMetrics.maxResponseTimeMs != null) {
              responseLabel += ` - max ${formatMs(responseMetrics.maxResponseTimeMs)}`;
            }
          }

          statusEl.textContent = `Sessions: ${sessions.length} | Events: ${events.length}`;
          const displayTitle =
            s.title && s.title.trim().length > 0 ? s.title : current.sessionId;
          headerEl.textContent =
            `${displayTitle} ` +
            `(u:${s.userMessageCount} llm:${s.llmMessageCount} copies:${s.copyEventsTotal} ~${durationSec}s)` +
            ` • ${platformLabel}` +
            responseLabel;

          if (s.isPartialHistory) {
            headerEl.textContent += " [Partial history, joined late]";
          }

          if (outcomeSelect) {
            outcomeSelect.value = s.outcome ?? "";
          }
          overrideCheckbox.checked = Boolean(s.humanOverrideNeeded);

          listEl.innerHTML = "";
          for (const ev of current.sessionEvents.slice().reverse()) {
            const li = document.createElement("li");
            let label = `${ev.timestamp}  ${ev.type}`;
            if (ev.partial && ev.scope) {
              label += ` [scoped:${ev.scope}`;
              if (ev.sentiment) {
                label += ` ${ev.sentiment}`;
              }
              label += "]";
            }
            li.textContent = label;
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

  function handleOutcomeChange(ev: Event) {
    const select = ev.target as HTMLSelectElement;
    const value = select.value as "" | "success" | "abandoned" | "escalated_to_human";
    const newOutcome: OutcomeValue = value === "" ? null : value;

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

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          let current: InteractionSession | null = null;

          const tab = tabs[0];
          const convId = extractConversationId(tab?.url);
          const moltbotSession = extractMoltbotSessionId(tab?.url);
          if (convId) {
            const sessionId = `chatgpt-c-${convId}`;
            current = sessions.find((session) => session.sessionId === sessionId) ?? null;
          } else if (moltbotSession) {
            const sessionId = `moltbot-s-${moltbotSession}`;
            current = sessions.find((session) => session.sessionId === sessionId) ?? null;
          }
          if (!current) {
            current = pickCurrentSession(sessions);
          }
          if (!current) return;

          const sessionId = current.sessionId;
          const currentFlags = flags[sessionId] ?? {};
          currentFlags.outcome = newOutcome;
          flags[sessionId] = currentFlags;

          chrome.storage.local.set({ neaAgoraSessionFlags: flags }, () => {
            renderLiveView();
          });
        });
      }
    );
  }

  function handleScopedAddClick() {
    const scopeSelect = document.getElementById(
      "scoped-scope"
    ) as HTMLSelectElement | null;
    const noteInput = document.getElementById(
      "scoped-note"
    ) as HTMLInputElement | null;
    const sentimentInputs = Array.from(
      document.querySelectorAll<HTMLInputElement>('input[name="scoped-sentiment"]')
    );

    if (!scopeSelect || !noteInput || sentimentInputs.length === 0) {
      return;
    }

    const selectedSentiment = sentimentInputs.find((input) => input.checked)
      ?.value as "good" | "bad" | undefined;
    const scope = scopeSelect.value || "other";
    const note = noteInput.value.trim();

    if (!selectedSentiment) {
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

        if (events.length === 0) return;

        const sessions = buildSessions(events, flags, metrics);

        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          let current: InteractionSession | null = null;

          const tab = tabs[0];
          const convId = extractConversationId(tab?.url);
          const moltbotSession = extractMoltbotSessionId(tab?.url);
          if (convId) {
            const sessionId = `chatgpt-c-${convId}`;
            current = sessions.find((session) => session.sessionId === sessionId) ?? null;
          } else if (moltbotSession) {
            const sessionId = `moltbot-s-${moltbotSession}`;
            current = sessions.find((session) => session.sessionId === sessionId) ?? null;
          }
          if (!current) {
            current = pickCurrentSession(sessions);
          }
          if (!current) return;

          appendScopedFeedbackEvent(
            current.sessionId,
            current.platform,
            tab?.url ?? "",
            selectedSentiment,
            scope,
            note
          );
          noteInput.value = "";
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

    const outcomeSelect = document.getElementById(
      "live-outcome-select"
    ) as HTMLSelectElement | null;
    if (outcomeSelect) {
      outcomeSelect.addEventListener("change", handleOutcomeChange);
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

    const scopedAddBtn = document.getElementById(
      "scoped-add"
    ) as HTMLButtonElement | null;
    if (scopedAddBtn) {
      scopedAddBtn.addEventListener("click", handleScopedAddClick);
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
