(() => {
  type EventRecord = {
    type: string;
    site: string;
    url: string;
    timestamp: string;
    sessionId: string;
  };

  function renderEvents(events: EventRecord[]) {
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

    countEl.textContent = `Sessions: ${sessionSummaries.length} | Events: ${events.length}`;
    listEl.innerHTML = "";

    for (const session of sessionSummaries) {
      const heading = document.createElement("li");
      heading.textContent = `Session ${session.sessionId} (${session.sessionEvents.length} events)`;
      listEl.appendChild(heading);

      for (const ev of session.sessionEvents) {
        const li = document.createElement("li");
        li.textContent = `${ev.timestamp} -- ${ev.type}`;
        listEl.appendChild(li);
      }
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    chrome.storage.local.get(["neaAgoraRecorder"], (result) => {
      const events = Array.isArray(result.neaAgoraRecorder)
        ? (result.neaAgoraRecorder as EventRecord[])
        : [];

      renderEvents(events);
    });
  });
})();
