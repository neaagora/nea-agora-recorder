(() => {
  type CopyTrigger = "selection" | "button_full_reply" | "button_code_block";

  type CopyEventMetadata = {
    site: "chatgpt" | "other";
    messageId?: string;
    charCount: number;
    isCodeLike: boolean;
    languageHint?: string;
    trigger?: CopyTrigger;
  };

  type FeedbackEventKind = "feedback_good" | "feedback_bad";

  type FeedbackEventMetadata = {
    site: "chatgpt" | "other";
    messageId?: string;
  };

  type SessionMetrics = {
    userMessageCount: number;
    llmMessageCount: number;
  };

  type EventRecord = {
    type: "page_visit" | "user_prompt" | "copy_output" | "feedback_good" | "feedback_bad";
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

  type OutcomeType =
    | "success"
    | "abandoned"
    | "escalated_to_human"
    | null;

  type PlatformId = "chatgpt" | "claude" | "gemini" | "unknown";

  type InteractionEventKind =
    | "user_prompt"
    | "model_response"
    | "user_edit"
    | "user_override"
    | "session_end"
    | "session_start"
    | "copy_output"
    | "feedback_good"
    | "feedback_bad";

  interface BaseInteractionEventMetadata {
    site: "chatgpt" | "other";
    conversationId?: string;
    latencyMs?: number;
  }

  type InteractionEventMetadata =
    | BaseInteractionEventMetadata
    | CopyEventMetadata
    | FeedbackEventMetadata;

  interface InteractionEvent {
    id: string;
    timestamp: string; // ISO 8601
    kind: InteractionEventKind;
    metadata?: InteractionEventMetadata;
  }

  interface SessionSummary {
    // HUMAN-ANCHORED STATE (ground truth)
    outcome: "success" | "abandoned" | "escalated_to_human" | null;
    neededHumanOverride: boolean | null;

    // CONVERSATION STRUCTURE (auto-tracked, v0.2+)
    messageCount: number;
    userMessageCount: number;
    llmMessageCount: number;

    // BEHAVIORAL FRICTION SIGNALS (auto-tracked, v0.2+)
    retryCount: number;
    iterativeRefinement: boolean;

    // OUTPUT USAGE (auto-tracked, v0.2+)
    copiedOutput: boolean;
    copiedCodeBlock: boolean;
    copiedTextLength: number;
    timeToFirstCopySec: number | null;

    // VERIFICATION BEHAVIOR (auto-tracked, v0.2+)
    switchedToSearch: boolean;
    switchedToDocs: boolean;
    timeToVerificationSec: number | null;

    // SESSION LIFECYCLE (auto-tracked, v0.2+)
    sessionEndedNaturally: boolean;
    tabClosedImmediately: boolean;
    idleTimeBeforeCloseSec: number;
    returnedToSession: boolean;
    autoAbandonedCandidate?: boolean;

    // CONTENT SHAPE (non-semantic, auto-detected, v0.2+)
    containsCodeBlocks: boolean;
    containsLongFormText: boolean;
    questionAnswerPattern: boolean;

    // TIMING
    approxDurationMs: number;

    // v0.3 copy tracking
    copyEventsTotal: number;
    copyEventsCode: number;
    copyEventsNonCode: number;
    copiedMessageIds?: string[];
    feedbackGoodCount: number;
    feedbackBadCount: number;
    feedbackMessageIds?: string[];

    // INTERNAL / EXISTING FIELDS
    retries: number; // kept for backward compatibility for now

    // OPTIONAL HUMAN NOTE (existing)
    note?: string;
  }

  interface InteractionSession {
    sessionId: string;
    platform: PlatformId;
    startedAt: string;
    endedAt?: string;
    toolLabel: string; // e.g. "ChatGPT in Chrome"
    events: InteractionEvent[];
    summary?: SessionSummary;
    metrics?: SessionMetrics;
  }

  interface ServiceRecord {
    recordType: string;
    version: string;
    subject: {
      agent: string;
      surface: string;
    };
    observer: {
      tool: string;
      environment: string;
      localOnly: boolean;
    };
    generatedAt: string;
    agentLabel: string;
    sessions: InteractionSession[];
  }

  const STALE_SESSION_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes
  const ABANDONED_MAX_DURATION_MS = 30 * 1000;

  function renderEvents(
    events: EventRecord[],
    sessionFlags: SessionFlags,
    sessionMetrics?: Record<string, SessionMetrics>
  ) {
    const countEl = document.getElementById("event-count");
    const listEl = document.getElementById("event-list");

    const safeMetrics: Record<string, SessionMetrics> = sessionMetrics ?? {};

    if (!countEl || !listEl) return;

    if (!events.length) {
      countEl.textContent = "Sessions: 0 | Events: 0";
      listEl.innerHTML = "<li>No events recorded yet.</li>";
      return;
    }

    const bySession = new Map<string, EventRecord[]>();
    for (const ev of events) {
      const bucket = bySession.get(ev.sessionId);
      if (bucket) {
        bucket.push(ev);
      } else {
        bySession.set(ev.sessionId, [ev]);
      }
    }

    const sessionSummaries = Array.from(bySession.entries()).map(
      ([sessionId, sessionEvents]) => ({
        sessionId,
        sessionEvents: [...sessionEvents].sort(
          (a, b) =>
            new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        ),
        latestTime: Math.max(
          ...sessionEvents.map((ev) => new Date(ev.timestamp).getTime())
        ),
      })
    );

    sessionSummaries.sort((a, b) => b.latestTime - a.latestTime);

    const builtSessions = buildSessions(events, sessionFlags, sessionMetrics);
    const outcomeBySessionId = new Map<string, OutcomeType | null>();
    for (const s of builtSessions) {
      outcomeBySessionId.set(s.sessionId, s.summary?.outcome ?? null);
    }

    countEl.textContent = `Sessions: ${sessionSummaries.length} | Events: ${events.length}`;
    listEl.innerHTML = "";

    for (const session of sessionSummaries) {
      const sessionId = session.sessionId;
      const liHeader = document.createElement("li");

      const headerText = document.createElement("span");
      const outcome = outcomeBySessionId.get(sessionId) ?? null;
      headerText.textContent = `Session ${sessionId} (${session.sessionEvents.length} events)`;
      headerText.style.wordBreak = "break-all";
      headerText.style.fontSize = "0.9em";

      const badge = document.createElement("span");
      const outcomeLabel =
        outcome === null
          ? "Outcome: Unreviewed"
          : outcome === "escalated_to_human"
          ? "Outcome: Escalated to human"
          : `Outcome: ${outcome}`;
      badge.textContent = outcomeLabel;
      badge.style.marginLeft = "8px";
      badge.style.padding = "2px 6px";
      badge.style.border = "1px solid #ccc";
      badge.style.borderRadius = "10px";
      badge.style.fontSize = "0.85em";
      badge.style.opacity = "0.85";
      badge.style.alignSelf = "flex-start";
      if (outcome !== "success") {
        badge.style.fontWeight = "600";
      }

      const label = document.createElement("label");
      label.style.marginLeft = "8px";
      label.style.fontSize = "0.9em";

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.style.marginRight = "4px";

      const currentFlags = sessionFlags[sessionId] ?? { humanOverrideRequired: false };
      checkbox.checked = Boolean(currentFlags.humanOverrideRequired);

      label.appendChild(checkbox);
      label.appendChild(document.createTextNode("Human override needed"));

      checkbox.addEventListener("change", () => {
        const nextFlags: SessionFlags = {
          ...sessionFlags,
          [sessionId]: {
            ...(sessionFlags[sessionId] ?? {}),
            humanOverrideRequired: checkbox.checked,
          },
        };

        // Update in-memory flags so subsequent toggles stay in sync
        Object.assign(sessionFlags, nextFlags);

        chrome.storage.local.set(
          { neaAgoraSessionFlags: nextFlags },
          () => {
            console.log(
              "[Nea Agora Recorder] updated session flags for",
              sessionId,
              "-> humanOverrideRequired=",
              checkbox.checked
            );
            renderEvents(events, sessionFlags);
          }
        );
      });

      const headerContainer = document.createElement("div");
      headerContainer.style.display = "flex";
      headerContainer.style.flexDirection = "column";
      headerContainer.style.gap = "4px";
      headerContainer.style.marginBottom = "4px";

      headerContainer.appendChild(headerText);
      headerContainer.appendChild(badge);
      headerContainer.appendChild(label);

      liHeader.appendChild(headerContainer);
      listEl.appendChild(liHeader);

      for (const ev of session.sessionEvents) {
        const li = document.createElement("li");
        li.textContent = `${ev.timestamp} -- ${ev.type}`;
        listEl.appendChild(li);
      }

      liHeader.style.borderBottom = "1px solid #eee";
      liHeader.style.paddingBottom = "6px";
      liHeader.style.marginBottom = "6px";
    }
  }

  function groupEventsBySession(events: EventRecord[]): Map<string, EventRecord[]> {
    const bySession = new Map<string, EventRecord[]>();
    for (const ev of events) {
      const bucket = bySession.get(ev.sessionId);
      if (bucket) {
        bucket.push(ev);
      } else {
        bySession.set(ev.sessionId, [ev]);
      }
    }
    return bySession;
  }

  function buildSessions(
    events: EventRecord[],
    sessionFlags: SessionFlags,
    sessionMetrics: Record<string, SessionMetrics> = {}
  ): InteractionSession[] {
    const bySession = groupEventsBySession(events);
    const sessions: InteractionSession[] = [];

    for (const [sessionId, sessionEvents] of bySession.entries()) {
      const sorted = [...sessionEvents].sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );

      const startTs = sorted[0]
        ? new Date(sorted[0].timestamp)
        : new Date();
      const endTs = sorted[sorted.length - 1]
        ? new Date(sorted[sorted.length - 1].timestamp)
        : startTs;

      const interactionEvents: InteractionEvent[] = sorted.map((ev) => {
        const metadata = ev.metadata ?? { site: "chatgpt" };
        return {
          id: cryptoRandomId(),
          timestamp: ev.timestamp,
          // For v0, treat each page_visit as a user_prompt event
          kind:
            ev.type === "user_prompt"
              ? "user_prompt"
              : ev.type === "copy_output"
              ? "copy_output"
              : ev.type === "feedback_good"
              ? "feedback_good"
              : ev.type === "feedback_bad"
              ? "feedback_bad"
              : "session_start",
          metadata,
        };
      });

      const firstEvent = interactionEvents[0];
      let platform: PlatformId = "unknown";
      if (firstEvent?.metadata?.site === "chatgpt") {
        platform = "chatgpt";
      }

      const metrics = sessionMetrics[sessionId] ?? {
        userMessageCount: 0,
        llmMessageCount: 0,
      };

      const session: InteractionSession = {
        sessionId,
        platform,
        startedAt: startTs.toISOString(),
        endedAt: endTs.toISOString(),
        toolLabel: "ChatGPT in Chrome",
        events: interactionEvents,
        metrics,
      };

      const summary = summarizeSession(
        session,
        endTs,
        Boolean(sessionFlags[sessionId]?.humanOverrideRequired)
      );
      session.summary = summary;

      sessions.push(session);
    }

    return sessions.sort((a, b) => {
      const aTime = new Date(a.startedAt).getTime();
      const bTime = new Date(b.startedAt).getTime();
      return bTime - aTime;
    });
  }

  function summarizeSession(
    session: InteractionSession,
    endTime: Date,
    humanOverride: boolean,
    note?: string
  ): SessionSummary {
    const events = session.events;

    const firstTs = events[0]?.timestamp
      ? new Date(events[0].timestamp).getTime()
      : new Date(session.startedAt).getTime();
    const lastTs = events[events.length - 1]?.timestamp
      ? new Date(events[events.length - 1].timestamp).getTime()
      : endTime.getTime();

    const duration = Math.max(0, lastTs - firstTs);

    // Conversation structure from events
    const messageCount = events.filter(
      (e) => e.kind !== "session_start"
    ).length;
    const userMessageCount = events.filter(
      (e) =>
        e.kind !== "session_start" &&
        (e.kind === "user_prompt" || e.kind === "user_edit")
    ).length;
    const llmMessageCount = events.filter(
      (e) => e.kind === "model_response"
    ).length;

    // Retry / friction
    const retries = events.filter((e) => e.kind === "user_edit").length;
    const retryCount = retries;
    const iterativeRefinement = retryCount > 1;

    // HUMAN-ANCHORED OUTCOME
    let outcome: OutcomeType | null = null;
    let neededHumanOverride: boolean | null = null;

    if (humanOverride) {
      neededHumanOverride = true;
      outcome = "escalated_to_human";
    }

    // VERIFICATION BEHAVIOR (placeholder for now)
    const switchedToSearch = false;
    const switchedToDocs = false;
    const timeToVerificationSec: number | null = null;

    // SESSION LIFECYCLE (best-effort defaults for now)
    const sessionEndedNaturally = true;
    const tabClosedImmediately = false;
    const idleTimeBeforeCloseSec = 0;
    const returnedToSession = false;

    const now = Date.now();
    const ageMs = now - lastTs;
    const isAutoAbandonedCandidate =
      ageMs > STALE_SESSION_THRESHOLD_MS &&
      events.length <= 2 &&
      duration <= ABANDONED_MAX_DURATION_MS;

    let copyEventsTotal = 0;
    let copyEventsCode = 0;
    let copyEventsNonCode = 0;
    let hasAnyCopy = false;
    let hasCodeCopy = false;
    let copiedTextLengthSum = 0;
    let earliestCopyMs: number | null = null;
    let earliestUserPromptMs: number | null = null;
    let earliestSessionStartMs: number | null = null;
    const copiedMessageIdsSet = new Set<string>();
    let feedbackGoodCount = 0;
    let feedbackBadCount = 0;
    const feedbackMessageIdsSet = new Set<string>();

    for (const ev of events) {
      if (ev.kind === "user_prompt") {
        const ts = Date.parse(ev.timestamp);
        if (Number.isFinite(ts)) {
          earliestUserPromptMs =
            earliestUserPromptMs === null ? ts : Math.min(earliestUserPromptMs, ts);
        }
      }

      if (ev.kind === "session_start") {
        const ts = Date.parse(ev.timestamp);
        if (Number.isFinite(ts)) {
          earliestSessionStartMs =
          earliestSessionStartMs === null ? ts : Math.min(earliestSessionStartMs, ts);
        }
      }

      if (ev.kind === "feedback_good" || ev.kind === "feedback_bad") {
        if (ev.kind === "feedback_good") {
          feedbackGoodCount += 1;
        } else {
          feedbackBadCount += 1;
        }

        const meta = ev.metadata as FeedbackEventMetadata | undefined;
        if (meta?.messageId) {
          feedbackMessageIdsSet.add(meta.messageId);
        }
      }

      if (ev.kind !== "copy_output") {
        continue;
      }

      copyEventsTotal += 1;
      hasAnyCopy = true;
      const metadata = ev.metadata as CopyEventMetadata | undefined;
      const isCodeLike = Boolean(metadata?.isCodeLike);
      if (isCodeLike) {
        copyEventsCode += 1;
        hasCodeCopy = true;
      } else {
        copyEventsNonCode += 1;
      }

      copiedTextLengthSum += metadata?.charCount ?? 0;

      const copyTs = Date.parse(ev.timestamp);
      if (Number.isFinite(copyTs)) {
        earliestCopyMs =
          earliestCopyMs === null ? copyTs : Math.min(earliestCopyMs, copyTs);
      }

      if (metadata?.messageId) {
        copiedMessageIdsSet.add(metadata.messageId);
      }
    }

    const copiedMessageIds =
      copiedMessageIdsSet.size > 0 ? Array.from(copiedMessageIdsSet) : undefined;
    const feedbackMessageIds =
      feedbackMessageIdsSet.size > 0 ? Array.from(feedbackMessageIdsSet) : undefined;

    const copiedOutput = hasAnyCopy;
    const copiedCodeBlock = hasCodeCopy;
    const copiedTextLength = copiedTextLengthSum;
    const anchorMs = earliestUserPromptMs ?? earliestSessionStartMs;
    let timeToFirstCopySec: number | null = null;
    if (earliestCopyMs !== null && anchorMs !== null) {
      const deltaMs = earliestCopyMs - anchorMs;
      timeToFirstCopySec = Math.max(0, Math.floor(deltaMs / 1000));
    }

    // CONTENT SHAPE (placeholders)
    const containsCodeBlocks = false;
    const containsLongFormText = false;
    const questionAnswerPattern = false;

    return {
      // Anchors
      outcome,
      neededHumanOverride,

      // Conversation structure
      messageCount,
      userMessageCount,
      llmMessageCount,

      // Friction signals
      retryCount,
      iterativeRefinement,

      // Output usage
      copiedOutput,
      copiedCodeBlock,
      copiedTextLength,
      timeToFirstCopySec,

      // Verification behavior
      switchedToSearch,
      switchedToDocs,
      timeToVerificationSec,

      // Lifecycle
      sessionEndedNaturally,
      tabClosedImmediately,
      idleTimeBeforeCloseSec,
      returnedToSession,
      autoAbandonedCandidate: isAutoAbandonedCandidate,

      // Content shape (non-semantic)
      containsCodeBlocks,
      containsLongFormText,
      questionAnswerPattern,

      // Timing
      approxDurationMs: duration,

      // v0.3 copy tracking
      copyEventsTotal,
      copyEventsCode,
      copyEventsNonCode,
      copiedMessageIds,
      feedbackGoodCount,
      feedbackBadCount,
      feedbackMessageIds,

      // Existing field kept for now
      retries,

      // Optional human note
      note,
    };
  }


  function generateServiceRecord(
    events: EventRecord[],
    sessionFlags: SessionFlags,
    sessionMetrics: Record<string, SessionMetrics>
  ): ServiceRecord {
    const sessions = buildSessions(events, sessionFlags, sessionMetrics);

    return {
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
      sessions,
    };
  }

  function cryptoRandomId(): string {
    return (
      Math.random().toString(36).slice(2) +
      Date.now().toString(36)
    );
  }

  document.addEventListener("DOMContentLoaded", () => {
    chrome.storage.local.get(
      ["neaAgoraRecorder", "neaAgoraSessionFlags", "neaAgoraSessionMetrics"],
      (result) => {
        const events = Array.isArray(result.neaAgoraRecorder)
          ? (result.neaAgoraRecorder as EventRecord[])
          : [];

        const sessionFlags: SessionFlags =
          (result.neaAgoraSessionFlags as SessionFlags) ?? {};

        const sessionMetrics: Record<string, SessionMetrics> =
          (result.neaAgoraSessionMetrics as Record<string, SessionMetrics>) ?? {};

        renderEvents(events, sessionFlags, sessionMetrics);

        const exportBtn = document.getElementById("export-service-record");
        if (exportBtn) {
          exportBtn.addEventListener("click", () => {
            const record = generateServiceRecord(events, sessionFlags, sessionMetrics);
            const blob = new Blob([JSON.stringify(record, null, 2)], {
              type: "application/json",
            });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `service_record__chatgpt_${new Date()
              .toISOString()
              .replace(/[:.]/g, "-")}.json`;
            a.click();
            URL.revokeObjectURL(url);
          });
        }
      }
    );
  });
})();
