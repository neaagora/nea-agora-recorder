# Nea Agora Recorder — Progress & Status

This document tracks the current state of the project, major milestones,
design decisions, and what is intentionally deferred.

It is a living document.

---
## v0.8 - Multi-Platform Service Records + Latency Metrics (DONE)

-   Chrome extension now records **multi-session, multi-platform** interactions.

-   Supported platforms:
    -   ChatGPT (chatgpt.com)
    -   Clawdbot / MoltBot WebChat (localhost gateway)

-   Each session captures:
    -   User prompts and LLM responses
    -   Page visits, copy events, and feedback (good / partial)
    -   Accurate message counts derived from events
    -   Response time metrics:
        -   average
        -   p95
        -   max

-   Long-running sessions supported (hundreds of turns).
-   Noise sessions filtered on export.
-   Records produced as structured JSON service records suitable for audit, analysis, and visualization.

Status: **Code complete. Ready for demo and iteration.**

## v0.7 — Outcome Anchored Evaluation Layer

### Summary

v0.7 adds the first real evaluation layer on top of the v0.6 recording baseline.

The recorder still focuses on factual "what happened", but the side panel now allows the human user to explicitly say "how it went" for each session and to attach scoped partial feedback to specific aspects of model responses.

The key idea: evidence first, judgment second.

### What’s implemented

- Per session outcome selector in the side panel:
  - Unreviewed
  - Success
  - Abandoned
  - Escalated to human
- Weekly outcome summary block:
  - Shows percentages for each outcome over the last 7 days
  - Shows total sessions recorded and platform label
  - Ignores `isPartialHistory` sessions to avoid skew

- Scoped partial feedback:
  - New event type: `feedback_partial`
  - Carries `scope` (reasoning, code, facts, style, other)
  - Carries `sentiment` (good, bad) and optional note
  - Marked with `partial: true`
  - Does not inflate full thumbs up or down counters

- Side panel UX:
  - Human readable chat titles captured from ChatGPT and stored in flags
  - Session header shows title and per session stats instead of a bare session ID
  - Session list in the side panel with:
    - Title
    - Tiny stats (user, llm, copies)
    - One character outcome marker (✓ / ⛔ / 🧑‍💻 / ·)
  - Clicking a session row selects that session and updates the detail view

- Noise control:
  - `chatgpt-tab-*` sessions removed from UI and export
  - Partial history detection from v0.6 kept:
    - Long existing chats joined late are labeled `isPartialHistory`

### What’s intentionally not done

- No text span level partial feedback yet:
  - Scoped partial feedback is attached at the session level using a form
  - No DOM selection or offsets stored
- No automatic outcome inference or scores
- No charts, trust metrics, or trend graphs
- No non Chrome surfaces yet (VS Code, etc.)

These are reserved for v0.8 and later to avoid entangling capture, evaluation, and scoring too early.

### Why v0.7 matters

- Moves the project from "we recorded what the LLM did" to "we also recorded what the human thought about it".
- Keeps full vs partial judgments separate, so later analysis can distinguish "whole reply was good" from "reasoning was bad but the code was useful".
- Makes the side panel usable by real humans via titles and a simple session list, not just by someone who already knows all the session IDs by heart.

Current state: v0.7 is feature complete enough to tag once basic testing is done. The next version should focus on span level feedback and cross session analysis, not more basic plumbing.


---

## v0.6 

### Current snapshot (TL;DR)

- Primary UI: Chrome side panel
- Core capability: record + inspect agent service records
- Next focus: outcome labeling and weekly summary (v0.7)


v0.6 establishes a stable, inspectable foundation for **Agent Service Records**.

This version focuses on *correct capture, attribution, and legibility* of recorded interactions, not on analytics or scoring. The system now reliably records what happened, associates it with the correct chat session, and presents it to the user in a usable way.

At this point, logging and session reconstruction are considered **stable enough to build evaluation and outcome layers on top**.

---

