#!/usr/bin/env node
const fs = require("fs");

const args = process.argv.slice(2);

if (args.length === 0) {
  console.error("Usage:");
  console.error("  node tools/print_summary.js <record.json>");
  console.error("  node tools/print_summary.js --list <record.json>");
  process.exit(1);
}

let mode = "summary";
let inputPath;

if (args[0] === "--list" || args[0] === "-l") {
  mode = "list";
  inputPath = args[1];
} else {
  inputPath = args[0];
}

if (!inputPath) {
  console.error("Error: missing path to service record JSON file.");
  process.exit(1);
}

let raw;
try {
  raw = fs.readFileSync(inputPath, "utf-8");
} catch (err) {
  console.error(`Failed to read file: ${inputPath}`);
  console.error(err?.message ?? String(err));
  process.exit(1);
}

let record;
try {
  record = JSON.parse(raw);
} catch (err) {
  console.error("Invalid JSON in input file.");
  console.error(err?.message ?? String(err));
  process.exit(1);
}

function formatDuration(seconds) {
  if (!seconds || seconds <= 0) return "—";

  const totalMinutes = Math.floor(seconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  const hours = totalHours % 24;
  const days = Math.floor(totalHours / 24);

  if (days > 0) {
    return `${days} d ${hours} h ${minutes} min`;
  }

  if (totalHours > 0) {
    return `${totalHours} h ${minutes} min`;
  }

  return `${totalMinutes} min`;
}

const sessions = Array.isArray(record.sessions) ? record.sessions : [];
const uniquePlatforms = Array.from(
  new Set(sessions.map((s) => s.platform).filter(Boolean))
);

if (mode === "list") {
  console.log("Service Record");
  console.log(`Generated: ${record.generatedAt || "(unknown)"}`);
  console.log(`Sessions: ${sessions.length}`);
  console.log("");

  sessions.forEach((session, index) => {
    const s = session.summary || {};
    const title = s.title || "(untitled)";
    const platform = session.platform || "unknown";
    const id = session.sessionId || "(no-session-id)";
    const models =
      Array.isArray(s.modelsUsed) && s.modelsUsed.length
        ? ` [${s.modelsUsed.join(", ")}]`
        : "";
    console.log(`${index + 1}. ${platform.padEnd(10)} ${id}  ${title}${models}`);
  });

  process.exit(0);
}

console.log("Service Record");
console.log(`Generated: ${record.generatedAt || "(unknown)"}`);
console.log(`Sessions: ${sessions.length}`);
if (uniquePlatforms.length) {
  console.log(`Platforms: ${uniquePlatforms.join(", ")}`);
}
console.log("");

for (const session of sessions) {
  const s = session.summary || {};
  const m = s.responseMetrics || {};

  console.log(`[${session.platform ?? "unknown"}] ${s.title || "(untitled)"}`);
  console.log(`  Session: ${session.sessionId || "(unknown)"}`);
  const intent = s.intent || "other";
  const intentSource = s.intentSource || "auto";
  console.log(
    `  Type: ${intent} (${intentSource === "user" ? "set by you" : "auto"})`
  );
  if (Array.isArray(s.modelsUsed) && s.modelsUsed.length) {
    console.log(`  Models: ${s.modelsUsed.join(", ")}`);
  }
  console.log(
    `  User msgs: ${s.userMessageCount || 0} | LLM msgs: ${s.llmMessageCount || 0}`
  );
  console.log(
    `  Copies: ${s.copyEventsTotal || 0} | 👍 ${s.feedbackGoodCount || 0} | 👎 ${s.feedbackBadCount || 0}`
  );
  const durationSeconds = Math.round((s.approxDurationMs || 0) / 1000);
  console.log(`  Duration: ${formatDuration(durationSeconds)}`);
  if (typeof m.avgResponseTimeMs === "number") {
    const avg = (m.avgResponseTimeMs / 1000).toFixed(1);
    const p95 = typeof m.p95ResponseTimeMs === "number"
      ? (m.p95ResponseTimeMs / 1000).toFixed(1)
      : "-";
    const max = typeof m.maxResponseTimeMs === "number"
      ? (m.maxResponseTimeMs / 1000).toFixed(1)
      : "-";
    console.log(`  Avg: ${avg}s | P95: ${p95}s | Max: ${max}s`);
  }
  console.log("");
}
