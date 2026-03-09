// ProcessingHelper.ts

import { AppState } from "./main"
import { LLMHelper } from "./LLMHelper"
import { ScreenshotHelper } from "./ScreenshotHelper"
import { app } from "electron"
import { spawn } from "child_process"
import WebSocket from "ws"
import os from "os"
import path from "path"
import fs from "fs"
import { appendAppLog } from "./logger"

type RealtimeTranscriptionStatus = "starting" | "ready" | "retrying" | "stopped" | "error"

// ── Personality system types ─────────────────────────────────────
export interface PersonalityScope {
  raw: string        // User-written personality text
  effective: string  // LLM-paraphrased version used in prompts
}

export interface PersonalitySettings {
  chat: PersonalityScope
  transcription: PersonalityScope
  activePreset: string | null  // null = custom
}

export interface PersonalityPreset {
  id: string
  label: string
  description: string
  chat: string
  transcription: string
}

export const PERSONALITY_PRESETS: PersonalityPreset[] = [
  {
    id: "interview",
    label: "Interview",
    description: "General interview prep — clear, actionable answers",
    chat: "You are an interview preparation assistant. Give answers the user can quickly read and say in their own words. No bullet points, no headers. Simple language. Start with the answer, no filler. Adapt to whatever interview domain the user is preparing for.",
    transcription: "You are filtering live audio from an interview preparation session. Answer genuine questions about interviews, professional topics, and domain knowledge. No filler openings. Resolve pronouns using context. SKIP casual small talk or off-topic content.",
  },
  {
    id: "concise",
    label: "Concise",
    description: "Premium concise — direct, clear, never terse or rude",
    chat: "Give clear, helpful answers that stay concise without sounding abrupt. Keep responses brief by default, but include a short explanation when it genuinely improves clarity. If a question is vague or too short, ask for clarification succinctly while still giving the most useful minimal answer possible. Avoid filler, unnecessary preamble, and overly long responses. Do not use bullet points or headings unless the user asks for them.",
    transcription: "Answer questions concisely and clearly. Never be terse or dismissive — always provide a minimal but useful answer. If the question is unclear, ask for clarification. Skip filler and preamble. Resolve pronouns using context. SKIP off-topic content.",
  },
  {
    id: "friendly",
    label: "Friendly",
    description: "Warm, encouraging tone — explains like a patient tutor",
    chat: "You are a friendly, patient assistant. Explain things clearly and encouragingly. Use simple analogies when helpful. Be warm but stay on topic.",
    transcription: "You are a friendly assistant listening to a session. Answer questions warmly and clearly. Use simple analogies. SKIP off-topic content.",
  },
]

export class ProcessingHelper {
  private appState: AppState
  private llmHelper: LLMHelper
  private screenshotHelper: ScreenshotHelper
  private realtimeSocket: WebSocket | null = null
  private reconnectAttempts: number = 0
  private readonly maxReconnectAttempts: number = 3

  // Real-time recording state
  private realtimeRecordingActive: boolean = false
  private realtimeCumulativeText: string = ""
  private emitSeq: number = 0
  private socketConnected: boolean = false

  // Conversation history for context
  private conversationHistory: Array<{ question: string; answer: string }> = []

  // Personality settings
  private personality: PersonalitySettings = {
    chat: { raw: "", effective: "" },
    transcription: { raw: "", effective: "" },
    activePreset: "interview",
  }
  private personalityFilePath: string = ""
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null

  // Active system prompt (transcription personality)
  private systemPrompt: string = PERSONALITY_PRESETS[0].transcription