### What’s implemented in v0.6

#### Core recording
- Records user prompts, model responses, copy actions, and feedback events.
- Persists data in `chrome.storage.local` across tab reloads and browser restarts.
- Supports long-running sessions without data loss.

#### Session reconstruction
- Groups events into logical sessions using ChatGPT conversation IDs (`chatgpt-c-*`).
- Correctly follows the active chat when switching conversations in the same tab.
- Handles edge cases where the recorder joins an existing conversation late.

#### Partial history handling
- Detects and marks sessions as **partial history** when:
  - The recorder joins a conversation with existing messages.
  - Only copies or feedback are observed, but no user prompts.
- Partial sessions are clearly labeled in the UI and can be excluded from summaries.

#### Side panel (primary UI)
- Chrome side panel is now the main interface.
- Opens via extension action click.
- Shows live events in real time.
- Displays per-session stats:
  - user message count
  - LLM message count
  - copy count
  - approximate duration
- Supports:
  - Exporting service records as JSON
  - Clearing all recorded data intentionally

#### Noise control
- Trivial `chatgpt-tab-*` sessions with no interaction are:
  - Hidden from the UI
  - Excluded from exported service records
- Raw storage remains intact for debugging, but exports stay clean.

#### Export
- Produces a structured `agent_service_record` JSON artifact.
- Includes:
  - sessions
  - events
  - summaries
  - partial-history markers
- Exported files are suitable for documentation and demos.

---

### Known limitations (by design)

- No automatic outcome inference.
- No scoring, trust metrics, or charts.
- No weekly or aggregate analytics.
- No text-span–level feedback.
- Chat titles are not yet recorded or displayed (planned next).

These are **explicitly deferred** to avoid conflating evidence collection with interpretation.

---

### Why v0.6 is a milestone

- Session attribution is correct and predictable.
- UI reflects reality instead of guessing.
- Exported records are honest about what was observed and what wasn’t.
- The system crossed from “debugging instrumentation” to “usable service record viewer”.

From here on, changes should **add meaning**, not fix capture mechanics.

---

## v0.5.1 fixes a record integrity issue discovered during v0.5 dogfooding.

When switching between ChatGPT conversations within the same browser tab, earlier versions could assign events from multiple chats to a single session. This release introduces **conversation-scoped session IDs** to prevent session mixing while preserving all existing event and metric structures.

---

## What Changed in v0.5.1

### Conversation-Scoped Session IDs

- Session IDs are now derived from the active ChatGPT conversation URL:
  - `chatgpt-c-<conversationId>` when a conversation is present
  - `chatgpt-tab-<id>` only when no conversation ID exists (e.g. landing page)
- Switching chats in the same tab results in **separate sessions**
- No manual session reset or UI interaction required

---

### What Did Not Change

- Event schemas remain unchanged
- Metric definitions remain unchanged:
  - `userMessageCount`
  - `llmMessageCount`
  - copy and timing metrics
- No inference or retroactive rewriting of past records

Existing records remain valid.

---

### Session Semantics (Explicit)

- v0.5.0:
  - Session scope = browser tab lifetime
- v0.5.1:
  - Session scope = ChatGPT conversation when identifiable
  - Tab-scoped fallback only when no conversation is active

This makes session boundaries explicit and observable.

---

### Known Limitations

- LLM message counting is DOM-based and may be off by one in some edge cases
  (e.g. regen or UI re-render).
- No attempt is made to infer semantic “task” boundaries.

These limitations are intentional and documented.

---

### Rationale

The goal of v0.5.1 is to improve **record integrity**, not to increase inference.

Conversation-scoped session IDs align better with how humans perceive ChatGPT interactions while avoiding fragile heuristics or hidden assumptions.

---

### Status

✅ Tested with multiple chats in the same tab  
✅ Produces clean, separated sessions  
✅ Ready for publication and demo use  

---

## v0.5 

### Summary

