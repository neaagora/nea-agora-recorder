"use strict";
// Core types for Nea Agora Recorder
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createEmptyRecord = createEmptyRecord;
exports.startSession = startSession;
exports.appendEvent = appendEvent;
exports.finalizeSession = finalizeSession;
exports.upsertSession = upsertSession;
// --- Simple helpers ---
function createEmptyRecord(agentLabel) {
    return {
        agentLabel: agentLabel,
        sessions: []
    };
}
function startSession(record, sessionId, toolLabel, startTime) {
    if (startTime === void 0) { startTime = new Date(); }
    return {
        sessionId: sessionId,
        startedAt: startTime.toISOString(),
        toolLabel: toolLabel,
        events: []
    };
}
function appendEvent(session, event) {
    var _a, _b;
    var now = new Date();
    var nextEvent = {
        id: (_a = event.id) !== null && _a !== void 0 ? _a : cryptoRandomId(),
        timestamp: (_b = event.timestamp) !== null && _b !== void 0 ? _b : now.toISOString(),
        kind: event.kind,
        metadata: event.metadata
    };
    return __assign(__assign({}, session), { events: __spreadArray(__spreadArray([], session.events, true), [nextEvent], false) });
}
function finalizeSession(session, endTime) {
    if (endTime === void 0) { endTime = new Date(); }
    var summary = summarizeSession(session, endTime);
    return __assign(__assign({}, session), { endedAt: endTime.toISOString(), summary: summary });
}
function upsertSession(record, session) {
    var existingIndex = record.sessions.findIndex(function (s) { return s.sessionId === session.sessionId; });
    if (existingIndex === -1) {
        return __assign(__assign({}, record), { sessions: __spreadArray(__spreadArray([], record.sessions, true), [session], false) });
    }
    var nextSessions = __spreadArray([], record.sessions, true);
    nextSessions[existingIndex] = session;
    return __assign(__assign({}, record), { sessions: nextSessions });
}
// --- Internal helpers ---
function summarizeSession(session, endTime) {
    var _a, _b;
    var events = session.events;
    var firstTs = ((_a = events[0]) === null || _a === void 0 ? void 0 : _a.timestamp)
        ? new Date(events[0].timestamp).getTime()
        : new Date(session.startedAt).getTime();
    var lastTs = ((_b = events[events.length - 1]) === null || _b === void 0 ? void 0 : _b.timestamp)
        ? new Date(events[events.length - 1].timestamp).getTime()
        : endTime.getTime();
    var duration = Math.max(0, lastTs - firstTs);
    var hasOverride = events.some(function (e) { return e.kind === "user_override"; });
    var retries = events.filter(function (e) { return e.kind === "user_edit"; }).length;
    // Very naive outcome for v0
    var outcome = "success";
    if (hasOverride) {
        outcome = "escalated_to_human";
    }
    var hasFailureMarker = events.some(function (e) { var _a; return e.kind === "session_end" && ((_a = e.metadata) === null || _a === void 0 ? void 0 : _a.latencyMs) === -1; });
    if (hasFailureMarker && !hasOverride) {
        outcome = "failed";
    }
    return {
        outcome: outcome,
        neededHumanOverride: hasOverride,
        retries: retries,
        approxDurationMs: duration
    };
}
function cryptoRandomId() {
    // Simple random id; replace with crypto API in browser environment
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
