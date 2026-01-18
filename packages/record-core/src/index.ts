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
  | "session_end";

export interface InteractionEventMetadata {
  site: "chatgpt" | "claude" | "gemini" | "other";
  conversationId?: string;
  latencyMs?: number;
}

export interface InteractionEvent {
  id: string;
  timestamp: string; // ISO 8601
  kind: InteractionEventKind;
  metadata?: InteractionEventMetadata;
}

export interface SessionSummary {
  outcome: OutcomeType;
  neededHumanOverride: boolean;
  retries: number;
  approxDurationMs: number;
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

  // Very naive outcome for v0
  let outcome: OutcomeType = "success";

  if (hasOverride) {
    outcome = "escalated_to_human";
  }

  const hasFailureMarker = events.some(
    e => e.kind === "session_end" && e.metadata?.latencyMs === -1
  );

  if (hasFailureMarker && !hasOverride) {
    outcome = "failed";
  }

  return {
    outcome,
    neededHumanOverride: hasOverride,
    retries,
    approxDurationMs: duration
  };
}

function cryptoRandomId(): string {
  // Simple random id; replace with crypto API in browser environment
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