v0.5 extends the service recorder with **LLM-side message tracking** and stabilizes session behavior for publication and dogfooding.

This release intentionally prioritizes **observable behavior** over inferred structure.

---

### What’s New in v0.5

#### LLM Message Counting
- Added `llmMessageCount` metric.
- Counts assistant replies observed in the DOM.
- Works reliably for fresh chats and long-running sessions.

#### User Message Counting
- Added `userMessageCount` metric.
- Tracks user send actions consistently.

#### Session Semantics (Explicit)
- **Session scope = browser tab lifetime**.
- Switching chats within the same tab aggregates metrics.
- New tabs create clean, independent sessions.

This behavior is intentional for v0.5 and documented as such.

---

### Stability Notes

- Counts are internally consistent within a session.
- Minor off-by-one cases may occur during rapid UI transitions.
- No attempt is made to infer conversation boundaries.

---

### Debug & Logging

- v0.5 bring-up debug logs are commented out.
- Recorder logs are gated behind a single debug flag.
- Default behavior is quiet.

---

### Known Limitations

- Sessions are tab-scoped, not conversation-scoped.
- No per-message or per-span feedback yet.
- No token-level or semantic analysis.

These are planned for future iterations.

---

### Status

✅ Ready for merge  
✅ Ready for tagging as v0.5  
✅ Suitable for publication and demo use

## v0.4

v0.4 is **derived metrics only**.
-   No new DOM scraping.
-   No new event types.
-   No changes to content scripts.
-   No changes to outcome logic.
-   No UI.

You will:

1.  Derive four existing legacy fields in `SessionSummary` from the new `copy_output` events:
    -   `copiedOutput`
    -   `copiedCodeBlock`
    -   `copiedTextLength`
    -   `timeToFirstCopySec`

2.  Keep everything else exactly as-is.

Do not add any new fields to the JSON schema for v0.4.
We only populate fields that already exist.

* * * *

### 1. Locate the summarization code

Find the code that:

-   Takes a list of `InteractionEvent` or similar per session.

-   Computes a `SessionSummary` object.

-   Already sets:

    -   `copyEventsTotal`

    -   `copyEventsCode`

    -   `copyEventsNonCode`

    -   `copiedMessageIds?`

    -   and the older fields like `copiedOutput`, `copiedCodeBlock`, `copiedTextLength`, `timeToFirstCopySec`.

This is probably in a "record core" or summarization module.

Do **all** v0.4 work there.

* * * *

### 2. Define the v0.4 behavior

Implement the following rules inside the session summarization logic.

#### 2.1 `copiedOutput`

-   `copiedOutput = true` if there is at least one `copy_output` event in that session.

-   Otherwise `copiedOutput = false`.

You can base this on `copyEventsTotal` or on the raw events. Either is fine, but do it in one place only.

#### 2.2 `copiedCodeBlock`

-   `copiedCodeBlock = true` if there is at least one `copy_output` event where `metadata.isCodeLike === true`.

-   Otherwise `copiedCodeBlock = false`.

If `isCodeLike` is missing on some event, treat it as `false` for this purpose.

#### 2.3 `copiedTextLength`

-   `copiedTextLength` is the sum of `charCount` across all `copy_output` events in the session.

-   If there are no `copy_output` events, `copiedTextLength = 0`.

Handle missing `charCount` defensively:

-   If `charCount` is undefined, treat it as `0`.

#### 2.4 `timeToFirstCopySec`

This is a derived timing metric:

-   If the session has at least one `copy_output` event **and** at least one "anchor" event, compute this:

Definitions:

-   Let `tCopy` be the timestamp of the **earliest** `copy_output` event.

-   Let `tAnchor` be an "anchor" event timestamp. For v0.4:

    1.  Prefer the timestamp of the earliest `user_prompt` event in that session.

    2.  If there is no `user_prompt`, fall back to the earliest `session_start` event.

    3.  If neither exists, you cannot compute the metric, leave it as `null`.

