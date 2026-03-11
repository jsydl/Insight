
# Insight

![Cluely](https://img.shields.io/badge/Cluely-111111?style=square)
![Electron](https://img.shields.io/badge/Electron-47848F?style=square&logo=electron&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?style=square&logo=react&logoColor=black)
![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?style=square&logo=typescript&logoColor=black)
![Vite](https://img.shields.io/badge/Vite-5-646CFF?style=square&logo=vite&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-3-06B6D4?style=square&logo=tailwindcss&logoColor=white)
![Gemini](https://img.shields.io/badge/Gemini-2.5_Flash_Lite-4285F4?style=square&logo=google&logoColor=white)
![ElevenLabs](https://img.shields.io/badge/ElevenLabs-Scribe_v2_Realtime-111111?style=square)

Insight is a lightweight Electron desktop assistant for real-time help during meetings, interviews, and live sessions. Heavily reworked version based on https://github.com/Prat011/free-cluely.

## What It Does

- Always-on-top translucent bubble window
- Real-time transcription with ElevenLabs Scribe v2 Realtime
- Chat and screenshot analysis with Gemini 2.5 Flash Lite
- Personality presets and custom personality prompts

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
git clone https://github.com/jsydl/Insight
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
- `Ctrl/Cmd + H`: Screenshot analysis

## UI Controls Reference

### Main Bubble Bar

- `⊕` button (left-click): Toggle show/hide the bubble.
- `Record` button (left-click): Start realtime transcription. While recording, clicking again stops transcription.
- `Record` button (right-click): Clears transcript log, clears generated Q/A items, and clears transcription context in memory.
- Transcript arrow button (left-click): Show or hide the transcript dropdown panel.
- Transcript arrow button (right-click): Clear transcript log and clear transcription context.
- `Chat` button (left-click): Open or close the chat panel.
- `Chat` button (right-click): Clear chat messages and clear conversation history context.
- Red exit icon (left-click): Quit the app.

### Chat Panel

- Message input: Type a message for Gemini chat.
- Send button or `Enter`: Send the current chat message.
- Screenshot button: Capture screen and analyze it with Gemini 2.5 Flash Lite.

### Transcript and Q/A Panels

- Transcript dropdown: Shows latest committed transcript chunks plus current partial fragment.
- Q/A panel: Shows transcript-derived question/answer pairs when the model decides a transcript line is a real question.
- Q/A filtering behavior: Non-question transcript text is skipped automatically.

## Tray Icon Behavior

- Tray icon left-click: Toggle the main window visibility.
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

## Troubleshooting

Check the app log first:

- Windows log file: `C:\Users\<YourUser>\AppData\Roaming\Insight\log.txt`

Common issues:

- Gemini chat or screenshot analysis fails:
  - Verify `GEMINI_API_KEY` is present in your `.env`
  - Typical error: `Missing GEMINI_API_KEY in environment. Please add it to your .env file`

- Transcription is unavailable or fails to start:
  - Verify `ELEVENLABS_API_KEY` is present in your `.env`
  - Typical error: `Missing ELEVENLABS_API_KEY`
  - The app may also log: `Failed to start transcription: ...`

- Realtime transcription disconnects or stops unexpectedly:
  - Check the log for:
    - `ElevenLabs websocket error: ...`
    - `ElevenLabs websocket closed (...)`
    - `Lost connection to ElevenLabs realtime transcription`
    - `ElevenLabs reconnect failed: ...`

- Packaged app cannot capture/transcribe system audio:
  - Check the log for:
    - `Audio capture helper was not found in the packaged app`
    - `Realtime capture loop error: ...`
    - `wasapi-loopback.exe not found; candidates=...`

- Screenshot capture or analysis fails:
  - Check the log for:
    - `Error in capture-and-analyze-screenshot: ...`
  - Gemini may also return:
    - `Screenshot data is empty or too small — capture may have failed.`

- Custom personality does not save or load:
  - Check the log for:
    - `Failed to save personality: ...`
    - `Failed to load personality, using default: ...`

- Window/tray/startup behavior seems wrong:
  - Check the log for:
    - `[Startup] Registered Startup Apps entry (disabled by default)`
    - `[Tray] ...`
    - `[WindowHelper] ...`

- `.env` is not being picked up in the packaged app:
  - The app logs all searched runtime `.env` locations
  - Check the log for:
    - `[ENV] searched=...`
    - `[ENV] loaded=...`

If something still fails, open the log file and look for entries from:

- `[App]`
- `[ipcHandlers]`
- `[ProcessingHelper]`
- `[WindowHelper]`
- `[Shortcuts]`
- `[ENV]`

## License

ISC
