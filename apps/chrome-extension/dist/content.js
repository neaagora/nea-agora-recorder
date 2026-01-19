"use strict";
(() => {
    console.log("[Nea Agora Recorder] content script loaded on this page");
    function deriveSessionId() {
        const match = window.location.pathname.match(/\/c\/([^/]+)/);
        if (match?.[1]) {
            return `chatgpt-c-${match[1]}`;
        }
        return `${window.location.host}-${Date.now()}`;
    }
    chrome.storage.local.get(["neaAgoraRecorder"], (result) => {
        const events = Array.isArray(result.neaAgoraRecorder)
            ? result.neaAgoraRecorder
            : [];
        const newEvent = {
            type: "page_visit",
            site: "chatgpt",
            url: window.location.href,
            timestamp: new Date().toISOString(),
            sessionId: deriveSessionId(),
        };
        const updatedEvents = [...events, newEvent];
        chrome.storage.local.set({ neaAgoraRecorder: updatedEvents }, () => {
            console.log(`[Nea Agora Recorder] stored ${updatedEvents.length} events in local storage`);
        });
    });
})();
