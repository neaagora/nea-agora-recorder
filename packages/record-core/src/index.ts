// Core types for Nea Agora Recorder

export type OutcomeType =
  | "success"
  | "partial"
  | "failed"
  | "abandoned"
  | "escalated_to_human";

export type InteractionEventKind =
  | "user_prompt"
  | "model_response"
  | "user_edit"
  | "user_override"
  | "session_end"
  | "copy_output"
  | "feedback_good"
  | "feedback_bad";

export interface InteractionEventMetadata {
  site: "chatgpt" | "claude" | "gemini" | "other";
  conversationId?: string;
  latencyMs?: number;
}

export type CopyTrigger =
  | "selection"
  | "button_full_reply"
  | "button_code_block";

export interface CopyEventMetadata {
  site: "chatgpt" | "other";
  messageId?: string;
  charCount: number;
  isCodeLike: boolean;
  languageHint?: string;
  trigger?: CopyTrigger;
}

export type FeedbackEventKind = "feedback_good" | "feedback_bad";

export interface FeedbackEventMetadata {
  site: "chatgpt" | "other";
  messageId?: string;
}

export interface BaseInteractionEvent {
  id: string;
  timestamp: string; // ISO 8601
  kind: InteractionEventKind;
  metadata?: InteractionEventMetadata;
}

export interface CopyInteractionEvent extends BaseInteractionEvent {
  kind: "copy_output";
  metadata: CopyEventMetadata;
}

export interface FeedbackInteractionEvent extends BaseInteractionEvent {
  kind: FeedbackEventKind;
  metadata?: FeedbackEventMetadata;
}

export type InteractionEvent =
  | BaseInteractionEvent
  | CopyInteractionEvent
  | FeedbackInteractionEvent;

export interface SessionSummary {
  outcome: OutcomeType;
  neededHumanOverride: boolean;
  retries: number;
  approxDurationMs: number;
  copyEventsTotal: number;
  copyEventsCode: number;
  copyEventsNonCode: number;
  copiedMessageIds?: string[];
  copiedOutput: boolean;
  copiedCodeBlock: boolean;
  copiedTextLength: number;
  timeToFirstCopySec: number | null;
  feedbackGoodCount: number;
  feedbackBadCount: number;
  feedbackMessageIds?: string[];
}

export interface InteractionSession {
  sessionId: string;
  startedAt: string;
  endedAt?: string;
  toolLabel: string; // e.g. "ChatGPT in Chrome"
  events: InteractionEvent[];
  summary?: SessionSummary;
}

export interface ServiceRecord {
  agentLabel: string; // for now, something like "chatgpt.com"
  sessions: InteractionSession[];
}

// --- Simple helpers ---

export function createEmptyRecord(agentLabel: string): ServiceRecord {
  return {
    agentLabel,
    sessions: []
  };
}

export function startSession(
  record: ServiceRecord,
  sessionId: string,
  toolLabel: string,
  startTime: Date = new Date()
): InteractionSession {
  return {
    sessionId,
    startedAt: startTime.toISOString(),
    toolLabel,
    events: []
  };
}

export function appendEvent(
  session: InteractionSession,
  event: Omit<InteractionEvent, "id" | "timestamp"> & { id?: string; timestamp?: string }
): InteractionSession {
  const now = new Date();
  const nextEvent: InteractionEvent = {
    id: event.id ?? cryptoRandomId(),
    timestamp: event.timestamp ?? now.toISOString(),
    kind: event.kind,
    metadata: event.metadata
  };

  return {
    ...session,
    events: [...session.events, nextEvent]
  };
}

export function finalizeSession(
  session: InteractionSession,
  endTime: Date = new Date()
): InteractionSession {
  const summary = summarizeSession(session, endTime);

  return {
    ...session,
    endedAt: endTime.toISOString(),
    summary
  };
}

export function upsertSession(
  record: ServiceRecord,
  session: InteractionSession
): ServiceRecord {
  const existingIndex = record.sessions.findIndex(
    s => s.sessionId === session.sessionId
  );

  if (existingIndex === -1) {
    return {
      ...record,
      sessions: [...record.sessions, session]
    };
  }

  const nextSessions = [...record.sessions];
  nextSessions[existingIndex] = session;

  return {
    ...record,
    sessions: nextSessions
  };
}

// --- Internal helpers ---

function summarizeSession(
  session: InteractionSession,
  endTime: Date
): SessionSummary {
  const events = session.events;
  const firstTs = events[0]?.timestamp
    ? new Date(events[0].timestamp).getTime()
    : new Date(session.startedAt).getTime();
  const lastTs = events[events.length - 1]?.timestamp
    ? new Date(events[events.length - 1].timestamp).getTime()
    : endTime.getTime();

  const duration = Math.max(0, lastTs - firstTs);

  const hasOverride = events.some(e => e.kind === "user_override");
  const retries = events.filter(e => e.kind === "user_edit").length;
  let copyEventsTotal = 0;
  let copyEventsCode = 0;
  let copyEventsNonCode = 0;
  let hasAnyCopy = false;
  let hasCodeCopy = false;
  let copiedTextLengthSum = 0;
  let earliestCopyMs: number | null = null;
  let earliestUserPromptMs: number | null = null;
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

    if (ev.kind !== "copy_output") continue;
    copyEventsTotal += 1;
    const metadata = (ev as CopyInteractionEvent).metadata;
    hasAnyCopy = true;
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

  // Very naive outcome for v0
  let outcome: OutcomeType = "success";

  if (hasOverride) {
    outcome = "escalated_to_human";
  }

  const hasFailureMarker = events.some(
    e =>
      e.kind === "session_end" &&
      (e.metadata as InteractionEventMetadata | undefined)?.latencyMs === -1
  );

  if (hasFailureMarker && !hasOverride) {
    outcome = "failed";
  }

  const copiedOutput = hasAnyCopy;
  const copiedCodeBlock = hasCodeCopy;
  const copiedTextLength = copiedTextLengthSum;
  let timeToFirstCopySec: number | null = null;
  const sessionStartMs = Date.parse(session.startedAt);
  const anchorMs =
    earliestUserPromptMs ?? (Number.isFinite(sessionStartMs) ? sessionStartMs : null);
  if (earliestCopyMs !== null && anchorMs !== null) {
    const deltaMs = earliestCopyMs - anchorMs;
    timeToFirstCopySec = Math.max(0, Math.floor(deltaMs / 1000));
  }

  return {
    outcome,
    neededHumanOverride: hasOverride,
    retries,
    approxDurationMs: duration,
    copyEventsTotal,
    copyEventsCode,
    copyEventsNonCode,
    copiedMessageIds,
    copiedOutput,
    copiedCodeBlock,
    copiedTextLength,
    timeToFirstCopySec,
    feedbackGoodCount,
    feedbackBadCount,
    feedbackMessageIds
  };
}

function cryptoRandomId(): string {
  // Simple random id; replace with crypto API in browser environment
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
