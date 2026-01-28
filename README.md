# Nea Agora Service Recorder

> Chrome extension: **Nea Agora Recorder** (developer mode)

A local-only Chrome extension that records your LLM / agent sessions on the web and exports **`agent_service_record` JSON** artifacts.

It does **not** send data to any server.  
It does **not** compute scores or rankings.  
It only turns raw interaction history into a structured record you control.

**Patent Pending**

Certain concepts and methods implemented or described in this repository are covered by one or more provisional patent applications filed by the authors.

Open-source usage is permitted under the MIT license.  
This notice is provided for disclosure purposes only and does not imply certification, endorsement, or warranty.

## Background

This repository accompanies the article [“Inside a Real ChatGPT Service Record”](https://leocharny.substack.com/p/inside-a-real-chatgpt-service-record)

It documents real service records captured while dogfooding the recorder during coding, creative, and research sessions.

The goal is not evaluation or scoring, but observability: what actually happened during human-AI interaction.

## Why this exists

Today, LLMs and agents operate like black boxes.

- You can’t see how often they fail.
- You can’t see when a human had to step in.
- You can’t compare “how well” different agents behave over time.

The Nea Agora Recorder is a small missing piece:

> A **behavioral/service record generator** that sits between raw chats and any future trust, ranking, or enforcement layer.

It focuses on **observed outcomes** and **human interventions**, not on opaque “trust scores”.  
All data stays local to your browser.

## What it actually does

The extension:

- Observes your chat sessions on `https://chatgpt.com/` (for now).
- Groups events into **sessions**.
- Tracks:
  - `outcome` per session:
    - `"success"`
    - `"abandoned"`
    - `"escalated_to_human"`
  - `neededHumanOverride` (boolean)
  - basic timing data (`startedAt`, `endedAt`, `approxDurationMs`)
- Exports everything into a single `agent_service_record` JSON file.

There is **no backend**:

- No sync  
- No telemetry  
- No remote analytics  

Just a local artifact you can inspect, archive, or feed into your own tooling.

## Install (developer mode)

Right now this is a developer-only MVP.

1. Clone the repo:
   
   ```bash
   git clone https://github.com/neaagora/nea-agora-recorder.git
   cd nea-agora-recorder
   ```

2. Build or prepare the extension (if needed):
   
   ```bash
   # if you have a build step
   npm install
   npm run build
   
   # after build, the extension lives in:
   # apps/chrome-extension/dist
   ```

3. Load it in Chrome:
   
   - Open `chrome://extensions`
   - Enable **Developer mode**
   - Click **Load unpacked**
   - Select `apps/chrome-extension/dist` (the folder with `manifest.json`)

You should now see **Nea Agora Service Recorder** in your extensions list.

## How to use

1. Open `https://chatgpt.com/` and use ChatGPT as usual.

2. The extension's content script will observe your prompts and group them into sessions.

3. Use the extension UI (popup) to:
   
   - Inspect recorded sessions.
   - Adjust the outcome if needed:
     - `"success"`
     - `"abandoned"`
     - `"escalated_to_human"`
   - Toggle `neededHumanOverride` when you had to manually fix something.

4. Export a service record:
   
   - Click **Export** in the popup.
   - This downloads a JSON file with:
     - `recordType: "agent_service_record"`
     - `subject` info (which agent/surface)
     - `observer` info (the recorder + environment)
     - an array of `sessions` with outcomes and flags.

See `examples\service_record__chatgpt_minimal.json` for a concrete example. These example service records are taken from real usage.

Some fields differ across versions (v0.4 vs v0.5), reflecting the evolution of the recorder during dogfooding.

Discrepancies are intentional and documented in the accompanying article.

The real sample in `examples/` contains multiple sessions, including:

- `success`
- `abandoned`
- `escalated_to_human` with `neededHumanOverride: true`

This is **not** a trust score.
It is raw, structured history that other systems can interpret later.

## What this is *not*

This project is **not**:

- a trust or reputation system
- a ranking engine
- a centralized analytics platform
- a cloud service

It is only:

> A tool to record what happened and when a human had to intervene.

Any trust scoring, aggregation, or enforcement should live in **separate** tools or services.

## Status

Early MVP:

- Chrome only
- ChatGPT-only (`https://chatgpt.com/*`)
- Developer-mode install
- UI is functional but minimal
- Data model may evolve

Breaking changes may happen as we learn.

## Roadmap (short)

- Better session visualization
- Import / merge multiple ServiceRecord files
- Optional CSV export
- Per-agent filters
- Safer defaults around what gets recorded

## Contributing

Issues and PRs are welcome. If you’re building:

- trust ranking
- enforcement
- service-record visualization

...and want to hook into this recorder, open an issue and describe your use case.

## License

MIT. See `LICENSE`.