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
    type:
      | "page_visit"
      | "user_prompt"
      | "copy_output"
      | "feedback_good"
      | "feedback_bad"
      | "feedback_partial";
    site: "chatgpt";
    url: string;
    timestamp: string;
    sessionId: string;
    metadata?: CopyEventMetadata | FeedbackEventMetadata;
  };

  type SessionFlags = {
    [sessionId: string]: {
      humanOverrideRequired?: boolean;
      title?: string;
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
    | "feedback_bad"
    | "feedback_partial";

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
    isPartialHistory: boolean;
    title?: string | null;

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
  let activeOutcomeFilter: "success" | "abandoned" | "escalated_to_human" | null =
    null;

  function renderEvents(
    events: EventRecord[],
    sessionFlags: SessionFlags,
    sessionMetrics?: Record<string, SessionMetrics>
  ) {
    const countEl = document.getElementById("event-count");
    const listEl = document.getElementById("event-list");
    const overviewTitle = document.getElementById("overview-title");
    const overviewMeta = document.getElementById("overview-meta");
    const overviewChips = Array.from(
      document.querySelectorAll<HTMLButtonElement>(".outcome-chip")
    );

    const safeMetrics: Record<string, SessionMetrics> = sessionMetrics ?? {};

    if (!countEl || !listEl) return;

    if (!events.length) {
      countEl.textContent = "Sessions: 0 | Events: 0";
      listEl.innerHTML = "<li>No events recorded yet.</li>";
      if (overviewTitle && overviewMeta && overviewChips.length === 3) {
        overviewTitle.textContent = "This week";
        for (const chip of overviewChips) {
          const outcome = chip.dataset.outcome as
            | "success"
            | "abandoned"
            | "escalated_to_human";
          const label =
            outcome === "success"
              ? "✓ Success"
              : outcome === "abandoned"
              ? "⛔ Abandoned"
              : "🧑‍💻 Escalated";
          chip.textContent = `${label}: 0%`;
          chip.classList.toggle("active", activeOutcomeFilter === outcome);
        }
        overviewMeta.textContent = "Sessions recorded: 0 - Platforms: ChatGPT";
      }
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
    const filteredSessions = builtSessions.filter((session) => {
      const summary = session.summary;
      if (!summary) return false;

      const llmCount = summary.llmMessageCount ?? 0;
      const copyTotal = summary.copyEventsTotal ?? 0;
      const feedbackTotal =
        (summary.feedbackGoodCount ?? 0) +
        (summary.feedbackBadCount ?? 0);

      // Keep only sessions where the agent actually responded
      // or the user evaluated/copied something.
      return llmCount > 0 || copyTotal > 0 || feedbackTotal > 0;
    });

    const now = Date.now();
    const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

    // When adding weekly outcome stats later, ignore partial history sessions:
    // const weeklySessions = filteredSessions.filter(s => !s.summary.isPartialHistory && ...);
    const weeklySessions = filteredSessions.filter((session) => {
      const startedAtMs = new Date(
        session.startedAt ?? session.events[0]?.timestamp ?? 0
      ).getTime();
      return Number.isFinite(startedAtMs) && now - startedAtMs <= sevenDaysMs;
    });

    const totalWeekly = weeklySessions.length;

    const countByOutcome = {
      success: 0,
      abandoned: 0,
      escalated_to_human: 0,
    } as Record<"success" | "abandoned" | "escalated_to_human", number>;

    for (const session of weeklySessions) {
      const outcome = (session.summary?.outcome ?? null) as
        | "success"
        | "abandoned"
        | "escalated_to_human"
        | null;
      if (!outcome) continue;
      if (countByOutcome[outcome] !== undefined) {
        countByOutcome[outcome] += 1;
      }
    }

    if (overviewTitle && overviewMeta && overviewChips.length === 3) {
      overviewTitle.textContent = "This week";

      const pct = (outcome: "success" | "abandoned" | "escalated_to_human") =>
        totalWeekly === 0
          ? 0
          : Math.round((countByOutcome[outcome] / totalWeekly) * 100);

      for (const chip of overviewChips) {
        const outcome = chip.dataset.outcome as
          | "success"
          | "abandoned"
          | "escalated_to_human";
        const label =
          outcome === "success"
            ? "✓ Success"
            : outcome === "abandoned"
            ? "⛔ Abandoned"
            : "🧑‍💻 Escalated";
        chip.textContent = `${label}: ${pct(outcome)}%`;
        chip.classList.toggle("active", activeOutcomeFilter === outcome);
      }

      const platformLabel = "ChatGPT";
      overviewMeta.textContent =
        `Sessions recorded: ${totalWeekly} - Platforms: ${platformLabel}`;
    }

    const outcomeBySessionId = new Map<string, OutcomeType | null>();
    const summaryBySessionId = new Map<string, SessionSummary | undefined>();
    for (const s of filteredSessions) {
      outcomeBySessionId.set(s.sessionId, s.summary?.outcome ?? null);
      summaryBySessionId.set(s.sessionId, s.summary);
    }

    const filteredSessionIds = new Set(
      filteredSessions.map((session) => session.sessionId)
    );
    const filteredSessionSummaries = sessionSummaries.filter((session) =>
      filteredSessionIds.has(session.sessionId)
    );

    if (filteredSessions.length === 0) {
      countEl.textContent = "Sessions: 0 | Events: 0";
      listEl.innerHTML = "";
      const li = document.createElement("li");
      li.textContent = "No sessions recorded yet.";
      listEl.appendChild(li);
      return;
    }

    const sessionsForList = activeOutcomeFilter
      ? filteredSessions.filter(
          (session) => session.summary?.outcome === activeOutcomeFilter
        )
      : filteredSessions;

    const sessionsForListIds = new Set(
      sessionsForList.map((session) => session.sessionId)
    );
    const sessionsForListSummaries = filteredSessionSummaries.filter((session) =>
      sessionsForListIds.has(session.sessionId)
    );

    countEl.textContent = `Sessions: ${sessionsForList.length} | Events: ${events.length}`;
    listEl.innerHTML = "";

    if (sessionsForList.length === 0) {
      const li = document.createElement("li");
      li.textContent = "No sessions match this filter.";
      listEl.appendChild(li);
      return;
    }

    for (const session of sessionsForListSummaries) {
      const sessionId = session.sessionId;
      const liHeader = document.createElement("li");

      const headerText = document.createElement("span");
      const outcome = outcomeBySessionId.get(sessionId) ?? null;
      const summary = summaryBySessionId.get(sessionId);
      const durationMs = summary?.approxDurationMs ?? 0;
      const durationSec = Math.round(durationMs / 1000);
      const userCount = summary?.userMessageCount ?? 0;
      const llmCount = summary?.llmMessageCount ?? 0;
      const copyTotal = summary?.copyEventsTotal ?? 0;

      headerText.textContent =
        `Session ${sessionId} ` +
        `(u:${userCount} llm:${llmCount} copies:${copyTotal} ~${durationSec}s, ` +
        `${session.sessionEvents.length} events)`;
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
      if (sessionId.startsWith("chatgpt-tab-")) {
        continue;
      }

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
              : ev.type === "feedback_partial"
              ? "feedback_partial"
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
      const title = (sessionFlags[sessionId]?.title as string | undefined) ?? null;
      if (summary) {
        summary.title = title;
      }
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

    const metrics = session.metrics ?? {
      userMessageCount: 0,
      llmMessageCount: 0,
    };

    // Conversation structure from metrics
    const messageCount = metrics.userMessageCount + metrics.llmMessageCount;
    const userMessageCount = metrics.userMessageCount;
    const llmMessageCount = metrics.llmMessageCount;

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

    const isPartialHistory =
      userMessageCount === 0 &&
      llmMessageCount >= 5 &&
      (copyEventsTotal > 0 || feedbackGoodCount + feedbackBadCount > 0);

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
      isPartialHistory,

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
    const sessionsForExport = sessions.filter(
      (session) => !isTrivialTabSession(session)
    );

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
      sessions: sessionsForExport,
    };
  }

  function isTrivialTabSession(session: InteractionSession): boolean {
    if (!session.sessionId.startsWith("chatgpt-tab-")) return false;
    const s = session.summary;
    const noUser = (s?.userMessageCount ?? 0) === 0;
    const noLlm = (s?.llmMessageCount ?? 0) === 0;
    const noCopies = (s?.copyEventsTotal ?? 0) === 0;
    const noFeedback =
      (s?.feedbackGoodCount ?? 0) === 0 &&
      (s?.feedbackBadCount ?? 0) === 0;
    return noUser && noLlm && noCopies && noFeedback;
  }

  function cryptoRandomId(): string {
    return (
      Math.random().toString(36).slice(2) +
      Date.now().toString(36)
    );
  }

  function handleClearClick(onCleared: () => void) {
    const confirmed = window.confirm(
      "This will delete all recorded sessions and events. Are you sure?"
    );
    if (!confirmed) {
      return;
    }

    chrome.storage.local.remove(
      ["neaAgoraRecorder", "neaAgoraSessionFlags", "neaAgoraSessionMetrics"],
      () => {
        if (chrome.runtime.lastError) {
          console.error("Failed to clear records", chrome.runtime.lastError);
        }
        onCleared();
      }
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

        const clearBtn = document.getElementById("clear-service-records");
        if (clearBtn) {
          clearBtn.addEventListener("click", () => {
            handleClearClick(() => {
              renderEvents([], {}, {});
            });
          });
        }

        const overviewChips = Array.from(
          document.querySelectorAll<HTMLButtonElement>(".outcome-chip")
        );
        for (const chip of overviewChips) {
          chip.addEventListener("click", () => {
            const outcome = chip.dataset.outcome as
              | "success"
              | "abandoned"
              | "escalated_to_human";

            if (activeOutcomeFilter === outcome) {
              activeOutcomeFilter = null;
            } else {
              activeOutcomeFilter = outcome;
            }

            renderEvents(events, sessionFlags, sessionMetrics);
          });
        }
      }
    );
  });
})();