  constructor(appState: AppState) {
    this.appState = appState
    this.llmHelper = new LLMHelper()
    this.screenshotHelper = new ScreenshotHelper(appState)

    this.personalityFilePath = path.join(app.getPath("userData"), "personality.json")
    this.loadPersonality()
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Private helpers
  // ═══════════════════════════════════════════════════════════════════

  private log(message: string): void {
    const line = `[ProcessingHelper] ${message}`
    appendAppLog(line)
  }

  private emitRealtimeStatus(status: RealtimeTranscriptionStatus, message: string): void {
    const win = this.appState.getMainWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send("realtime-transcription-status", {
        status,
        message,
        active: this.realtimeRecordingActive,
        connected: this.socketConnected,
        timestamp: Date.now(),
      })
    }
    this.log(`status=${status} message=${message}`)
  }

  /**
   * Spawn a process and wait for exit.
   * Hard-kills after timeoutMs to prevent the main process from hanging indefinitely
   * (critical for wasapi-loopback.exe in packaged EXE — if the binary stalls the
   * streaming loop must not block the Electron process).
   */
  private runProcess(
    cmd: string,
    args: string[],
    timeoutMs = 30_000,
  ): Promise<{ code: number; stderr: string }> {
    return new Promise((resolve, reject) => {
      const child = spawn(cmd, args)
      let stderr = ""

      const timer = setTimeout(() => {
        try { child.kill() } catch { /* ignore */ }
        reject(new Error(`Process timed out (${timeoutMs}ms): ${cmd}`))
      }, timeoutMs)

      child.stderr.on("data", (d: Buffer) => { stderr += d.toString() })
      child.on("error", (err: Error) => {
        clearTimeout(timer)
        reject(new Error(`spawn error (${cmd}): ${err.message}`))
      })
      child.on("exit", (code: number | null) => {
        clearTimeout(timer)
        resolve({ code: code ?? 1, stderr })
      })
    })
  }

