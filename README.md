
# Insight

Insight is a lightweight Electron desktop assistant for real-time help during meetings, interviews, and live sessions.

## What It Does

- Real-time transcription with ElevenLabs Scribe v2 Realtime
- Context-aware AI chat with Gemini
- Screenshot capture and analysis with Gemini vision
- Personality presets and custom personality prompts
- Always-on-top translucent window with keyboard control

## Requirements

- Node.js 18+
- npm
- Gemini API key
- ElevenLabs API key

Get keys:

- Gemini: https://makersuite.google.com/app/apikey
- ElevenLabs: https://elevenlabs.io/app/settings/api-keys

## Setup

```bash
git clone <https://github.com/jsydl/Insight>
cd insight
npm install
```

Create `.env` in the project root:

```env
GEMINI_API_KEY=your_gemini_key
ELEVENLABS_API_KEY=your_elevenlabs_key
# optional
ELEVENLABS_REALTIME_TOKEN=your_optional_realtime_token
```

## Run

Development:

```bash
npm start
```

Production build:

```bash
npm run dist
```

Packaged output is written to `release-build/`.

## Keyboard Shortcuts

- `Ctrl/Cmd + Shift + Space`: Center and show main window
- `Ctrl/Cmd + B`: Toggle main window
- `Ctrl/Cmd + R`: Reset interview/session context
- `Ctrl/Cmd + Left/Right/Up/Down`: Move window
- `Ctrl/Cmd + H`: Trigger screenshot capture

## UI Controls Reference

### Main Bubble Bar

- `⊕` button (left-click): Toggle show/hide for the main window.
- `Record` button (left-click): Start realtime transcription. While recording, the button changes to `Stop` and clicking again stops transcription.
- `Record` button (right-click): Clears transcript log, clears generated Q/A items, and clears transcription context in memory.
- Transcript arrow button `v/^` (left-click): Show or hide the transcript dropdown panel.
- Transcript arrow button `v/^` (right-click): Clear transcript log and clear transcription context.
- `Chat` button (left-click): Open or close the chat panel.
- `Chat` button (right-click): Clear chat messages and clear conversation history context.
- Red sign-out icon (left-click): Quit the app.

### Chat Panel (below bubble bar)

- Message input: Type a message for Gemini chat context.
- Send button or `Enter`: Send the current chat message.
- Screenshot button (picture icon): Capture screen and analyze it with Gemini Vision, then append the result to chat.

### Transcript and Q/A Panels

- Transcript dropdown: Shows latest committed transcript chunks plus current partial fragment.
- Q/A panel: Shows transcript-derived question/answer pairs when the model decides a transcript line is a real question.
- Q/A filtering behavior: Non-question transcript text is skipped automatically.

## Tray Icon Behavior

- Tray icon left-click: Toggle the main window visibility (preserves last position).
- Tray icon right-click: Open tray menu.
- Tray menu `Reset Position`: Re-center window to default position.
- Tray menu `Personality > <Preset>`: Apply selected personality preset.
- Tray menu `Personality > Custom...`: Open standalone personality editor window.
- Tray menu `Quit`: Exit the app.

## Personality Window (Custom...)

- Opens as a small standalone window from tray menu.
- `Chat` tab: Edit custom personality used by chat responses.
- `Transcription` tab: Edit custom personality used by transcription Q/A behavior.
- `Save Custom Personality`: Persists your custom text (it is paraphrased into a system prompt).

## Useful Commands

- `npm run clean`: Remove build artifacts
- `npm run build`: Build renderer
- `npm run build:electron`: Build Electron main/preload
- `npm run app:build`: Build full app package

## Packaged App Environment Loading

In production, `.env` is loaded from runtime candidates including:

- Next to the executable
- One folder above the executable
- `%APPDATA%/Insight/.env` (Windows)
- Resources/app paths

If realtime transcription fails in packaged builds, check:

- `%APPDATA%/Insight/log.txt`

## Troubleshooting

- App does not open in dev: check that port `5180` is free.
- Transcription unavailable: verify `ELEVENLABS_API_KEY` is set.
- Gemini errors: verify `GEMINI_API_KEY` is set and valid.

## License

ISC
