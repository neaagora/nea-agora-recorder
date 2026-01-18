import {
  createEmptyRecord,
  startSession,
  appendEvent,
  finalizeSession,
  upsertSession,
  ServiceRecord
} from "./index";

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

runDevSimulation();