  /**
   * Locate the WASAPI loopback helper exe.
   * Checks all likely locations: dev build, packaged resources, cwd.
   */
  private findLoopbackExe(): string | null {
    const candidates = [
      // Packaged EXE: electron-builder extraResources puts it here
      path.join((process as any).resourcesPath ?? "", "wasapi-loopback.exe"),
      // Dev: dist-electron/
      path.join(__dirname, "wasapi-loopback.exe"),
      // Dev fallback
      path.join(__dirname, "..", "electron", "wasapi-loopback.exe"),
      path.join(process.cwd(), "electron", "wasapi-loopback.exe"),
    ]
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) {
          this.log(`Found wasapi-loopback.exe at: ${p}`)
          return p
        }
      } catch { /* ignore */ }
    }
    this.log(`wasapi-loopback.exe not found; candidates=${candidates.join(" | ")}`)
    return null
  }

  /**
   * Convert a WASAPI float32 WAV buffer to int16 mono PCM at the native sample rate.
   * Returns the raw PCM buffer and the source sample rate.
   * Runs in ~1-3ms for 2s of 48kHz stereo audio.
   */
  private parseWavFloat32ToInt16Mono(wavBuffer: Buffer): { pcm: Buffer; sampleRate: number } | null {
    try {
      const fmtIdx = wavBuffer.indexOf(Buffer.from("fmt "))
      if (fmtIdx < 0) return null
      const channels = wavBuffer.readUInt16LE(fmtIdx + 10)
      const sampleRate = wavBuffer.readUInt32LE(fmtIdx + 12)

      const dataIdx = wavBuffer.indexOf(Buffer.from("data"))
      if (dataIdx < 0) return null
      const dataSize = wavBuffer.readUInt32LE(dataIdx + 4)
      const dataStart = dataIdx + 8
      const dataEnd = Math.min(wavBuffer.length, dataStart + dataSize)

      const totalFloats = Math.floor((dataEnd - dataStart) / 4)
      const monoSamples = Math.floor(totalFloats / channels)
      if (monoSamples <= 0) return null

      const out = Buffer.alloc(monoSamples * 2)
      for (let i = 0; i < monoSamples; i++) {
        let sum = 0
        for (let ch = 0; ch < channels; ch++) {
          const off = dataStart + (i * channels + ch) * 4
          if (off + 4 <= wavBuffer.length) {
            sum += wavBuffer.readFloatLE(off)
          }
        }
        const mono = sum / channels
        const clamped = Math.max(-32768, Math.min(32767, Math.round(mono * 32767)))
        out.writeInt16LE(clamped, i * 2)
      }
      return { pcm: out, sampleRate }
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : "unknown error"
      this.log(`WAV float32 to int16 conversion error: ${message}`)
      return null
    }
  }

  /**
   * Downsample int16 mono PCM from fromRate to toRate using simple averaging.
    * Used to resample native WASAPI audio (typically 48kHz) to 16kHz for the transcription adapter.
   * This runs in ~2-5ms for 2s of audio.
   */
  private downsamplePCM(buffer: Buffer, fromRate: number, toRate: number): Buffer {
    if (fromRate === toRate) return buffer
    const ratio = fromRate / toRate
    const inputSamples = Math.floor(buffer.length / 2)
    const outputSamples = Math.floor(inputSamples / ratio)
    if (outputSamples <= 0) return Buffer.alloc(0)

    const out = Buffer.alloc(outputSamples * 2)
    const iRatio = Math.ceil(ratio) // integer approximation for averaging window

    for (let i = 0; i < outputSamples; i++) {
      const start = Math.floor(i * ratio)
      const end = Math.min(start + iRatio, inputSamples)
      let sum = 0
      const count = end - start
      for (let j = start; j < end; j++) {
        sum += buffer.readInt16LE(j * 2)
      }
      const avg = count > 0 ? Math.round(sum / count) : 0
      out.writeInt16LE(Math.max(-32768, Math.min(32767, avg)), i * 2)
    }
    return out
  }

  private getElevenLabsApiKey(): string {
    return (process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY || "").trim()
  }

  private getElevenLabsRealtimeToken(): string {
    return (process.env.ELEVENLABS_REALTIME_TOKEN || "").trim()
  }

  private buildRealtimeUrl(): string {
    const params = new URLSearchParams({
      model_id: "scribe_v2_realtime",
      audio_format: "pcm_16000",
      include_timestamps: "true",
      commit_strategy: "vad",
      vad_threshold: "0.45",
      vad_silence_threshold_secs: "0.8",
      min_speech_duration_ms: "150",
      min_silence_duration_ms: "250",
    })

    const token = this.getElevenLabsRealtimeToken()
    if (token) {
      params.set("token", token)
    }

    return `wss://api.elevenlabs.io/v1/speech-to-text/realtime?${params.toString()}`
  }

  private extractTranscriptText(message: unknown): string {
    // ElevenLabs Scribe v2 Realtime uses `text` for both partial and committed
    const text =
      typeof message === "object" && message !== null && "text" in message
        ? (message as { text?: unknown }).text
        : undefined
    if (typeof text === "string" && text.trim()) return text.trim()
    return ""
  }

  private connectRealtimeSocket(
    emitRawFragment: (fragmentText: string, timestamp: number) => void,
    emitText: (chunkText: string) => void,
  ): Promise<void> {
    const url = this.buildRealtimeUrl()
    const apiKey = this.getElevenLabsApiKey()
    const headers: Record<string, string> = {}

    if (apiKey) {
      headers["xi-api-key"] = apiKey
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { headers })
      let opened = false

      ws.on("open", () => {
        this.realtimeSocket = ws
        this.socketConnected = true
        this.reconnectAttempts = 0
        opened = true
        this.emitRealtimeStatus("ready", "Connected to ElevenLabs realtime transcription")
        resolve()
      })

      ws.on("message", (payload: WebSocket.RawData) => {
        try {
          const data = typeof payload === "string" ? payload : payload.toString("utf-8")
          const msg = JSON.parse(data)
          
          const messageType = String(msg?.message_type || msg?.type || "")
          const text = this.extractTranscriptText(msg)

          if (!text) return

          if (messageType === "partial_transcript") {
            emitRawFragment(text, Date.now())
            return
          }

          if (
            messageType === "committed_transcript" ||
            messageType === "committed_transcript_with_timestamps" ||
            messageType === "final_transcript"
          ) {
            emitText(text)
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "unknown error"
          this.log(`Failed to parse ElevenLabs message: ${message}`)
        }
      })

      ws.on("close", (code: number, reason: Buffer) => {
        this.socketConnected = false
        const reasonText = reason?.toString("utf-8") || ""
        this.log(`ElevenLabs websocket closed (${code}) ${reasonText}`)
        if (this.realtimeSocket === ws) {
          this.realtimeSocket = null
        }

        if (this.realtimeRecordingActive && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts += 1
          const attempt = this.reconnectAttempts
          const delayMs = Math.min(1000 * attempt, 3000)
          this.emitRealtimeStatus("retrying", `Connection lost. Reconnecting (${attempt}/${this.maxReconnectAttempts})...`)
          if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer)
          }
          this.reconnectTimer = setTimeout(() => {
            if (!this.realtimeRecordingActive) return
            void this.connectRealtimeSocket(emitRawFragment, emitText).catch((err: unknown) => {
              const message = err instanceof Error ? err.message : "unknown error"
              this.log(`ElevenLabs reconnect failed: ${message}`)
            })
            this.reconnectTimer = null
          }, delayMs)
        } else if (this.realtimeRecordingActive) {
          this.stopRealtimeRecording("Lost connection to ElevenLabs realtime transcription", "error")
        }
      })

      ws.on("error", (err: Error) => {
        this.socketConnected = false
        this.log(`ElevenLabs websocket error: ${err.message}`)
        if (!opened) {
          reject(err)
        }
      })
    })
  }

  /**
   * Start real-time recording.
   *
    * Opens ElevenLabs Scribe v2 Realtime and streams WASAPI loopback chunks.
   */
  public async startRealtimeRecording(): Promise<void> {
    if (this.realtimeRecordingActive) return
    this.realtimeRecordingActive = true
    this.realtimeCumulativeText = ""
    this.emitSeq = 0
    this.emitRealtimeStatus("starting", "Starting realtime transcription...")

    if (!this.appState.getMainWindow()) {
      this.stopRealtimeRecording("Main window is not available for transcription", "error")
      return
    }

    const CHUNK_MS = 400

    // Emit committed transcript text to the renderer (stable display path)
    // Re-fetches mainWindow each call so reconnect doesn't use a stale reference
    const emitText = (chunkText: string) => {
      if (!this.realtimeRecordingActive) return
      if (!chunkText?.trim()) return
      const text = chunkText.trim()

      this.realtimeCumulativeText = this.realtimeCumulativeText
        ? `${this.realtimeCumulativeText} ${text}`
        : text
      const win = this.appState.getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send("realtime-transcript-update", {
          text,
          cumulative: this.realtimeCumulativeText,
          isFinal: true,
          timestamp: Date.now(),
          seq: ++this.emitSeq,
        })
      }
    }

    // Emit a raw fragment to the renderer (transient partial path)
    // Re-fetches mainWindow each call so reconnect doesn't use a stale reference
    const emitRawFragment = (fragmentText: string, timestamp: number) => {
      if (!this.realtimeRecordingActive) return
      if (!fragmentText) return
      const win = this.appState.getMainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send("realtime-raw-fragment", {
          text: fragmentText,
          seq: ++this.emitSeq,
          timestamp,
        })
      }
    }

    try {
      const hasApiKey = this.getElevenLabsApiKey().length > 0
      if (!hasApiKey) {
        throw new Error("Missing ELEVENLABS_API_KEY")
      }

      await this.connectRealtimeSocket(emitRawFragment, emitText)
      this.log("Using transcription backend: elevenlabs_scribe_v2_realtime")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error"
      this.stopRealtimeRecording(
        `Failed to start transcription: ${message}`,
        "error",
      )
      return
    }

    const streamingLoop = async () => {
      while (this.realtimeRecordingActive) {
        try {
          const loopbackExe = this.findLoopbackExe()
          if (!loopbackExe) {
            this.stopRealtimeRecording("Audio capture helper was not found in the packaged app", "error")
            break
          }

          const tempRaw = path.join(os.tmpdir(), `sys-audio-realtime-${Date.now()}.wav`)
          await this.runProcess(loopbackExe, [tempRaw, String(CHUNK_MS)], CHUNK_MS + 5_000)
          if (!this.realtimeRecordingActive) {
            fs.promises.unlink(tempRaw).catch(() => {})
            break
          }

          const wavBuffer = await fs.promises.readFile(tempRaw)
          fs.promises.unlink(tempRaw).catch(() => {})

          const parsed = this.parseWavFloat32ToInt16Mono(wavBuffer)
          if (parsed && parsed.pcm.length > 0) {
            const pcm16k = this.downsamplePCM(parsed.pcm, parsed.sampleRate, 16000)
            if (pcm16k.length > 0 && this.realtimeSocket?.readyState === WebSocket.OPEN) {
              const chunk = {
                // ElevenLabs Scribe v2 Realtime publish message.
                message_type: "input_audio_chunk",
                audio_base_64: pcm16k.toString("base64"),
                sample_rate: 16000,
              }
              this.realtimeSocket.send(JSON.stringify(chunk))
            }
          }
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "unknown error"
          this.log(`Realtime capture loop error: ${message}`)
          if (!this.realtimeRecordingActive) {
            break
          }
          await new Promise(r => setTimeout(r, 500))
        }
      }
    }

    void streamingLoop()
  }

  /** Stop real-time recording and close the WebSocket. */
  public stopRealtimeRecording(
    message = "Stopped realtime transcription.",
    status: RealtimeTranscriptionStatus = "stopped",
  ): void {
    const shouldEmit = this.realtimeRecordingActive || this.socketConnected || this.realtimeSocket !== null || status === "error"
    this.realtimeRecordingActive = false
    this.socketConnected = false
    this.reconnectAttempts = 0
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    const ws = this.realtimeSocket
    this.realtimeSocket = null
    if (ws) {
      try {
        // flush_audio tells ElevenLabs to commit any pending speech before closing.
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ flush_audio: {} }))
        }
        // terminate() works in any readyState (CONNECTING, OPEN, CLOSING)
        // unlike close() which is a no-op on CONNECTING sockets
        ws.terminate()
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "unknown error"
        this.log(`Failed to close ElevenLabs websocket: ${message}`)
      }
    }
    if (shouldEmit) {
      this.emitRealtimeStatus(status, message)
    } else {
      this.log(message)
    }
  }

  public isRealtimeRecording(): boolean {
    return this.realtimeRecordingActive
  }

  public getCumulativeTranscript(): string {
    return this.realtimeCumulativeText
  }

  public getLLMHelper(): LLMHelper {
    return this.llmHelper
  }

  public getTranscriptionStatus(): {
    available: boolean
    mode: string
    connected: boolean
    message: string
  } {
    const hasCredentials = this.getElevenLabsApiKey().length > 0
    return {
      available: hasCredentials,
      mode: "elevenlabs_scribe_v2_realtime",
      connected: this.socketConnected,
      message: hasCredentials
        ? "Realtime transcription configured for ElevenLabs Scribe v2 Realtime"
        : "Set ELEVENLABS_API_KEY to enable realtime transcription",
    }
  }

  public getScreenshotHelper(): ScreenshotHelper {
    return this.screenshotHelper
  }

  public setSystemPrompt(prompt: string): void {
    this.systemPrompt = prompt
  }

  public getSystemPrompt(): string {
    return this.systemPrompt
  }

  public getConversationHistory(): Array<{ question: string; answer: string }> {
    return this.conversationHistory
  }

  public addToConversationHistory(question: string, answer: string): void {
    this.conversationHistory.push({ question, answer })
    if (this.conversationHistory.length > 40) {
      this.conversationHistory = this.conversationHistory.slice(-40)
    }
  }

  public clearConversationHistory(): void {
    this.conversationHistory = []
  }

  public resetInterview(): void {
    this.clearConversationHistory()
  }

  public clearRealtimeTranscript(): void {
    this.realtimeCumulativeText = ""
    this.emitSeq = 0
  }

  // ═══════════════════════════════════════════════════════════════════
  //  Personality system
  // ═══════════════════════════════════════════════════════════════════

  private loadPersonality(): void {
    try {
      if (fs.existsSync(this.personalityFilePath)) {
        const data = JSON.parse(fs.readFileSync(this.personalityFilePath, "utf-8")) as PersonalitySettings
        this.personality = data
        this.applyPersonality()
        this.log(`Loaded personality: ${data.activePreset || "custom"}`)
      } else {
        this.applyPreset("interview")
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error"
      this.log(`Failed to load personality, using default: ${message}`)
      this.applyPreset("interview")
    }
  }

  private savePersonality(): void {
    try {
      fs.writeFileSync(this.personalityFilePath, JSON.stringify(this.personality, null, 2), "utf-8")
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error"
      this.log(`Failed to save personality: ${message}`)
    }
  }

  private applyPersonality(): void {
    const preset = this.personality.activePreset
      ? PERSONALITY_PRESETS.find(p => p.id === this.personality.activePreset)
      : null

    if (preset) {
      this.systemPrompt = preset.transcription
      this.personality.chat.effective = preset.chat
      this.personality.transcription.effective = preset.transcription
    } else {
      this.systemPrompt = this.personality.transcription.effective || this.personality.transcription.raw || PERSONALITY_PRESETS[0].transcription
      this.personality.chat.effective = this.personality.chat.effective || this.personality.chat.raw || PERSONALITY_PRESETS[0].chat
    }
  }

  public applyPreset(presetId: string): void {
    const preset = PERSONALITY_PRESETS.find(p => p.id === presetId)
    if (!preset) return
    this.personality.activePreset = presetId
    this.personality.chat.raw = preset.chat
    this.personality.chat.effective = preset.chat
    this.personality.transcription.raw = preset.transcription
    this.personality.transcription.effective = preset.transcription
    this.applyPersonality()
    this.savePersonality()
  }

  /**
   * Set custom personality text and paraphrase it via Gemini.
   */
  public async setCustomPersonality(scope: "chat" | "transcription", rawText: string): Promise<string> {
    this.personality.activePreset = null
    this.personality[scope].raw = rawText

    try {
      const scopeLabel = scope === "chat" ? "chat assistant" : "live transcription filter"
      const paraphrasePrompt =
        `Convert the following personality description into a tightly written system prompt for an AI ${scopeLabel}.\n` +
        `Keep the core tone, constraints, and intent. Make it a clear, imperative instruction set (2–4 sentences max).\n` +
        `Do NOT add capabilities the user didn't request. Return ONLY the rewritten prompt — no labels, no quotes, no explanation.\n\n` +
        `Personality description: "${rawText}"`
      const effective = await this.llmHelper.chat(paraphrasePrompt)
      this.personality[scope].effective = effective.trim()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error"
      this.log(`Paraphrase failed, using raw text: ${message}`)
      this.personality[scope].effective = rawText
    }

    this.applyPersonality()
    this.savePersonality()
    return this.personality[scope].effective
  }

  public getPersonality(): PersonalitySettings {
    return { ...this.personality }
  }

  public getChatPersonality(): string {
    return this.personality.chat.effective || PERSONALITY_PRESETS[0].chat
  }

  public getTranscriptionPersonality(): string {
    return this.personality.transcription.effective || PERSONALITY_PRESETS[0].transcription
  }
}