Computation:

-   Parse timestamps using `Date` or whatever you already use for time math.

-   Both timestamps are in ISO string format in the events.

-   `timeToFirstCopySec = floor((tCopy - tAnchor) / 1000)` as a non-negative integer.

-   If `tCopy <= tAnchor`, set `timeToFirstCopySec = 0` to avoid negative values.

If there is **no** `copy_output` event, or no anchor, keep `timeToFirstCopySec = null`.

* * * *

### 3. Implementation details

#### 3.1 Work with existing loops

You almost certainly have a loop over events to compute:

-   `copyEventsTotal`

-   `copyEventsCode`

-   `copyEventsNonCode`

-   `copiedMessageIds`

Extend that same loop to accumulate:

-   `hasAnyCopy = true` when you see the first `copy_output`.

-   `hasCodeCopy = true` when you see a `copy_output` with `metadata.isCodeLike === true`.

-   `copiedTextLengthSum += metadata.charCount ?? 0`.

-   Track `earliestCopyTimestamp` as a string or number:

    -   On each `copy_output`, compare timestamps and keep the earliest.

You also need to track anchors:

-   `earliestUserPromptTimestamp` from `kind === 'user_prompt'`.

-   `earliestSessionStartTimestamp` from `kind === 'session_start'` or equivalent.

You already have some notion of `messageCount`, `userMessageCount`, etc.
Reuse that logic to find `user_prompt` and `session_start` events.
Do **not** change how counts are computed.

#### 3.2 Avoid breaking existing logic

Important:

-   Do not change any existing field default values or semantics beyond the four fields below.

-   Do not change how outcomes are assigned.

-   Do not change `copyEventsTotal`, `copyEventsCode`, `copyEventsNonCode`, or `copiedMessageIds`.

You are only **filling in**:

-   `copiedOutput`

-   `copiedCodeBlock`

-   `copiedTextLength`

-   `timeToFirstCopySec`

Everything else must behave exactly as in v0.3.

#### 3.3 Make it robust

Be defensive:

-   If timestamps are missing or invalid, fall back to `null` for `timeToFirstCopySec`.

-   If metadata is partial, treat missing values as zero / false where appropriate, not as errors.

Do not throw.
The summarizer must handle old and partial data gracefully.

* * * *

#### 4. Wire the derived values into `SessionSummary`

After you finish scanning the events and have the derived values, set them on the summary object.

Pseudocode structure:

```ts
const summary: SessionSummary = {
  // existing fields, already computed
  outcome,
  neededHumanOverride,
  messageCount,
  userMessageCount,
  llmMessageCount,
  // ...
  copyEventsTotal,
  copyEventsCode,
  copyEventsNonCode,
  copiedMessageIds: copiedMessageIdsSet.size ? Array.from(copiedMessageIdsSet) : undefined,
  // v0.4 derived fields
  copiedOutput: hasAnyCopy,
  copiedCodeBlock: hasCodeCopy,
  copiedTextLength: copiedTextLengthSum,
  timeToFirstCopySec: computedTimeToFirstCopySec,
};

```

Make sure the `SessionSummary` TypeScript interface matches this and that you do not remove any existing properties.

* * * *

### 5. Tests / sanity checks

Add or update tests to cover:

1.  **Session with no copy events**

    -   `copyEventsTotal = 0`

    -   `copiedOutput = false`

    -   `copiedCodeBlock = false`

    -   `copiedTextLength = 0`

    -   `timeToFirstCopySec = null`

2.  **Session with one non-code copy**

    -   One `user_prompt` at `t0`.

    -   One `copy_output` at `t0 + N seconds`, `isCodeLike = false`, `charCount = 100`.

    -   Expect:

        -   `copyEventsTotal = 1`

        -   `copyEventsCode = 0`

        -   `copyEventsNonCode = 1`

        -   `copiedOutput = true`

        -   `copiedCodeBlock = false`

        -   `copiedTextLength = 100`

        -   `timeToFirstCopySec ≈ N` (exact value based on timestamps you set).

