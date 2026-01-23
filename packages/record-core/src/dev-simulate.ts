import {
  createEmptyRecord,
  startSession,
  appendEvent,
  finalizeSession,
  upsertSession,
  ServiceRecord
} from "./index.js";

function runDevSimulation() {
  let record: ServiceRecord = createEmptyRecord("chatgpt.com");

  let session = startSession(record, "session-1", "ChatGPT in Chrome");

  session = appendEvent(session, {
    kind: "user_prompt",
    metadata: { site: "chatgpt" }
  });

  session = appendEvent(session, {
    kind: "model_response",
    metadata: { site: "chatgpt", latencyMs: 1200 }
  });

  session = appendEvent(session, {
    kind: "copy_output",
    metadata: {
      site: "chatgpt",
      messageId: "message-1",
      charCount: 120,
      isCodeLike: true,
      languageHint: "typescript"
    }
  });

  // User decides the answer is wrong and types their own
  session = appendEvent(session, {
    kind: "user_override",
    metadata: { site: "chatgpt" }
  });

  session = appendEvent(session, {
    kind: "session_end",
    metadata: { site: "chatgpt" }
  });

  session = finalizeSession(session);

  record = upsertSession(record, session);

  console.log(JSON.stringify(record, null, 2));
}

type TestEvent = {
  kind:
    | "user_prompt"
    | "model_response"
    | "copy_output"
    | "user_override"
    | "session_end"
    | "feedback_good"
    | "feedback_bad";
  timestamp: string;
  metadata?: any;
};

function assertEqual<T>(label: string, actual: T, expected: T) {
  if (actual !== expected) {
    throw new Error(`[copy-metrics] ${label} expected ${expected} but got ${actual}`);
  }
}

function buildSessionForTest(
  sessionId: string,
  startAt: Date,
  events: TestEvent[]
) {
  let record = createEmptyRecord("chatgpt.com");
  let session = startSession(record, sessionId, "ChatGPT in Chrome", startAt);

  for (const ev of events) {
    session = appendEvent(session, {
      kind: ev.kind,
      metadata: ev.metadata,
      timestamp: ev.timestamp
    });
  }

  const endAt = events.length
    ? new Date(events[events.length - 1].timestamp)
    : startAt;

  session = finalizeSession(session, endAt);
  record = upsertSession(record, session);
  return session;
}

function runCopyMetricTests() {
  const t0 = new Date("2026-01-01T00:00:00.000Z");
  const t0Ms = t0.getTime();
  const iso = (ms: number) => new Date(ms).toISOString();

  const noCopySession = buildSessionForTest("test-no-copy", t0, [
    { kind: "user_prompt", timestamp: iso(t0Ms) }
  ]);
  const noCopySummary = noCopySession.summary!;
  assertEqual("no copy copiedOutput", noCopySummary.copiedOutput, false);
  assertEqual("no copy copiedCodeBlock", noCopySummary.copiedCodeBlock, false);
  assertEqual("no copy copiedTextLength", noCopySummary.copiedTextLength, 0);
  assertEqual("no copy timeToFirstCopySec", noCopySummary.timeToFirstCopySec, null);

  const oneCopySession = buildSessionForTest("test-one-copy", t0, [
    { kind: "user_prompt", timestamp: iso(t0Ms) },
    {
      kind: "copy_output",
      timestamp: iso(t0Ms + 5000),
      metadata: { site: "chatgpt", charCount: 100, isCodeLike: false }
    }
  ]);
  const oneCopySummary = oneCopySession.summary!;
  assertEqual("one copy copiedOutput", oneCopySummary.copiedOutput, true);
  assertEqual("one copy copiedCodeBlock", oneCopySummary.copiedCodeBlock, false);
  assertEqual("one copy copiedTextLength", oneCopySummary.copiedTextLength, 100);
  assertEqual("one copy timeToFirstCopySec", oneCopySummary.timeToFirstCopySec, 5);

  const mixedCopySession = buildSessionForTest("test-mixed-copy", t0, [
    { kind: "user_prompt", timestamp: iso(t0Ms) },
    {
      kind: "copy_output",
      timestamp: iso(t0Ms + 1000),
      metadata: { site: "chatgpt", charCount: 20, isCodeLike: true }
    },
    {
      kind: "copy_output",
      timestamp: iso(t0Ms + 2000),
      metadata: { site: "chatgpt", charCount: 80, isCodeLike: false }
    }
  ]);
  const mixedCopySummary = mixedCopySession.summary!;
  assertEqual("mixed copy copiedOutput", mixedCopySummary.copiedOutput, true);
  assertEqual("mixed copy copiedCodeBlock", mixedCopySummary.copiedCodeBlock, true);
  assertEqual("mixed copy copiedTextLength", mixedCopySummary.copiedTextLength, 100);

  const noPromptSession = buildSessionForTest("test-no-prompt", t0, [
    {
      kind: "copy_output",
      timestamp: iso(t0Ms + 3000),
      metadata: { site: "chatgpt", charCount: 10, isCodeLike: false }
    }
  ]);
  const noPromptSummary = noPromptSession.summary!;
  assertEqual("no prompt timeToFirstCopySec", noPromptSummary.timeToFirstCopySec, 3);

  const copyBeforeAnchorSession = buildSessionForTest("test-copy-before", t0, [
    {
      kind: "copy_output",
      timestamp: iso(t0Ms),
      metadata: { site: "chatgpt", charCount: 5, isCodeLike: false }
    },
    { kind: "user_prompt", timestamp: iso(t0Ms + 4000) }
  ]);
  const copyBeforeAnchorSummary = copyBeforeAnchorSession.summary!;
  assertEqual("copy before anchor timeToFirstCopySec", copyBeforeAnchorSummary.timeToFirstCopySec, 0);

  const feedbackSession = buildSessionForTest("test-feedback", t0, [
    { kind: "user_prompt", timestamp: iso(t0Ms) },
    {
      kind: "model_response",
      timestamp: iso(t0Ms + 1000),
      metadata: { site: "chatgpt" }
    },
    {
      kind: "feedback_good",
      timestamp: iso(t0Ms + 2000),
      metadata: { site: "chatgpt", messageId: "msg-1" }
    },
    {
      kind: "feedback_bad",
      timestamp: iso(t0Ms + 3000),
      metadata: { site: "chatgpt", messageId: "msg-2" }
    }
  ]);
  const feedbackSummary = feedbackSession.summary!;
  assertEqual("feedbackGoodCount", feedbackSummary.feedbackGoodCount, 1);
  assertEqual("feedbackBadCount", feedbackSummary.feedbackBadCount, 1);

  console.log("[copy-metrics] tests passed");
}

runDevSimulation();
runCopyMetricTests();
