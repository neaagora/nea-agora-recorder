"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
var index_1 = require("./index");
function runDevSimulation() {
    var record = (0, index_1.createEmptyRecord)("chatgpt.com");
    var session = (0, index_1.startSession)(record, "session-1", "ChatGPT in Chrome");
    session = (0, index_1.appendEvent)(session, {
        kind: "user_prompt",
        metadata: { site: "chatgpt" }
    });
    session = (0, index_1.appendEvent)(session, {
        kind: "model_response",
        metadata: { site: "chatgpt", latencyMs: 1200 }
    });
    session = (0, index_1.appendEvent)(session, {
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
    session = (0, index_1.appendEvent)(session, {
        kind: "user_override",
        metadata: { site: "chatgpt" }
    });
    session = (0, index_1.appendEvent)(session, {
        kind: "session_end",
        metadata: { site: "chatgpt" }
    });
    session = (0, index_1.finalizeSession)(session);
    record = (0, index_1.upsertSession)(record, session);
    console.log(JSON.stringify(record, null, 2));
}
function assertEqual(label, actual, expected) {
    if (actual !== expected) {
        throw new Error("[copy-metrics] ".concat(label, " expected ").concat(expected, " but got ").concat(actual));
    }
}
function buildSessionForTest(sessionId, startAt, events) {
    var record = (0, index_1.createEmptyRecord)("chatgpt.com");
    var session = (0, index_1.startSession)(record, sessionId, "ChatGPT in Chrome", startAt);
    for (var _i = 0, events_1 = events; _i < events_1.length; _i++) {
        var ev = events_1[_i];
        session = (0, index_1.appendEvent)(session, {
            kind: ev.kind,
            metadata: ev.metadata,
            timestamp: ev.timestamp
        });
    }
    var endAt = events.length
        ? new Date(events[events.length - 1].timestamp)
        : startAt;
    session = (0, index_1.finalizeSession)(session, endAt);
    record = (0, index_1.upsertSession)(record, session);
    return session;
}
function runCopyMetricTests() {
    var t0 = new Date("2026-01-01T00:00:00.000Z");
    var t0Ms = t0.getTime();
    var iso = function (ms) { return new Date(ms).toISOString(); };
    var noCopySession = buildSessionForTest("test-no-copy", t0, [
        { kind: "user_prompt", timestamp: iso(t0Ms) }
    ]);
    var noCopySummary = noCopySession.summary;
    assertEqual("no copy copiedOutput", noCopySummary.copiedOutput, false);
    assertEqual("no copy copiedCodeBlock", noCopySummary.copiedCodeBlock, false);
    assertEqual("no copy copiedTextLength", noCopySummary.copiedTextLength, 0);
    assertEqual("no copy timeToFirstCopySec", noCopySummary.timeToFirstCopySec, null);
    var oneCopySession = buildSessionForTest("test-one-copy", t0, [
        { kind: "user_prompt", timestamp: iso(t0Ms) },
        {
            kind: "copy_output",
            timestamp: iso(t0Ms + 5000),
            metadata: { site: "chatgpt", charCount: 100, isCodeLike: false }
        }
    ]);
    var oneCopySummary = oneCopySession.summary;
    assertEqual("one copy copiedOutput", oneCopySummary.copiedOutput, true);
    assertEqual("one copy copiedCodeBlock", oneCopySummary.copiedCodeBlock, false);
    assertEqual("one copy copiedTextLength", oneCopySummary.copiedTextLength, 100);
    assertEqual("one copy timeToFirstCopySec", oneCopySummary.timeToFirstCopySec, 5);
    var mixedCopySession = buildSessionForTest("test-mixed-copy", t0, [
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
    var mixedCopySummary = mixedCopySession.summary;
    assertEqual("mixed copy copiedOutput", mixedCopySummary.copiedOutput, true);
    assertEqual("mixed copy copiedCodeBlock", mixedCopySummary.copiedCodeBlock, true);
    assertEqual("mixed copy copiedTextLength", mixedCopySummary.copiedTextLength, 100);
    var noPromptSession = buildSessionForTest("test-no-prompt", t0, [
        {
            kind: "copy_output",
            timestamp: iso(t0Ms + 3000),
            metadata: { site: "chatgpt", charCount: 10, isCodeLike: false }
        }
    ]);
    var noPromptSummary = noPromptSession.summary;
    assertEqual("no prompt timeToFirstCopySec", noPromptSummary.timeToFirstCopySec, 3);
    var copyBeforeAnchorSession = buildSessionForTest("test-copy-before", t0, [
        {
            kind: "copy_output",
            timestamp: iso(t0Ms),
            metadata: { site: "chatgpt", charCount: 5, isCodeLike: false }
        },
        { kind: "user_prompt", timestamp: iso(t0Ms + 4000) }
    ]);
    var copyBeforeAnchorSummary = copyBeforeAnchorSession.summary;
    assertEqual("copy before anchor timeToFirstCopySec", copyBeforeAnchorSummary.timeToFirstCopySec, 0);
    console.log("[copy-metrics] tests passed");
}
runDevSimulation();
runCopyMetricTests();
