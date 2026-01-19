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
      countEl.textContent = "Recorded events: 0";
      listEl.innerHTML = "<li>No events recorded yet.</li>";
      return;
    }

    const sorted = [...events].sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    );

    countEl.textContent = `Recorded events: ${sorted.length}`;
    listEl.innerHTML = "";

    for (const ev of sorted) {
      const li = document.createElement("li");
      li.textContent = `${ev.timestamp} -- ${ev.site} -- ${ev.type} -- ${ev.sessionId}`;
      listEl.appendChild(li);
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