3.  **Session with code and non-code copies**

    -   Multiple `copy_output` events with mixed `isCodeLike`.

    -   Expect:

        -   `copiedOutput = true`

        -   `copiedCodeBlock = true`

        -   `copiedTextLength` = sum of all `charCount`.

4.  **Session with copy but no `user_prompt`**

    -   No `user_prompt` events.

    -   One `session_start` and one `copy_output`.

    -   Expect:

        -   `timeToFirstCopySec` computed against `session_start`.

5.  **Session where earliest copy is before earliest anchor**

    -   Edge test:

        -   If logic ever sees `tCopy < tAnchor`, `timeToFirstCopySec` must not be negative. Expect `0`.

If there is no existing test harness, at least add one or two small unit tests in whatever framework you already use, or create a tiny pure function that computes the summary from a list of events and test that.

* * * *

### 6. Exit criteria for v0.4

You are done when:

-   The code compiles with no TypeScript errors.

-   Old v0.3 records still parse without crashes (missing fields just get defaults).

-   A new record generated after v0.4 shows, in at least one session with copy activity:

    -   `copyEventsTotal > 0`

    -   `copiedOutput = true`

    -   `copiedTextLength > 0`

    -   `timeToFirstCopySec` is a non-null integer.

-   No other summary fields changed unexpectedly between v0.3 and v0.4 for sessions with identical events.

Do not implement any other features or refactors in this change set.
v0.4 is strictly **"derive missing metrics from existing copy\_output events"**.

## v0.3

Use this context verbatim as the product spec:

> We just completed and merged **Nea Agora Service Recorder v0.2 (Anchored Behavioral Observation)**.  
> Session capture is reliable, session IDs are stable per tab, and human-anchored outcomes are correct.  
> v0.2 is frozen and tagged.
> 
> **Goal of this chat:**  
> Define and implement **v0.3**, starting with the **first real behavioral signal** beyond prompt capture.
> 
> **Proposed focus for v0.3:**  
> Add **copy behavior tracking** as a strictly observational signal:
> 
> - Detect when users copy LLM output.
> 
> - Distinguish code vs non-code when possible.
> 
> - Populate existing fields:  
>   ...
> 1. v0.3 behavioral spec (tight, minimal).
> 
> 2. Event model additions.
> 
> 3. Content-script capture strategy.
> 
> 4. Session summarization rules.
> 
> 5. Codex-ready implementation checklist.
> 
> Use that verbatim.

Now implement v0.3 as follows.

---

### 1. Behavioral spec for v0.3 (tight, minimal)

Introduce a **single new observational signal**: copy behavior.

Definition:

- A **copy event** is recorded when the user copies any part of the ChatGPT model output in the current tab.

- The extension does **not** infer why they copied, whether it was “good”, “bad”, “useful”, etc.

- The extension does **not** try to guess user intent, satisfaction, or outcome. Only “something from this response was copied”.

Constraints:

- Only record copy events that can be associated with:
  
  - the current **sessionId** (existing v0.2 concept), and
  
  - a specific model message, if possible.

- No scoring, no ranking, no success/failure interpretation.

- No cross-session aggregates, no charts, no trends in v0.3.

- If detection fails, it should fail silently. No user-facing UI and no extra errors.

---

### 2. Event model additions

Assume there is an existing event model similar to this:

- A base `EventRecord` with common fields like:
  
  - `type: string`
  
  - `site: string`
  
  - `url: string`
  
  - `timestamp: string`
  
  - `sessionId: string`

- An interaction event kind enum like:
  
  - `InteractionEventKind = 'user_prompt' | 'model_response' | 'user_edit' | 'user_override' | 'session_end'`

Extend the model with a **copy interaction** type.

1. Add a new interaction kind:

