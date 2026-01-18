"use strict";
console.log("[Nea Agora Recorder] background script started");
chrome.runtime.onInstalled.addListener(() => {
    console.log("[Nea Agora Recorder] extension installed");
});
