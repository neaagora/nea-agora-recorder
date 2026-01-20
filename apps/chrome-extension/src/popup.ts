(() => {
  type EventRecord = {
    type: string;
    site: string;
    url: string;
    timestamp: string;
    sessionId: string;
  };

  type SessionFlags = {
    [sessionId: string]: {
      humanOverrideRequired?: boolean;
    };
  };

  type OutcomeType =
    | "success"
    | "partial"
    | "failed"
    | "abandoned"
    | "escalated_to_human";

  type InteractionEventKind =
    | "user_prompt"
    | "model_response"
    | "user_edit"
    | "user_override"
    | "session_end";

  interface InteractionEventMetadata {
    site: "chatgpt" | "other";
    conversationId?: string;
    latencyMs?: number;
  }

  interface InteractionEvent {
    id: string;
    timestamp: string; // ISO 8601
    kind: InteractionEventKind;
    metadata?: InteractionEventMetadata;
  }

  interface SessionSummary {
    outcome: OutcomeType;
    neededHumanOverride: boolean;
    retries: number;
    approxDurationMs: number;
  }

  interface InteractionSession {
    sessionId: string;
    startedAt: string;
    endedAt?: string;
    toolLabel: string; // e.g. "ChatGPT in Chrome"
    events: InteractionEvent[];
    summary?: SessionSummary;
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

  function renderEvents(events: EventRecord[], sessionFlags: SessionFlags) {
    const countEl = document.getElementById("event-count");
    const listEl = document.getElementById("event-list");

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

    const builtSessions = buildSessions(events, sessionFlags);
    const outcomeBySessionId = new Map<string, string>();
    for (const s of builtSessions) {
      outcomeBySessionId.set(s.sessionId, s.summary?.outcome ?? "unknown");
    }

    countEl.textContent = `Sessions: ${sessionSummaries.length} | Events: ${events.length}`;
    listEl.innerHTML = "";

    for (const session of sessionSummaries) {
      const sessionId = session.sessionId;
      const liHeader = document.createElement("li");

      const headerText = document.createElement("span");
      const outcome = outcomeBySessionId.get(sessionId) ?? "unknown";
      headerText.textContent = `Session ${sessionId} (${session.sessionEvents.length} events)`;
      headerText.style.wordBreak = "break-all";
      headerText.style.fontSize = "0.9em";

      const badge = document.createElement("span");
      badge.textContent = `Outcome: ${outcome}`;
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
    sessionFlags: SessionFlags
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

      const interactionEvents: InteractionEvent[] = sorted.map((ev) => ({
        id: cryptoRandomId(),
        timestamp: ev.timestamp,
        // For v0, treat each page_visit as a user_prompt event
        kind: "user_prompt",
        metadata: {
          site: "chatgpt",
        },
      }));

      const session: InteractionSession = {
        sessionId,
        startedAt: startTs.toISOString(),
        endedAt: endTs.toISOString(),
        toolLabel: "ChatGPT in Chrome",
        events: interactionEvents,
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
    humanOverride: boolean
  ): SessionSummary {
    const events = session.events;

    const firstTs = events[0]?.timestamp
      ? new Date(events[0].timestamp).getTime()
      : new Date(session.startedAt).getTime();
    const lastTs = events[events.length - 1]?.timestamp
      ? new Date(events[events.length - 1].timestamp).getTime()
      : endTime.getTime();

    const duration = Math.max(0, lastTs - firstTs);
    const retries = events.filter((e) => e.kind === "user_edit").length;

    const now = Date.now();
    const ageMs = now - lastTs;

    let outcome: OutcomeType = "success";

    if (humanOverride) {
      outcome = "escalated_to_human";
    } else if (
      ageMs > STALE_SESSION_THRESHOLD_MS &&
      events.length <= 2 && // very short session
      duration <= ABANDONED_MAX_DURATION_MS
    ) {
      outcome = "abandoned";
    }

    return {
      outcome,
      neededHumanOverride: humanOverride,
      retries,
      approxDurationMs: duration,
    };
  }

  function generateServiceRecord(
    events: EventRecord[],
    sessionFlags: SessionFlags
  ): ServiceRecord {
    const sessions = buildSessions(events, sessionFlags);

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
      ["neaAgoraRecorder", "neaAgoraSessionFlags"],
      (result) => {
        const events = Array.isArray(result.neaAgoraRecorder)
          ? (result.neaAgoraRecorder as EventRecord[])
          : [];

        const sessionFlags: SessionFlags =
          (result.neaAgoraSessionFlags as SessionFlags) ?? {};

        renderEvents(events, sessionFlags);

        const exportBtn = document.getElementById("export-service-record");
        if (exportBtn) {
          exportBtn.addEventListener("click", () => {
            const record = generateServiceRecord(events, sessionFlags);
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