```ts
type InteractionEventKind =
  | 'user_prompt'
  | 'model_response'
  | 'user_edit'
  | 'user_override'
  | 'session_end'
  | 'copy_output';
```

2. Define metadata for a copy event. Keep it minimal and observational:

```ts
interface CopyEventMetadata {
  site: 'chatgpt' | 'other';
  // Optional ID if we can map to a known model response
  messageId?: string;
  // Number of characters in the copied selection
  charCount: number;
  // Simple heuristic: is the copied chunk likely code
  isCodeLike: boolean;
  // Optional language hint if easy to infer, otherwise omit
  languageHint?: string;
}
```

3. Add a corresponding event record type:

```ts
interface CopyInteractionEvent extends EventRecord {
  interactionKind: 'copy_output';
  metadata: CopyEventMetadata;
}
```

4. Wire this into whatever union you already use for interaction events so it is handled alongside `user_prompt`, `model_response`, etc.

The key rule: it is just “user copied this text from this response in this session”. Nothing more.

---

## 3. Content-script capture strategy

You are working inside a browser extension that already:

- Runs a content script on `chat.openai.com` or equivalent ChatGPT host.

- Knows how to:
  
  - detect new model responses,
  
  - assign `sessionId`,
  
  - send interaction events to the background or logging layer.

Implement copy detection in the content script with these rules.

#### 3.1 Where to listen

1. Register a single `document.addEventListener('copy', handler, true)` listener in the content script.

2. Inside the handler:
   
   - Check that the active page is a ChatGPT conversation (same checks as existing v0.2 logic uses to decide “this is ChatGPT”).
   
   - If it is not, ignore.

#### 3.2 Mapping copy to ChatGPT output

When a copy event fires:

1. Get the current selection:

```ts
const selection = window.getSelection();
```

2. If selection is empty or `selection.toString().trim().length === 0`, ignore.

3. Try to find the **nearest ChatGPT model response node** that contains or wraps the selection. Use the same DOM patterns you already use to detect model responses. For example:
   
   - ChatGPT messages often live in `div` blocks with role or class markers.
   
   - You likely already attach a `data-message-id` or similar when capturing `model_response` events. Reuse that if available.

4. Resolve a `messageId`:
- If the selection lives inside a known model response element that has your metadata attached, set `messageId` to that.

- If you cannot resolve a specific response, leave `messageId` undefined but still record the copy event.

- **Resolution Logic:** If the immediate selection doesn't have a `messageId`, Codex must recursively check `parentElement` or use `.closest()` to find the nearest container representing a model response. Even if a specific `messageId` cannot be found, the event must still be captured as long as it originates within the chat prose area.

### 3.3 Avoid duplicate events

Common browser behavior:

- Repeated copy operations on the same selection should each be treated as **distinct** observations.

- Do not try to deduplicate across time windows or content hashes. That is inference and not needed for v0.3.

- The only dedupe rule: do not fire more than one event per **single** `copy` DOM event.

- **Loop Protection:** Ensure the handler does not programmatically trigger a new `copy` event while reading the selection. Use standard DOM APIs like `window.getSelection()` which are passive and do not re-fire the event listener.

The copy handler should send exactly one `copy_output` event per browser `copy` event that passes the filters.

#### 3.4 Detecting code vs non-code

Implement a simple, conservative heuristic. It is fine to be dumb as long as it is deterministic.

For the copied text `text`:

- Compute `charCount = text.length`.

- Define `isCodeLike` as true if any of these are true:
  
  - The selection is inside a `pre`, `code`, or code-block container that you already recognize in the ChatGPT DOM.
  
  - The text contains multiple lines (e.g. at least one `\n`) and a significant fraction of lines look like code: contain `;`, `{`, `}`, `()`, or `=` with very low word density.
  
  - The selection lives in an element you already tag as “code block” when capturing model responses.

Do not do language-specific parsing. No syntax trees. No external libraries.

If `isCodeLike` is true and you can trivially guess the language from existing attributes (for example, ChatGPT sometimes labels code blocks with language names), you may set `languageHint`. Otherwise skip it.

