# FocusFlow — Implementation Guide

> A classroom attention assistant that listens to live speech, detects what matters, and surfaces child-friendly summaries — built for students with attention difficulties.

---

## Table of Contents

1. [What FocusFlow Does](#what-focusflow-does)
2. [Guiding Principles](#guiding-principles)
3. [Architecture Overview](#architecture-overview)
4. [File-by-File Walkthrough](#file-by-file-walkthrough)
5. [The Two-Model Pipeline](#the-two-model-pipeline)
6. [Prompt Engineering](#prompt-engineering)
7. [Audio Pipeline Details](#audio-pipeline-details)
8. [UI & Design System](#ui--design-system)
9. [Deployment & Security](#deployment--security)
10. [Bugs Fixed Along the Way](#bugs-fixed-along-the-way)
11. [Configuration & Settings](#configuration--settings)
12. [Future Directions](#future-directions)

---

## What FocusFlow Does

FocusFlow is a browser-based accessibility tool designed for Chromebooks. It runs in a Chrome tab alongside a student's classwork and does three things:

1. **Listens** — captures the teacher's voice via the device microphone.
2. **Transcribes** — streams audio to the Gemini Live API over a WebSocket, receiving real-time text transcription.
3. **Summarizes** — when the transcript contains something *important* (an instruction, deadline, warning, or key concept), it surfaces a short, child-friendly card on screen with a gentle chime.

The target user is a 5–6 year old student who struggles to maintain focus. The app is intentionally **not** a full transcript viewer — it stays quiet until something actionable is said, then delivers a summary written at a kindergarten reading level.

---

## Guiding Principles

These principles shaped every decision in the project:

### 1. Distraction-Free by Default

The whole point of the app is to help a child who *already* has attention difficulties. The UI must not compete for attention. No bouncing animations, no bright accent colors, no notification badges. The screen stays calm and empty until something genuinely matters.

### 2. Salience Over Completeness

Most of what a teacher says in a class period is explanation, filler, or social chat. The app deliberately ignores all of it. Only *actionable* content — instructions, warnings, deadlines, multi-step procedures — triggers a card. False positives (unnecessary alerts) are worse than false negatives (missed alerts), because each false positive trains the student to ignore the tool.

### 3. Child-Readable Output

Summaries are written for a 5–6 year old. This means:
- Simple vocabulary ("Open your book" not "Please reference the designated text")
- Direct address ("You need to..." not "The teacher said...")
- Short sentences (1–3 max for quick alerts)
- Leading emoji as a visual category marker (📝, ⚠️, 💡, 📅, ❓)

### 4. No Server Required for Core Function

The app runs entirely in the browser. There is no backend — audio goes directly from the mic to the Gemini Live WebSocket, and summary requests go directly from the browser to the Gemini REST API. The only server-side component is Vercel Edge Middleware for authentication when deployed publicly.

### 5. Graceful Degradation

Network errors, API rate limits, and WebSocket disconnects are all expected in a classroom environment. The app retries with exponential backoff, auto-reconnects before the 10-minute session limit, and silently handles transient failures rather than crashing or showing alarming error states to the child.

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                        Browser (Chrome)                         │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐   │
│  │ AudioCapture  │───▶│ LiveSession   │───▶│ TranscriptStore  │   │
│  │ (mic → PCM)   │    │ (WebSocket)   │    │ (buffer + trigger)│   │
│  └──────────────┘    └──────────────┘    └────────┬─────────┘   │
│                                                    │             │
│                                          trigger every ~30s      │
│                                          or on 6s silence        │
│                                                    ▼             │
│                                          ┌──────────────────┐   │
│                                          │   Summarizer      │   │
│                                          │ (REST API calls)  │   │
│                                          │ 1. Detect salience│   │
│                                          │ 2. Generate card  │   │
│                                          └────────┬─────────┘   │
│                                                    │             │
│                                                    ▼             │
│                                          ┌──────────────────┐   │
│                            Chime ◀───────│   App (UI)        │   │
│                                          │ Quick alerts      │   │
│                                          │ Checklist cards   │   │
│                                          └──────────────────┘   │
└─────────────────────────────────────────────────────────────────┘

External Services:
  • Gemini Live API (wss://generativelanguage.googleapis.com) — transcription
  • Gemini REST API (https://generativelanguage.googleapis.com) — summarization
```

The system is a pipeline of five loosely-coupled modules, each communicating through callbacks:

| Module | Responsibility |
|---|---|
| **AudioCapture** | Mic access, downsample 48→16kHz, emit base64 PCM chunks |
| **LiveSession** | WebSocket lifecycle, send audio, receive transcript fragments |
| **TranscriptStore** | Buffer fragments, manage rolling window, fire summarizer triggers |
| **Summarizer** | Two-stage LLM pipeline: salience detection → summary generation |
| **App** | Wire modules together, render UI, manage card lifecycle |

Supporting modules: **Chime** (Web Audio notification tones), **Config** (API key/model management), **AudioSimulator** (test audio playback), **PCMProcessor** (AudioWorklet for downsampling).

---

## File-by-File Walkthrough

```
focusflow/
├── index.html              # Single-page app shell
├── css/
│   └── style.css           # Full design system (610 lines)
├── js/
│   ├── app.js              # Main controller — wires everything together
│   ├── audio-capture.js    # Mic → base64 PCM via AudioWorklet
│   ├── audio-simulator.js  # Streams a test .wav file for debugging
│   ├── chime.js            # Two-tone Web Audio notification sound
│   ├── config.js           # API key + model persistence (localStorage)
│   ├── live-session.js     # Gemini Live API WebSocket management
│   ├── pcm-processor.js    # AudioWorkletProcessor (48→16kHz downsample)
│   ├── summarizer.js       # REST API calls for salience + summaries
│   └── transcript-store.js # Transcript buffering + trigger logic
├── api/
│   └── config.js           # Vercel Edge Function — serves env API key
├── middleware.js            # Vercel Edge Middleware — HTTP Basic Auth
├── test_api.py             # Python script to verify Live API connectivity
├── implementation_plan.html # Rich HTML implementation plan document
└── .gitignore
```

### `index.html`

A minimal single-page shell. Contains:
- **Header** with title, settings gear button, and status indicator (dot + label).
- **Pinned section** for checklist cards (hidden until one appears).
- **Recent section** for quick alert cards.
- **Empty state** prompting the user to press Start.
- **Transcript debug panel** (collapsed by default, toggled by a button).
- **Controls footer** with Start, Stop, Test Audio, and Clear buttons.
- **Settings modal** with API key input, model dropdown, and Save/Cancel.

Everything loads as a single ES module entry point: `<script type="module" src="js/app.js">`.

### `js/app.js` — The Controller

The `FocusFlowApp` class is the central orchestrator. Its constructor:
1. Instantiates all five modules.
2. Calls `_bindModules()` to wire callbacks between them.
3. Calls `_bindUI()` to attach DOM event listeners.

**Key wiring in `_bindModules()`:**
- `audio.onChunk → session.sendAudio` — PCM chunks flow to the WebSocket.
- `session.onTranscript → store.addFragment` — transcript text flows to the buffer.
- `session.onTurnComplete → store.signalTurnComplete` — end-of-utterance events.
- `store.onTrigger → summarizer.process` — when enough new text accumulates, fire the summarizer.
- `summarizer.onQuickAlert / onChecklist → _addQuickAlert / _addChecklist` — render cards + play chime.

**Card lifecycle:**
- Quick alerts fade after 5 minutes, auto-remove after 15 minutes.
- Checklists are pinned and support interactive checkboxes; auto-collapse when all items are checked.
- Only one checklist can be expanded at a time — opening a new one collapses the previous.

### `js/audio-capture.js` — Microphone Pipeline

Uses the Web Audio API with an `AudioWorkletNode`:
1. Requests mic with mono channel, echo cancellation, noise suppression, and auto gain.
2. Creates an `AudioContext` at 48kHz (browser default).
3. Loads `pcm-processor.js` as an AudioWorklet module.
4. Connects mic source → worklet → destination.
5. The worklet posts `{ pcmData: ArrayBuffer }` messages every ~100ms.
6. `AudioCapture` converts each buffer to base64 and emits via `onChunk` callback.

### `js/pcm-processor.js` — The AudioWorklet

Runs on the audio rendering thread (separate from main thread). Performs:
- **Downsampling**: skips samples at a ratio of `sampleRate / 16000` (typically 48000/16000 = 3x).
- **Quantization**: converts float32 `[-1, 1]` to int16 `[-32768, 32767]`.
- **Chunking**: accumulates 1600 samples (100ms at 16kHz) before posting to main thread.

### `js/live-session.js` — WebSocket to Gemini Live API

Manages the full WebSocket lifecycle:
- **Connect**: opens `wss://generativelanguage.googleapis.com/.../BidiGenerateContent?key=...`
- **Setup**: sends a config message requesting `AUDIO` response modality, `inputAudioTranscription`, and a system instruction telling the model to be a silent listener.
- **VAD config**: `startOfSpeechSensitivity: HIGH`, `endOfSpeechSensitivity: HIGH`, 200ms prefix padding, 1000ms silence duration.
- **Message handling**: parses incoming messages (handling both text and Blob/ArrayBuffer binary frames), extracts `inputTranscription.text` fragments, and detects `turnComplete` signals.
- **Auto-reconnect**: schedules a reconnect at 9 minutes (before the 10-minute session limit). On unexpected close, retries after 2 seconds with backoff.
- **Error handling**: detects 403/1008 auth errors and surfaces an API key warning.

### `js/transcript-store.js` — Buffer & Trigger Logic

The bridge between raw transcription and the summarizer. Key behaviors:
- **Fragment accumulation**: each `addFragment()` call appends timestamped text.
- **Silence trigger**: after 6 seconds of no new fragments, fires the summarizer. This threshold was tuned — 3–5s caused premature triggers during natural pauses; 8s caused missed detections.
- **Time trigger**: fires every 30 seconds regardless (if there's enough new text).
- **Turn-complete trigger**: fires when the Live API signals end of an utterance.
- **Minimum threshold**: requires at least 50 new characters before triggering (filters out "um", "okay" fragments).
- **Rolling window**: `getRecentWindow()` returns the last 3 minutes of text for context.
- **Mark summarized**: after the summarizer finishes processing, the store marks the current position so the same text isn't re-analyzed.

### `js/summarizer.js` — Two-Stage LLM Pipeline

The intelligence layer. Makes direct `fetch()` calls to the Gemini REST API (no SDK import needed in the browser).

**Stage 1 — Salience Detection**: sends the new transcript text with a system prompt asking: "Does this contain something the student needs to act on?" Returns a JSON object with `is_salient`, `category`, `has_multiple_steps`, `step_count`, and `confidence`. If `confidence < 0.6` or `is_salient: false`, processing stops — no card is generated.

**Stage 2 — Summary Generation**: if salient, takes one of two paths:
- **Quick alert** (single action): generates 1–3 sentences with a category emoji.
- **Checklist** (multi-step instructions): generates a `{ title, steps[] }` JSON object rendered as an interactive checkbox list.

**Rate limiting**: minimum 15 seconds between API calls to avoid quota issues.

**Retry logic**: exponential backoff (1s → 2s → 4s) for HTTP 429, 500, 503, 504 errors and network failures. Up to 3 retries.

**Session context**: every 3rd call, the summarizer asks the model to condense the full transcript into a ~100 word session summary, which is included in future prompts as context so summaries don't repeat old information.

**Live getter pattern**: when the store triggers the summarizer, it includes a `getRecentText()` function that re-fetches the transcript at generation time rather than using the stale snapshot from trigger time. This prevents checklist truncation when the teacher keeps talking during the async API call.

### `js/config.js` — Key & Model Management

API key resolution priority:
1. URL parameter (`?key=...` or `?apiKey=...`) — saved to localStorage, then cleaned from URL.
2. localStorage (`focusflow_api_key`).
3. Environment variable (fetched from `/api/config` edge function at init).
4. Fallback placeholder (`YOUR_API_KEY_HERE`).

Model selection is persisted in localStorage (`focusflow_model`), defaulting to `gemini-3.1-flash-lite` for its high free-tier rate limit.

### `js/chime.js` — Notification Sound

Uses the Web Audio API to synthesize a gentle two-tone chime:
- Tone 1: 440Hz (A4), 120ms, volume 0.08
- Tone 2: 554Hz (C#5), 150ms, volume 0.06, starts 150ms after tone 1

Respects a 10-second cooldown to avoid rapid-fire chimes if multiple cards arrive close together. Handles browser autoplay policy by resuming a suspended AudioContext.

### `js/audio-simulator.js` — Test Mode

Downloads a 20-second WAV from GitHub, decodes it with `OfflineAudioContext`, resamples to 16kHz mono, and streams it to the LiveSession in 100ms chunks via `setInterval`. Used for testing transcription + summarization without needing a live microphone. Progress callbacks update the status label.

### `api/config.js` — Vercel Edge Function

A tiny serverless function that returns `{ apiKey: process.env.GEMINI_API_KEY }`. This allows the deployed version to inject the API key from Vercel's environment variables without exposing it in the client bundle.

### `middleware.js` — Vercel Edge Auth

HTTP Basic Authentication middleware that runs at Vercel's edge before any static file is served. Reads `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` from environment variables. Returns a 401 challenge if credentials don't match, triggering the browser's native login dialog.

---

## The Two-Model Pipeline

FocusFlow uses two separate Gemini models for distinct purposes:

| Role | Model | Protocol | Why |
|---|---|---|---|
| **Transcription** | `gemini-3.1-flash-live-preview` | WebSocket (Live API) | Real-time streaming, voice activity detection, low latency |
| **Summarization** | Configurable (default: `gemini-3.1-flash-lite`) | REST (`generateContent`) | JSON mode, system instructions, high free-tier quota |

**Why two models instead of one?**

The Live API excels at continuous audio transcription with built-in VAD (voice activity detection), but it's a streaming session — you can't easily ask it to also analyze the transcript for salience mid-stream. The REST API is better suited for discrete, structured prompts that return JSON. Separating the two keeps each model focused on what it does best.

**Why the Live API instead of the Web Speech API?**

Chrome's built-in `SpeechRecognition` API was considered but rejected because:
- It has a hard 60-second timeout per session.
- It doesn't provide word-level timestamps.
- Its accuracy is significantly worse for classroom audio (echo, distance, background noise).
- The Gemini Live API supports `inputAudioTranscription` mode, which provides server-side transcription of the input audio stream.

---

## Prompt Engineering

The prompts went through multiple iterations. Key lessons:

### Salience Detection Prompt

The most critical prompt. It defines what counts as "important." The categories are:
- **Instructions/assignments** — "turn to page 5", "write your name"
- **Warnings/rules** — "don't forget to...", "this will be on the test"
- **Key new concepts** — important ideas being introduced
- **Schedule changes/deadlines** — time-sensitive information
- **Questions directed at the class** — things students need to respond to

Explicitly excluded: general explanation, casual chat, greetings, filler speech, repetition. The `confidence` threshold (0.6) was chosen to be permissive — better to show a slightly questionable alert than miss a real instruction.

### Handling Teacher Self-Corrections

Teachers frequently stutter, restart sentences, or say "scratch that." The summary prompts explicitly instruct the model to extract only the *final corrected action* and ignore retracted text. Without this, summaries would include contradictory instructions.

### Checklist Completeness

Early versions truncated multi-step instructions — the model would return the first 3–4 steps and stop. Fixes:
1. Added explicit prompt language: "Do NOT skip, combine, or truncate steps — include ALL of them, especially the very last/concluding step."
2. Added: "Pay close attention to the end of the transcript to ensure you do not miss the final instruction."
3. Implemented the "live getter" pattern so the model receives the freshest transcript, not a stale snapshot.

### JSON Response Format

Both salience detection and checklist generation use `responseMimeType: 'application/json'` to force structured output. The prompts include example schemas so the model knows exactly what shape to return.

---

## Audio Pipeline Details

```
Microphone (hardware)
    │
    ▼
getUserMedia (mono, echo cancel, noise suppress, auto gain)
    │
    ▼
AudioContext @ 48kHz
    │
    ▼
MediaStreamSource
    │
    ▼
AudioWorkletNode ("pcm-processor")
    │  ┌─────────────────────────────────────────┐
    │  │ PCMProcessor (runs on audio thread)      │
    │  │  • Skip every 3rd sample (48→16kHz)      │
    │  │  • Float32 → Int16 quantization          │
    │  │  • Accumulate 1600 samples (100ms)       │
    │  │  • Post ArrayBuffer to main thread       │
    │  └─────────────────────────────────────────┘
    │
    ▼
Main Thread: ArrayBuffer → base64 string
    │
    ▼
WebSocket.send({ realtimeInput: { audio: { data, mimeType: "audio/pcm;rate=16000" } } })
    │
    ▼
Gemini Live API → returns inputTranscription.text fragments
```

**Why AudioWorklet instead of ScriptProcessorNode?**

`ScriptProcessorNode` is deprecated and runs on the main thread, causing jank. `AudioWorkletProcessor` runs on a dedicated audio rendering thread with deterministic timing, which is critical for smooth 16kHz streaming.

**Why downsample to 16kHz?**

The Gemini Live API accepts `audio/pcm;rate=16000`. 16kHz is standard for speech recognition — it captures the full frequency range of human speech (up to ~8kHz by Nyquist) while minimizing bandwidth.

---

## UI & Design System

### Design Philosophy

The CSS is intentionally "boring" by web standards. No gradients, no glassmorphism, no dark mode. The design follows accessibility research for young children with attention difficulties:

- **Warm, muted palette**: cream background (`#faf9f7`), soft grays, earth tones. No pure white or pure black.
- **Lexend font**: specifically designed for readability, with increased character spacing that reduces visual crowding. Loaded from Google Fonts.
- **Large text**: card text is `1.25rem`, checklist labels are `1.2rem`. Well above WCAG minimums.
- **Large touch targets**: checkboxes are `24×24px` with generous padding. Buttons have `12px 28px` padding.
- **No animations that demand attention**: the only transitions are subtle opacity fades (0.2–0.3s) on card appearance and removal.
- **Color-coded left borders**: each card category has a distinct but muted border color (blue for instructions, amber for warnings, green for concepts, coral for deadlines, purple for questions).

### Card System

Two card types:

**Quick Alerts** — appear in the "recent" section, newest at top. Fade to 50% opacity after 5 minutes, auto-remove after 15 minutes. Designed for one-shot information.

**Checklists** — appear in the "pinned" section above recent alerts. Feature:
- Interactive checkboxes with strikethrough on completion.
- Auto-collapse when all steps are checked.
- Accordion behavior: only one can be expanded at a time.
- Collapse summary showing progress ("3/5 steps done" or "✅ All 5 steps done").
- Dismiss button (✕) for manual removal.

### Responsive Design

A single `@media (max-width: 480px)` breakpoint reduces padding, font sizes, and button sizes for phones. The core layout (single column, max-width `680px`) works well on all screen sizes without major breakpoint changes.

---

## Deployment & Security

### Local Development

Serve with any static file server:
```bash
cd focusflow/
python3 -m http.server 8080
```
Open `http://localhost:8080`, enter an API key in settings, and click Start.

### Vercel Deployment

The app deploys to Vercel as a static site with two edge functions:

1. **`middleware.js`** — HTTP Basic Auth at the edge. Reads `BASIC_AUTH_USER` and `BASIC_AUTH_PASSWORD` from Vercel environment variables. Protects all routes except `favicon.ico`.

2. **`api/config.js`** — Edge function that serves `{ apiKey: process.env.GEMINI_API_KEY }`. The client fetches this at startup so the API key doesn't need to be hardcoded.

### Environment Variables (Vercel Dashboard)

| Variable | Purpose |
|---|---|
| `BASIC_AUTH_USER` | Username for login prompt |
| `BASIC_AUTH_PASSWORD` | Password for login prompt |
| `GEMINI_API_KEY` | API key served to the client via `/api/config` |

### API Key Security

The version-controlled codebase uses `YOUR_API_KEY_HERE` as a placeholder. Real keys are stored in:
- localStorage (per-user, set via the settings modal)
- Vercel environment variables (for the deployed version)
- URL parameters (one-time injection, immediately cleaned from the address bar)

GitHub Push Protection flagged hardcoded keys during early development. This led to the dual-directory structure: `focusflow/` (clean, version-controlled) and `playground/focusflow/` (local development with real keys, gitignored).

---

## Bugs Fixed Along the Way

These are documented here because they reveal important constraints of the Gemini Live API and browser audio stack that anyone re-implementing this would encounter.

### 1. VAD Configuration Error (WebSocket 1007)

**Symptom**: WebSocket closed immediately with code `1007`.
**Cause**: Used `START_SENSITIVITY_MEDIUM` / `END_SENSITIVITY_MEDIUM` which aren't valid API enum values.
**Fix**: Changed to `START_SENSITIVITY_HIGH` / `END_SENSITIVITY_HIGH`.

### 2. Binary Message Parse Error

**Symptom**: `SyntaxError: Unexpected token 'o', "[object Blob]" is not valid JSON`.
**Cause**: The Live API sends binary audio packets alongside JSON messages. Calling `JSON.parse()` on a `Blob` crashes.
**Fix**: Added type checking in `_handleMessage()` — if the data is a `Blob` or `ArrayBuffer`, decode it to text first. Silently catch JSON parse errors on binary frames.

### 3. Setup Race Condition

**Symptom**: Audio packets sent before the server acknowledged setup, causing silent failures.
**Fix**: Only set `_setupDone = true` after receiving the `setupComplete` server message, not on WebSocket open.

### 4. Summarizer 503 Errors

**Symptom**: Summarization failed during usage spikes.
**Fix**: Added exponential backoff retry (1s → 2s → 4s) for status codes 429, 500, 503, 504 and network errors. Up to 3 retries.

### 5. Duplicate Checklist Numbering

**Symptom**: Items rendered as "1. 1. Take out your worksheet."
**Cause**: Gemini returned pre-numbered strings like `"1. Take out your worksheet"`, and the UI prepended its own numbering.
**Fix**: Strip leading numbering with regex (`/^\d+[\.)\s-]+\s*/`) before rendering.

### 6. Checklist Truncation

**Symptom**: Multi-step instructions missing the last 1–2 steps.
**Cause**: The summarizer received a stale transcript snapshot from trigger time, but the teacher kept talking during the async API call.
**Fix**: Implemented "live getter" — the trigger passes a function `getRecentText()` instead of a string, which the summarizer calls right before generating the checklist, getting the freshest transcript.

### 7. Premature Silence Triggers

**Symptom**: Summarizer fired mid-sentence when the teacher paused naturally.
**Cause**: Initial silence threshold was 3 seconds — too aggressive for classroom speech where teachers pause for 3–5 seconds between thoughts.
**Fix**: Tuned silence trigger to 6 seconds after testing showed it balanced responsiveness with phrase completion. (Tried 8s but it delayed detection of genuine instruction endings.)

### 8. Favicon 404

**Symptom**: Console 404 error on `/favicon.ico`.
**Fix**: Inline SVG data URL favicon (🎯 emoji) in the `<head>` tag, eliminating the need for a separate file.

### 9. Pre-Connection API Key Validation & Auto-Settings Trigger

**Symptom**: Unconfigured or default placeholder API keys (`YOUR_API_KEY_HERE`) caused opaque WebSocket close errors (`1006` / `403` / `1008`) when attempting to connect to the Gemini Live API.
**Cause**: The client attempted WebSocket connections using invalid placeholder keys without validating key presence first, and did not guide the user to the configuration interface.
**Fix**: Added pre-connection key checking in `LiveSession.connect()` to fail fast with a descriptive error message if `getApiKey()` returns empty or `YOUR_API_KEY_HERE`. Updated `FocusFlowApp._showError()` to automatically open and focus the ⚙️ Settings modal whenever an API key error is caught, providing an immediate path for the user to paste a valid Gemini API key.

---

## Configuration & Settings

### Settings Modal

Accessible via the ⚙️ button in the header. Two controls:

1. **API Key** — text input (type `password`). Leave empty to use the default/environment key.
2. **Model Selector** — dropdown with available Gemini models:
   - `gemini-3.1-flash-lite` (default — high free-tier rate limit)
   - `gemini-2.0-flash`
   - `gemini-2.0-flash-lite`
   - `gemini-3.5-flash`
   - `gemini-3.1-pro-preview`

Both values persist in `localStorage` across sessions.

### Tunable Constants

These values are hardcoded but designed to be easily adjustable:

| Constant | Location | Value | Purpose |
|---|---|---|---|
| `SESSION_MAX_MS` | live-session.js | 9 min | Reconnect before 10-min session limit |
| `SILENCE_TRIGGER_MS` | transcript-store.js | 6000ms | Silence before summarizer fires |
| `SUMMARY_INTERVAL_MS` | transcript-store.js | 30000ms | Max time between auto-triggers |
| `WINDOW_SECONDS` | transcript-store.js | 180s | Rolling transcript window size |
| `MIN_NEW_CHARS` | transcript-store.js | 50 | Min new text before triggering |
| `MIN_GAP_MS` | summarizer.js | 15000ms | Rate limit between API calls |
| `_cooldownMs` | chime.js | 10000ms | Min gap between notification chimes |

---

## Future Directions

Ideas noted during development but deferred:

- **Speaker diarization** — distinguish the teacher from student chatter. Waiting for Gemini Live multi-speaker API improvements.
- **Persistence** — save/export session summaries and checklists. Currently everything is ephemeral.
- **Text-to-speech** — read summaries aloud for pre-literate students.
- **Parent/teacher dashboard** — view what instructions were surfaced during a class.
- **Offline fallback** — use Chrome's `SpeechRecognition` API when network is unavailable (lower quality, but better than nothing).
- **PWA** — add a service worker and manifest for installable app experience on Chromebooks.
