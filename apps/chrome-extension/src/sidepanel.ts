(() => {
  type Platform = "chatgpt" | "moltbot_webchat" | "claude_web" | "gemini_web";

  type SessionIntent =
    | "quick_lookup"
    | "coding"
    | "writing"
    | "research"
    | "creative"
    | "other";

  type IntentSource = "auto" | "user";

  type EventKind =
    | "page_visit"
    | "user_prompt"
    | "llm_response"
    | "copy_output"
    | "feedback_good"
    | "feedback_bad"
    | "thumbs_up"
    | "thumbs_down"
    | "diagnostic"
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
    model?: string;
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
      intent?: SessionIntent;
      intentSource?: IntentSource;
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
    modelsUsed?: string[];
    intent?: SessionIntent;
    intentSource?: IntentSource;
  }

  interface InteractionSession {
    sessionId: string;
    sessionEvents: EventRecord[];
    platform: Platform;
    metrics: SessionMetrics;
    summary: SessionSummary;
  }

  type TrustRiskFlag =
    | "non_convergence"
    | "verbosity_adoption_mismatch"
    | "lookup_synthesis_mismatch"
    | "ungrounded_confidence";

  type TrustRiskSeverity = "low" | "medium" | "high";

  interface TrustRiskAssessment {
    flag: TrustRiskFlag;
    severity: TrustRiskSeverity;
    message: string;
    intent: SessionIntent | null;
    estimatedTokens: number;
  }

  // In-memory only: avoid repeating trust warnings while sidepanel is open.
  const trustWarningShownForSession = new Map<string, TrustRiskFlag>();

  type DomDiagnosticReport = {
    platform: string;
    url: string;
    observerAttached: boolean;
    modelLabel: string | null;
  };

  let latestDomDiagnostic: DomDiagnosticReport | null = null;

  let selectedSessionId: string | null = null;
  let lastActiveTabUrl: string | null = null;

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

  function extractClaudeChatId(url: string | undefined): string | null {
    if (!url) return null;
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

  function extractGeminiAppId(url: string | undefined): string | null {
    if (!url) return null;
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

  function buildSessionUrl(sessionId: string): string | null {
    if (sessionId.startsWith("chatgpt-c-")) {
      const id = sessionId.replace("chatgpt-c-", "");
      return `https://chatgpt.com/c/${id}`;
    }
    if (sessionId.startsWith("claude-chat-")) {
      const id = sessionId.replace("claude-chat-", "");
      return `https://claude.ai/chat/${id}`;
    }
    if (sessionId.startsWith("gemini-app-")) {
      const id = sessionId.replace("gemini-app-", "");
      return `https://gemini.google.com/app/${id}`;
    }
    if (sessionId.startsWith("moltbot-s-")) {
      const id = sessionId.replace("moltbot-s-", "");
      return `http://localhost:18789/?session=${encodeURIComponent(id)}`;
    }
    return null;
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

  function buildSummaryRecord(record: any): any {
    if (!record || !Array.isArray(record.sessions)) return record;
    return {
      ...record,
      sessions: record.sessions.map((session: any) => {
        if (!session || typeof session !== "object") return session;
        const { events, ...rest } = session as Record<string, unknown>;
        return { ...rest };
      }),
    };
  }

  function inferSessionIntent(
    summary: SessionSummary,
    platform: Platform
  ): SessionIntent {
    const user = summary.userMessageCount ?? 0;
    const llm = summary.llmMessageCount ?? 0;
    const copies = summary.copyEventsTotal ?? 0;
    const durationSeconds = Math.max(
      0,
      Math.round((summary.approxDurationMs ?? 0) / 1000)
    );

    if (user <= 3 && durationSeconds <= 10 * 60 && copies >= 1) {
      return "quick_lookup";
    }

    if ((user >= 5 && copies >= 3) || platform === "moltbot_webchat") {
      return "coding";
    }

    if (user >= 5 && durationSeconds >= 20 * 60) {
      return "research";
    }

    if (durationSeconds >= 10 * 60 && copies >= 2) {
      return "writing";
    }

    if (user >= 8 && copies <= user) {
      return "creative";
    }

    return "other";
  }

  function getSessionInsights(summary: SessionSummary): string[] {
    const intent = summary.intent ?? "other";
    const user = summary.userMessageCount ?? 0;
    const llm = summary.llmMessageCount ?? 0;
    const copies = summary.copyEventsTotal ?? 0;
    const durationSeconds = Math.max(
      0,
      Math.round((summary.approxDurationMs ?? 0) / 1000)
    );
    const escalated = summary.humanOverrideNeeded ?? false;

    const insights: string[] = [];

    const longSessionThresholdSeconds = 8 * 60 * 60;
    const mediumSessionThresholdSeconds = 2 * 60 * 60;
    if (durationSeconds > longSessionThresholdSeconds) {
      insights.push(
        "This was a very long-running session. Long sessions often benefit from explicit checkpoints or periodic resets to avoid drift."
      );
    } else if (
      durationSeconds > mediumSessionThresholdSeconds &&
      durationSeconds <= longSessionThresholdSeconds
    ) {
      insights.push(
        "This session ran for quite a while. Next time, consider pausing to summarize what you have so far before continuing."
      );
    }

    if (llm >= user * 10 && copies < user + 2) {
      insights.push(
        "The assistant produced a lot of output relative to what you reused. You may want to ask for shorter or more structured responses, or provide a concrete example of what you need."
      );
    }

    if (intent === "quick_lookup") {
      if (user <= 3 && durationSeconds <= 10 * 60) {
        insights.push("Lookup session completed quickly. No changes suggested.");
      } else {
        insights.push(
          "This lookup session took longer than typical. Next time, try a more direct question or switch models earlier if you are not satisfied after a few replies."
        );
      }
    }

    if (intent === "coding") {
      if (user >= 15 || llm >= 30) {
        insights.push(
          "High iteration count for coding. You may benefit from breaking the task into smaller steps or asking for a step-by-step plan instead of a full solution at once."
        );
      }
      if (copies === 0) {
        insights.push(
          "No outputs were copied from this coding session. That often means responses were not directly usable; consider trying a different model earlier when this happens."
        );
      }
      if (escalated) {
        insights.push(
          "This coding session needed manual intervention. You might want to capture a reusable prompt or checklist for this type of task."
        );
      }
      if (!insights.some((line) => line.includes("coding session"))) {
        insights.push(
          "Coding sessions often go better when constraints are clear. If you felt stuck, try asking the assistant to restate the requirements or outline a plan before writing code."
        );
      }
    }

    if (intent === "writing") {
      if (durationSeconds >= 60 * 60 && copies < 2) {
        insights.push(
          "Long writing/editing session with few copied results. Next time, try asking for outlines or smaller sections instead of full drafts each time."
        );
      }
      if (!insights.some((line) => line.includes("writing"))) {
        insights.push(
          "For writing and editing, it can help to ask for outlines or small sections instead of full drafts. That often leads to faster convergence."
        );
      }
    }

    if (intent === "research") {
      if (durationSeconds >= 30 * 60 && copies === 0) {
        insights.push(
          "Extended research session without copying any results. Consider bookmarking or summarizing key findings as you go."
        );
      }
      if (!insights.some((line) => line.includes("research"))) {
        insights.push(
          "For research sessions, it usually helps to periodically summarize what you have learned so far, or ask the assistant to create a short summary of key points."
        );
      }
    }

    if (intent === "creative") {
      insights.push(
        "High iteration is normal for creative work. No action suggested unless you felt stuck or frustrated."
      );
    }

    if (insights.length === 0) {
      insights.push(
        "This session does not match a common efficiency pattern. Treat it as exploratory and rely on your own judgment."
      );
    }

    const maxInsights = 3;
    if (insights.length > maxInsights) {
      return insights.slice(0, maxInsights);
    }

    return insights;
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
    if (session.platform === "claude_web") {
      return "Claude";
    }
    if (session.platform === "gemini_web") {
      return "Gemini";
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

  function formatDuration(seconds: number): string {
    if (!seconds || seconds <= 0) return "—";

    const totalMinutes = Math.floor(seconds / 60);
    const minutes = totalMinutes % 60;
    const totalHours = Math.floor(totalMinutes / 60);
    const hours = totalHours % 24;
    const days = Math.floor(totalHours / 24);

    if (days > 0) {
      return `${days} d ${hours} h ${minutes} min`;
    }

    if (totalHours > 0) {
      return `${totalHours} h ${minutes} min`;
    }

    return `${totalMinutes} min`;
  }

  function formatSessionTitle(session: InteractionSession): string {
    const title = session.summary?.title || session.sessionId || "(untitled)";
    if (!title) return "(untitled)";
    return title.length > 60 ? `${title.slice(0, 57)}...` : title;
  }

  function formatPlatform(platform: Platform) {
    if (platform === "moltbot_webchat") return "MoltBot (local)";
    if (platform === "claude_web") return "Claude";
    if (platform === "gemini_web") return "Gemini";
    if (platform === "chatgpt") return "ChatGPT";
    return "Unknown";
  }

  function formatPlatformShort(platform: Platform) {
    if (platform === "moltbot_webchat") return "MoltBot";
    if (platform === "claude_web") return "Claude";
    if (platform === "gemini_web") return "Gemini";
    if (platform === "chatgpt") return "ChatGPT";
    return "Unknown";
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

          const sessions = buildSessions(events, flags, metrics).filter(
            (session) => !isTrivialSession(session.summary)
          );
          const shouldKeepSession = (session: InteractionSession): boolean => {
            const m = session.metrics ?? {};
            const hasMessages =
              (m.userMessageCount ?? 0) > 0 || (m.llmMessageCount ?? 0) > 0;
            if (hasMessages) return true;
            return session.sessionEvents.some((e) => e.type !== "page_visit");
          };

          const sessionsForExport = sessions
            .filter((session) => !isTrivialTabSession(session))
            .filter(shouldKeepSession)
            .filter((session) => !isTrivialSession(session.summary));

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
                  : session.platform === "claude_web"
                  ? "Claude in Chrome"
                  : session.platform === "gemini_web"
                  ? "Gemini in Chrome"
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
    const filename = `service_record__${timestamp}.json`;
    downloadJsonFile(filename, record);
  }

  async function handleExportSummaryClick() {
    const record = await buildServiceRecordJson();
    const summaryRecord = buildSummaryRecord(record);
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `service_record__${timestamp}__summary.json`;
    downloadJsonFile(filename, summaryRecord);
  }

  function handleOpenSessionClick() {
    if (!selectedSessionId) return;
    const url = buildSessionUrl(selectedSessionId);
    if (!url) return;
    chrome.tabs.create({ url });
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
        (e) => e.type === "feedback_good" || e.type === "thumbs_up"
      ).length;
      const feedbackBadCount = sessionEvents.filter(
        (e) => e.type === "feedback_bad" || e.type === "thumbs_down"
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
      const modelsUsed = Array.from(
        new Set(
          sessionEvents
            .map((ev) => ev.model)
            .filter((model): model is string => Boolean(model && model.trim()))
        )
      );
      if (modelsUsed.length) {
        summary.modelsUsed = modelsUsed;
      }
      if (f.intent) {
        summary.intent = f.intent;
        summary.intentSource = f.intentSource ?? "user";
      }
      if (!summary.intent) {
        summary.intent = inferSessionIntent(summary, platform);
        summary.intentSource = "auto";
      }

      sessions.push({ sessionId, sessionEvents, summary, platform, metrics: sessionMetrics });
    }

    sessions.sort((a, b) => {
      const aLast = a.sessionEvents[a.sessionEvents.length - 1];
      const bLast = b.sessionEvents[b.sessionEvents.length - 1];
      return bLast.timestamp.localeCompare(aLast.timestamp);
    });

    return sessions;
  }

  function isTrivialSession(summary: SessionSummary): boolean {
    const user = summary.userMessageCount ?? 0;
    const llm = summary.llmMessageCount ?? 0;
    const copies = summary.copyEventsTotal ?? 0;
    const good = summary.feedbackGoodCount ?? 0;
    const bad = summary.feedbackBadCount ?? 0;
    return user === 0 && llm === 0 && copies === 0 && good === 0 && bad === 0;
  }

  function pickCurrentSession(
    sessions: InteractionSession[]
  ): InteractionSession | null {
    if (sessions.length === 0) return null;
    return sessions[0];
  }

  function estimateTokensForSession(sessionEvents: EventRecord[]): number {
    let charTotal = 0;

    for (const ev of sessionEvents) {
      if (ev.type !== "llm_response") continue;
      const meta = ev.metadata as LlmResponseEventMetadata | undefined;
      if (!meta) continue;
      const count = typeof meta.charCount === "number" ? meta.charCount : 0;
      charTotal += count;
    }

    // Behavior-only estimate. No text parsing.
    return Math.round(charTotal / 4); // rough 4 chars per token
  }

  function computeAdoptionSignals(
    session: InteractionSession,
    llmMsgs: number
  ): {
    adoptionRatio: number;
    copiesRecent: boolean;
    totalCopies: number;
  } {
    const s = session.summary;
    const totalCopies = s.copyEventsTotal ?? 0;

    // Simple adoption ratio: how many copies per LLM message
    const adoptionRatio = llmMsgs > 0 ? totalCopies / llmMsgs : 0;

    // Recency heuristic: did user copy something in the last few events
    let lastCopyIndex = -1;
    const events = session.sessionEvents ?? [];
    for (let i = 0; i < events.length; i++) {
      const ev = events[i];
      if (!ev || typeof ev.type !== "string") continue;
      if (ev.type === "copy_output") {
        lastCopyIndex = i;
      }
    }

    const copiesRecent = lastCopyIndex >= 0 && lastCopyIndex >= events.length - 3;

    return {
      adoptionRatio,
      copiesRecent,
      totalCopies,
    };
  }

  type FeedbackPolarity = "good" | "bad";

  function computeRecentFeedback(
    session: InteractionSession
  ): {
    recentGood: number;
    recentBad: number;
    lastRating: FeedbackPolarity | null;
  } {
    const events = session.sessionEvents ?? [];
    const windowSize = 6; // last few events
    const startIdx = Math.max(0, events.length - windowSize);

    let recentGood = 0;
    let recentBad = 0;
    let lastRating: FeedbackPolarity | null = null;

    for (let i = startIdx; i < events.length; i++) {
      const ev = events[i];
      if (!ev || typeof ev.type !== "string") continue;

      if (ev.type === "feedback_good" || ev.type === "thumbs_up") {
        recentGood += 1;
        lastRating = "good";
      } else if (ev.type === "feedback_bad" || ev.type === "thumbs_down") {
        recentBad += 1;
        lastRating = "bad";
      }
    }

    return { recentGood, recentBad, lastRating };
  }

  function computeTrustRiskAssessment(
    session: InteractionSession
  ): TrustRiskAssessment | null {
    const summary = session.summary;
    const metrics = session.metrics ?? ({} as SessionMetrics);

    const userMsgs = summary.userMessageCount ?? metrics.userMessageCount ?? 0;
    const llmMsgs = summary.llmMessageCount ?? metrics.llmMessageCount ?? 0;
    const copies = summary.copyEventsTotal ?? 0;
    const good = summary.feedbackGoodCount ?? 0;
    const bad = summary.feedbackBadCount ?? 0;
    const intent: SessionIntent | null = summary.intent ?? null;
    const durationMs = summary.approxDurationMs ?? 0;
    const durationSeconds = durationMs > 0 ? Math.round(durationMs / 1000) : 0;
    const outcome = summary.outcome ?? null;
    const humanOverride = summary.humanOverrideNeeded === true;

    const estimatedTokens = estimateTokensForSession(session.sessionEvents);
    const adoption = computeAdoptionSignals(session, llmMsgs);
    const feedback = computeRecentFeedback(session);

    // Ignore trivial sessions and very short interactions.
    if (
      (userMsgs + llmMsgs) <= 2 ||
      estimatedTokens < 100 || // ~25 tokens
      durationSeconds < 30
    ) {
      return null;
    }

    console.log("[TrustGovernor] session metrics", {
      sessionId: session.sessionId,
      userMsgs,
      llmMsgs,
      copies,
      good,
      bad,
      durationSeconds,
      estimatedTokens,
      intent,
      adoptionRatio: adoption.adoptionRatio,
      copiesRecent: adoption.copiesRecent,
      totalCopies: adoption.totalCopies,
      recentGood: feedback.recentGood,
      recentBad: feedback.recentBad,
      lastRating: feedback.lastRating,
    });

    // If we already warned for this session, stay quiet.
    if (trustWarningShownForSession.has(session.sessionId)) {
      return null;
    }

    // Flag 1: non-convergence
    const hasNonConvergencePattern =
      userMsgs >= 3 &&
      llmMsgs >= 3 &&
      durationSeconds >= 5 * 60 &&
      // recent struggle: at least one recent bad or explicit override
      (feedback.recentBad >= 1 || humanOverride) &&
      // low overall adoption relative to how much the model talked
      adoption.adoptionRatio < 0.25 &&
      // no reuse or likes in the last few events
      !adoption.copiesRecent &&
      feedback.lastRating !== "good" &&
      // either long-ish session or multiple recent bads
      (estimatedTokens >= 400 || feedback.recentBad >= 2);

    if (hasNonConvergencePattern) {
      const message =
        "Trust warning: this answer is being refined a lot without settling. Treat it as unstable.";

      trustWarningShownForSession.set(session.sessionId, "non_convergence");
      return {
        flag: "non_convergence",
        severity: "high",
        message,
        intent,
        estimatedTokens,
      };
    }

    // Flag 2: verbosity–adoption mismatch
    const hasVerbosityAdoptionMismatch =
      estimatedTokens >= 2500 &&
      llmMsgs >= 4 &&
      adoption.adoptionRatio < 0.3 && // mostly unused
      feedback.recentBad === 0 &&
      !humanOverride &&
      !outcome; // no explicit outcome yet

    if (hasVerbosityAdoptionMismatch) {
      const message =
        "Trust warning: long, fluent answers with little reuse. Confidence may exceed reliability.";

      trustWarningShownForSession.set(
        session.sessionId,
        "verbosity_adoption_mismatch"
      );
      return {
        flag: "verbosity_adoption_mismatch",
        severity: "medium",
        message,
        intent,
        estimatedTokens,
      };
    }

    // Flag 3: lookup–synthesis mismatch
    const isLookupIntent =
      intent === "quick_lookup" ||
      (intent === "other" && durationSeconds < 5 * 60 && userMsgs <= 3);

    const hasLookupSynthesisMismatch =
      isLookupIntent &&
      estimatedTokens >= 800 &&
      llmMsgs >= 3 &&
      feedback.recentBad >= 1 &&
      adoption.adoptionRatio < 0.2; // almost no reuse

    if (hasLookupSynthesisMismatch) {
      const message =
        "Trust warning: this behaves like a lookup but the model is synthesizing a lot. Verify facts with another source.";

      trustWarningShownForSession.set(
        session.sessionId,
        "lookup_synthesis_mismatch"
      );
      return {
        flag: "lookup_synthesis_mismatch",
        severity: "medium",
        message,
        intent,
        estimatedTokens,
      };
    }

    // Flag 4: ungrounded confidence
    const hasUngroundedConfidence =
      // long session
      estimatedTokens >= 1500 &&
      // no externalization
      adoption.adoptionRatio < 0.25 &&
      // user seems satisfied or at least not pushing back
      bad === 0 &&
      !humanOverride &&
      // an explicit "success" outcome or abrupt stop
      (outcome === "success" || (durationSeconds < 10 * 60 && llmMsgs >= 3));

    if (hasUngroundedConfidence) {
      const message =
        "Trust warning: no external grounding detected. High confidence here does not guarantee correctness.";

      trustWarningShownForSession.set(
        session.sessionId,
        "ungrounded_confidence"
      );
      return {
        flag: "ungrounded_confidence",
        severity: "low",
        message,
        intent,
        estimatedTokens,
      };
    }

    return null;
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
    const diagnosticEl = document.getElementById("dom-diagnostic");
    const weeklyTitle = document.getElementById("weekly-title");
    const weeklyMeta = document.getElementById("weekly-meta");
    const weeklySuccess = document.getElementById("weekly-success");
    const weeklyAbandoned = document.getElementById("weekly-abandoned");
    const weeklyEscalated = document.getElementById("weekly-escalated");
    const eventsToggle = document.getElementById(
      "show-events-toggle"
    ) as HTMLInputElement | null;
    const showEvents = Boolean(eventsToggle?.checked);

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
          listEl.style.display = showEvents ? "block" : "none";
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
          if (diagnosticEl) {
            renderDomDiagnostic(diagnosticEl);
          }
          return;
        }

        const sessions = buildSessions(events, flags, metrics).filter(
          (session) => !isTrivialSession(session.summary)
        );

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
          lastActiveTabUrl = tab?.url ?? null;
          if (
            latestDomDiagnostic &&
            lastActiveTabUrl &&
            latestDomDiagnostic.url !== lastActiveTabUrl
          ) {
            latestDomDiagnostic = null;
          }
          const convId = extractConversationId(tab?.url);
          const moltbotSession = extractMoltbotSessionId(tab?.url);
          const claudeChatId = extractClaudeChatId(tab?.url);
          const geminiAppId = extractGeminiAppId(tab?.url);
          const activeSessionId = convId
            ? `chatgpt-c-${convId}`
            : claudeChatId
            ? `claude-chat-${claudeChatId}`
            : geminiAppId
            ? `gemini-app-${geminiAppId}`
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
            listEl.style.display = showEvents ? "block" : "none";
            if (sessionListEl) {
              sessionListEl.innerHTML = "";
            }
            if (diagnosticEl) {
              renderDomDiagnostic(diagnosticEl);
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
              titleSpan.textContent = formatSessionTitle(sObj);

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

          statusEl.textContent = `Sessions: ${sessions.length} | Events: ${events.length}`;
          headerEl.innerHTML = "";
          const summaryCard = document.createElement("div");
          summaryCard.className = "session-summary";

          const titleRow = document.createElement("div");
          titleRow.className = "session-summary-title-row";

          const titleEl = document.createElement("div");
          titleEl.className = "session-summary-title";
          titleEl.textContent = s.title && s.title.trim().length > 0 ? s.title : "(untitled)";
          titleRow.appendChild(titleEl);

          const openBtn = document.createElement("button");
          openBtn.type = "button";
          openBtn.id = "open-session";
          openBtn.className = "icon-button";
          openBtn.setAttribute("aria-label", "Open selected session");
          openBtn.setAttribute("title", "Open selected session");
          const openImg = document.createElement("img");
          openImg.src = "icons/open_session.svg";
          openImg.alt = "";
          openImg.className = "icon-button-img";
          openBtn.appendChild(openImg);
          openBtn.addEventListener("click", handleOpenSessionClick);
          const sessionUrl = buildSessionUrl(current.sessionId);
          openBtn.disabled = !sessionUrl;
          titleRow.appendChild(openBtn);

          summaryCard.appendChild(titleRow);

          const rowPlatform = document.createElement("div");
          rowPlatform.className = "session-summary-row";
          const modelText =
            s.modelsUsed && s.modelsUsed.length
              ? ` • Models: ${s.modelsUsed.join(", ")}`
              : "";
          rowPlatform.textContent = `Platform: ${platformLabel}${modelText}`;
          summaryCard.appendChild(rowPlatform);

          const currentIntent = (s.intent ?? "other") as SessionIntent;
          const intentSource = (s.intentSource ?? "auto") as IntentSource;
          const intentRow = document.createElement("div");
          intentRow.className = "session-intent";
          const intentLabel = document.createElement("label");
          intentLabel.textContent = "Session type: ";
          const intentSelect = document.createElement("select");
          const intentOptions: Array<{ value: SessionIntent; label: string }> = [
            { value: "quick_lookup", label: "Quick lookup" },
            { value: "coding", label: "Coding / debugging" },
            { value: "writing", label: "Writing / editing" },
            { value: "research", label: "Research / analysis" },
            { value: "creative", label: "Creative / brainstorming" },
            { value: "other", label: "Other / mixed" },
          ];
          for (const opt of intentOptions) {
            const optionEl = document.createElement("option");
            optionEl.value = opt.value;
            optionEl.textContent = opt.label;
            intentSelect.appendChild(optionEl);
          }
          intentSelect.value = currentIntent;
          intentSelect.addEventListener("change", () => {
            handleIntentChange(current.sessionId, intentSelect.value as SessionIntent);
          });
          const intentSourceTag = document.createElement("span");
          intentSourceTag.className = "intent-source-tag";
          intentSourceTag.textContent =
            intentSource === "auto" ? " (auto)" : " (set by you)";
          intentLabel.appendChild(intentSelect);
          intentLabel.appendChild(intentSourceTag);
          intentRow.appendChild(intentLabel);
          summaryCard.appendChild(intentRow);

          const rowCounts = document.createElement("div");
          rowCounts.className = "session-summary-row";
          rowCounts.textContent =
            `User msgs: ${s.userMessageCount ?? 0} • LLM msgs: ${s.llmMessageCount ?? 0}` +
            ` • Copies: ${s.copyEventsTotal ?? 0} • 👍 ${s.feedbackGoodCount ?? 0}` +
            ` • 👎 ${s.feedbackBadCount ?? 0}`;
          summaryCard.appendChild(rowCounts);

          // Trust governor: quiet, behavioral warning about possible miscalibrated trust.
          const trustAssessment = computeTrustRiskAssessment(current);
          if (trustAssessment) {
            const rowTrust = document.createElement("div");
            rowTrust.className = "session-summary-row session-summary-row-trust";

            const tokensLabel =
              trustAssessment.estimatedTokens > 0
                ? ` (≈${trustAssessment.estimatedTokens} tokens)`
                : "";

            rowTrust.textContent = `${trustAssessment.message}${tokensLabel}`;
            summaryCard.appendChild(rowTrust);
          }

          if (responseMetrics?.avgResponseTimeMs != null) {
            const rowLatency = document.createElement("div");
            rowLatency.className = "session-summary-row";
            const p95 = responseMetrics.p95ResponseTimeMs != null
              ? formatMs(responseMetrics.p95ResponseTimeMs)
              : "-";
            const max = responseMetrics.maxResponseTimeMs != null
              ? formatMs(responseMetrics.maxResponseTimeMs)
              : "-";
            rowLatency.textContent =
              `Avg response: ${formatMs(responseMetrics.avgResponseTimeMs)} • ` +
              `P95: ${p95} • Max: ${max}`;
            summaryCard.appendChild(rowLatency);
          }

          if (Number.isFinite(durationSec)) {
            const rowDuration = document.createElement("div");
            rowDuration.className = "session-summary-row";
            rowDuration.textContent = `Duration: ${formatDuration(durationSec)}`;
            summaryCard.appendChild(rowDuration);
          }

          if (s.isPartialHistory) {
            const rowPartial = document.createElement("div");
            rowPartial.className = "session-summary-row";
            rowPartial.textContent = "Partial history (joined late)";
            summaryCard.appendChild(rowPartial);
          }

          const insightsBlock = document.createElement("div");
          insightsBlock.className = "session-insights";
          const insightsTitle = document.createElement("div");
          insightsTitle.className = "session-insights-title";
          insightsTitle.textContent = "Session insights";
          const insightsList = document.createElement("ul");
          for (const line of getSessionInsights(s)) {
            const li = document.createElement("li");
            li.textContent = line;
            insightsList.appendChild(li);
          }
          insightsBlock.appendChild(insightsTitle);
          insightsBlock.appendChild(insightsList);
          summaryCard.appendChild(insightsBlock);

          headerEl.appendChild(summaryCard);

          if (outcomeSelect) {
            outcomeSelect.value = s.outcome ?? "";
          }
          overrideCheckbox.checked = Boolean(s.humanOverrideNeeded);

          listEl.style.display = showEvents ? "block" : "none";
          if (showEvents) {
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
          }

          if (diagnosticEl) {
            renderDomDiagnostic(diagnosticEl);
          }
        });
      }
    );
  }

  function renderDomDiagnostic(target: HTMLElement) {
    if (!latestDomDiagnostic) {
      target.innerHTML = "";
      return;
    }
    const report = latestDomDiagnostic;
    const observerLabel = report.observerAttached ? "OK" : "NOT ATTACHED";
    const modelLabel = report.modelLabel || "(not detected)";
    target.innerHTML = `
      <div class="dom-diagnostic-title">DOM diagnostics</div>
      <div class="dom-diagnostic-row">Platform: ${report.platform}</div>
      <div class="dom-diagnostic-row">Observer: ${observerLabel}</div>
      <div class="dom-diagnostic-row">Model label: ${modelLabel}</div>
      <div class="dom-diagnostic-row dom-diagnostic-url">URL: ${report.url}</div>
      <div class="dom-diagnostic-hint">
        To refresh, send a message that contains "DOM diagnostic" in ChatGPT, Claude or Gemini.
      </div>
    `;
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

        const sessions = buildSessions(events, flags, metrics).filter(
          (session) => !isTrivialSession(session.summary)
        );
        const current = selectedSessionId
          ? sessions.find((s) => s.sessionId === selectedSessionId) ?? null
          : pickCurrentSession(sessions);
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

  function handleIntentChange(sessionId: string, intent: SessionIntent) {
    chrome.storage.local.get(
      ["neaAgoraSessionFlags"],
      (data) => {
        const flags: SessionFlags =
          (data.neaAgoraSessionFlags as SessionFlags) ?? {};
        const currentFlags = flags[sessionId] ?? {};
        currentFlags.intent = intent;
        currentFlags.intentSource = "user";
        flags[sessionId] = currentFlags;

        chrome.storage.local.set({ neaAgoraSessionFlags: flags }, () => {
          renderLiveView();
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

    const exportSummaryBtn = document.getElementById(
      "export-service-record-summary"
    ) as HTMLButtonElement | null;
    if (exportSummaryBtn) {
      exportSummaryBtn.addEventListener("click", () => {
        handleExportSummaryClick().catch((err) =>
          console.error("Summary export failed", err)
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


    const showEventsToggle = document.getElementById(
      "show-events-toggle"
    ) as HTMLInputElement | null;
    if (showEventsToggle) {
      showEventsToggle.addEventListener("change", () => {
        renderLiveView();
      });
    }

    renderLiveView();

    chrome.runtime.onMessage.addListener((message) => {
      if (message?.type === "DOM_DIAGNOSTIC_REPORT" && message.payload) {
        latestDomDiagnostic = message.payload as DomDiagnosticReport;
        renderLiveView();
      }
    });

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