#### 3.5 Emitting the event

Once you have:

- `sessionId` from existing v0.2 logic,

- `site: 'chatgpt'`,

- `url: location.href`,

- `timestamp` from your existing timestamp utility,

- `messageId` (optional),

- `charCount`,

- `isCodeLike`,

- `languageHint` (optional),

construct a `CopyInteractionEvent` and send it through the same pipeline you use for other interaction events.

Example shape:

```ts
const event: CopyInteractionEvent = {
  type: 'interaction',
  site: 'chatgpt',
  url: location.href,
  timestamp: toIsoStringNow(),
  sessionId,
  interactionKind: 'copy_output',
  metadata: {
    site: 'chatgpt',
    messageId,
    charCount,
    isCodeLike,
    languageHint,
  },
};
```

Send it using the existing messaging function (for example `sendEvent(event)`).

No new transport channels. Reuse what exists.

**Initialization Safety:** If the `sessionId` is not yet available (e.g., a copy happens the millisecond a page loads), the event should be cached in a local variable and retried after a 500ms delay rather than being dropped.

---

### 4. Session summarization rules

v0.2 already generates a **session summary** object. You must extend it to reflect copy behavior without changing existing semantics.

Do not remove or reinterpret any current fields.

Add minimal new summary fields:

```ts
interface SessionSummary {
  // existing fields from v0.2
  // ...
  // v0.3 additions
  copyEventsTotal: number;
  copyEventsCode: number;
  copyEventsNonCode: number;
  // Optional: IDs of responses from which copies were taken
  copiedMessageIds?: string[];
}
```

Rules:

1. When processing a stream of events for a session, for each `copy_output` event:
   
   - Increment `copyEventsTotal`.
   
   - If `metadata.isCodeLike` is true, increment `copyEventsCode`.
   
   - Otherwise, increment `copyEventsNonCode`.
   
   - If `metadata.messageId` is present, add it to `copiedMessageIds` (use a set under the hood to avoid duplicates, then serialize to an array).

2. Do not derive any new scores, trust factors, or “engagement metrics”. Just raw counts and IDs.

3. Keep all existing v0.2 summary behavior unchanged:
   
   - Anchor events remain as they are.
   
   - Session boundaries unchanged.
   
   - Any outcome semantics stay exactly the same.

---

### 5. Implementation checklist

Follow this concrete checklist step by step.

1. **Add types**
   
   - Extend `InteractionEventKind` with `'copy_output'`.
   
   - Add `CopyEventMetadata`.
   
   - Add `CopyInteractionEvent`.
   
   - Extend any `InteractionEvent` union type to include `CopyInteractionEvent`.

2. **Content script**
   
   - In the ChatGPT content script, add a `copy` event listener on `document`.
   
   - Implement the handler to:
     
     - Validate current site is ChatGPT.
     
     - Extract selection text.
     
     - Resolve `sessionId` using existing logic.
     
     - Map selection to a model response element if possible to get `messageId`.
     
     - Compute `charCount` and `isCodeLike`.
     
     - Build and send a `CopyInteractionEvent`.

3. **Background / logging pipeline**
   
   - Ensure the background script and any logging pipeline accept and forward events with `interactionKind: 'copy_output'` without special-case filtering.
   
   - If there is any switch or `if`/`else` over interaction kinds, add a branch for `copy_output` that either:
     
     - routes it to the generic interaction handler, or
     
     - explicitly logs it if needed.
   
   - Do not apply any extra interpretation.

4. **Session summary aggregation**
   
   - Locate the function that takes a list of events for a session and builds a `SessionSummary`.
   
   - Add initialization of the new counters `copyEventsTotal`, `copyEventsCode`, `copyEventsNonCode`.
   
   - Add aggregation logic for `copy_output` events as described above.
   
   - Extend any TypeScript interfaces accordingly.
   
   - Make sure old callers still compile and run.

