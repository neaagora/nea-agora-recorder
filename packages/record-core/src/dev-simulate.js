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
runDevSimulation();