5. **Tests**
   
   - Add or update unit tests for:
     
     - Emitting a `copy_output` event when user copies text from a model response.
     
     - Correct `charCount` and `isCodeLike` classification in at least:
       
       - one code-like selection,
       
       - one non-code selection.
     
     - Session summary aggregation:
       
       - A session with mixed `copy_output` events produces correct counts.
       
       - `copiedMessageIds` deduplicates correctly.
   
   - If you have no test harness, at least add a small dev tool function or logging branch that prints `copy_output` events to console in development builds so they can be manually verified.

6. **Non-regression**
   
   - Run existing v0.2 flows:
     
     - Prompt capture.
     
     - Session anchoring.
     
     - Session summary generation.
   
   - Verify they still behave exactly as before when no copy occurs.
   
   - Verify that adding copy events only adds fields and does not change the values of any existing fields.

Do not introduce any UI changes.  
Do not introduce any dashboards, charts, or cross-session analytics in v0.3.  
The only visible effect should be new `copy_output` events in the log and extra fields in the session summary.



## v0.2

### What we capture

From `content.ts`:

- `page_visit` events when a ChatGPT page is loaded.
- `user_prompt` events when the user submits a prompt.

We do **not** yet capture:

- Model responses
- Copy events
- Search / docs navigation
- Tab close, idle, or return behavior

### Where it works

The global listeners are URL-agnostic. They currently work for:

- Plain ChatGPT conversation URLs, for example:
  - `https://chatgpt.com/c/<conversation-id>`
- Project conversations, for example:
  - `https://chatgpt.com/g/<project-id>/c/<conversation-id>`

Other ChatGPT pages (home, project dashboards, etc.) may produce only `page_visit` events with no prompts, which is expected in v0.2.

### Session building

- Events are grouped by `sessionId` derived in `content.ts`.
- For ChatGPT conversations:
  - We use the `/c/<id>` as the stable session id: `chatgpt-c-<conversation-id>`.
- For pages without `/c/<id>`, we generate a tab-scoped fallback id on first use, so all events in that tab share one `sessionId`.

For each session:

- `startedAt` = earliest event timestamp in the group.
- `endedAt` = latest event timestamp in the group.
- `approxDurationMs` = `endedAt - startedAt` (may span hours or days).

### Event kinds

Raw → internal mapping:

- `page_visit` → `InteractionEvent.kind = "session_start"`.
- `user_prompt` → `InteractionEvent.kind = "user_prompt"`.

Counting rules:

- `messageCount` = number of events that are **not** `session_start`.
- `userMessageCount` = number of `"user_prompt"` or `"user_edit"` events.
- `llmMessageCount` = number of `"model_response"` events (currently always 0).

### Human anchors

Each session has a summary with two anchors:

- `outcome: "success" | "abandoned" | "escalated_to_human" | null`
- `neededHumanOverride: boolean | null`

v0.2 rules:

- For unreviewed sessions:
  - `outcome = null`
  - `neededHumanOverride = null`

- If the user ticks "Human override needed" in the popup:
  - `neededHumanOverride = true`
  - `outcome = "escalated_to_human"`

We do **not** automatically label `"success"` or `"abandoned"` in v0.2.

### Popup UI

- Lists sessions, newest first.
- Shows a badge:

  - `Outcome: Unreviewed` when `outcome == null`
  - `Outcome: Escalated to human` when `outcome == "escalated_to_human"`

- A checkbox "Human override needed" per session:

  - When toggled, saves a flag in `chrome.storage.local`
  - Recomputes summaries and re-renders the list
  - Controls the anchors as described above.

### Storage and truncation

- `neaAgoraRecorder` is append-only in v0.2.
- Exports include **all** known sessions.
- There is **no automatic truncation** or cleanup logic yet.

For now, truncation (deleting old sessions) is done manually by the developer when needed. v0.3+ will introduce explicit session-based cleanup.
