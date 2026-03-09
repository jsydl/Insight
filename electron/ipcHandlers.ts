// ipcHandlers.ts

import { ipcMain, app } from "electron"
import { AppState } from "./main"
import { PERSONALITY_PRESETS } from "./ProcessingHelper"
import { appendAppLog } from "./logger"

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function logError(prefix: string, error: unknown): void {
  appendAppLog(`[ipcHandlers] ${prefix}: ${errorMessage(error)}`)
}

export function initializeIpcHandlers(appState: AppState): void {
  // Rolling Q&A context — shared between the answer-question and gemini-chat flows
  let recentQAContext: Array<{ q: string; a: string }> = []

  ipcMain.handle(
    "update-content-dimensions",
    async (_event, { width, height }: { width: number; height: number }) => {
      if (width && height) appState.setWindowDimensions(width, height)
    },
  )

  ipcMain.handle(
    "set-window-hit-regions",
    async (_event, regions: Array<{ x: number; y: number; width: number; height: number }>) => {
      appState.setHitRegions(Array.isArray(regions) ? regions : [])
    },
  )

  ipcMain.handle("toggle-window", async () => {
    appState.toggleMainWindow()
  })

  // ── LLM Chat handler ──────────────────────────────────────────
  // Provides personality + rolling Q&A context + live transcript to Gemini.
  ipcMain.handle("gemini-chat", async (_event, message: string) => {
    try {
      const conversationHistory = appState.processingHelper.getConversationHistory()
      const chatPersonality = appState.processingHelper.getChatPersonality()
      const cumulativeTranscript = appState.processingHelper.getCumulativeTranscript()

      // Build a focused, non-repetitive context block
      const parts: string[] = []

      // 1. Personality / role framing
      parts.push(chatPersonality)

      // 2. Recent answered Q&A (resolve follow-ups and pronouns)
      if (recentQAContext.length > 0) {
        const recent = recentQAContext
          .slice(-5)
          .map((c, i) => `[${i + 1}] Q: ${c.q}\n    A: ${c.a}`)
          .join("\n")
        parts.push(`Recent Q&A this session:\n${recent}`)
      }

      // 3. Session transcript — last 1500 chars (resolve "it", "that", "they")
      if (cumulativeTranscript) {
        const excerpt =
          cumulativeTranscript.length > 1500
            ? "\u2026" + cumulativeTranscript.slice(-1500)
            : cumulativeTranscript
        parts.push(`Live session transcript (context only):\n"${excerpt}"`)
      }

      // 4. The user's message
      parts.push(
        `User: ${message}\n\n` +
        `Respond directly and thoroughly. Resolve any pronouns or references using the context above. ` +
        `No preamble. No restating the question.`,
      )

      const prompt = parts.join("\n\n---\n\n")

      const result = await appState.processingHelper.getLLMHelper().chatWithGemini(
        prompt,
        conversationHistory.slice(-10),
      )

      appState.processingHelper.addToConversationHistory(message, result)
      return result
    } catch (error: unknown) {
      logError("Error in gemini-chat handler", error)
      throw error
    }
  })

  ipcMain.handle("quit-app", () => {
    app.quit()
    setTimeout(() => process.exit(0), 500)
  })

  ipcMain.handle("close-personality-window", () => {
    appState.destroyPersonalityWindow()
  })

  ipcMain.handle("move-window-left", async () => appState.moveWindowLeft())
  ipcMain.handle("move-window-right", async () => appState.moveWindowRight())
  ipcMain.handle("move-window-up", async () => appState.moveWindowUp())
  ipcMain.handle("move-window-down", async () => appState.moveWindowDown())
  ipcMain.handle("center-and-show-window", async () => appState.centerAndShowWindow())

  // ── Model config ──────────────────────────────────────────────
  ipcMain.handle("get-current-llm-config", async () => {
    const llmHelper = appState.processingHelper.getLLMHelper()
    return {
      provider: llmHelper.getCurrentProvider(),
      model: llmHelper.getCurrentModel(),
    }
  })

  ipcMain.handle("get-transcription-status", async () => {
    const status = appState.processingHelper.getTranscriptionStatus()
    return {
      available: status.available,
      mode: status.mode,
      connected: status.connected,
      message: status.message,
    }
  })

  // ── Personality and context management ───────────────────────
  ipcMain.handle("set-system-prompt", async (_event, prompt: string) => {
    try {
      appState.processingHelper.setSystemPrompt(prompt)
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle("get-system-prompt", async () => {
    try {
      return { success: true, prompt: appState.processingHelper.getSystemPrompt() }
    } catch (error: unknown) {
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle("get-conversation-history", async () => {
    try {
      return { success: true, history: appState.processingHelper.getConversationHistory() }
    } catch (error: unknown) {
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle("clear-conversation-history", async () => {
    try {
      appState.processingHelper.clearConversationHistory()
      recentQAContext = []
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle("reset-interview", async () => {
    try {
      appState.processingHelper.resetInterview()
      recentQAContext = []
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle("clear-transcription-context", async () => {
    try {
      appState.processingHelper.clearRealtimeTranscript()
      recentQAContext = []
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: errorMessage(error) }
    }
  })

  // ── Personality presets ───────────────────────────────────────
  ipcMain.handle("get-personality-presets", async () => PERSONALITY_PRESETS)

  ipcMain.handle("get-personality", async () => {
    try {
      return { success: true, personality: appState.processingHelper.getPersonality() }
    } catch (error: unknown) {
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle("apply-personality-preset", async (_event, presetId: string) => {
    try {
      appState.processingHelper.applyPreset(presetId)
      return { success: true }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  ipcMain.handle("set-custom-personality", async (_event, scope: "chat" | "transcription", rawText: string) => {
    try {
      const effective = await appState.processingHelper.setCustomPersonality(scope, rawText)
      return { success: true, effective }
    } catch (error: any) {
      return { success: false, error: error.message }
    }
  })

  // ── Answer-question handler ───────────────────────────────────
  //
  // Receives a live transcript chunk. Gemini decides whether it is a genuine
  // academic question (answers it) or filler/non-academic (returns skipped=true).
  //
  ipcMain.handle("answer-question", async (_event, text: string) => {
    try {
      const trimmed = text.trim()

      // Guard: skip only truly empty input. LLM decides all non-empty cases.
      if (!trimmed) {
        return { success: true, answer: null, skipped: true }
      }

      const llmHelper = appState.processingHelper.getLLMHelper()
      const transcriptionPersonality = appState.processingHelper.getTranscriptionPersonality()
      const cumulativeTranscript = appState.processingHelper.getCumulativeTranscript()

      const parts: string[] = []

      // Role + filtering instructions
      parts.push(transcriptionPersonality)

      // Rolling Q&A context (resolve elliptical follow-ups)
      if (recentQAContext.length > 0) {
        const recent = recentQAContext
          .slice(-5)
          .map((c, i) => `[${i + 1}] Q: ${c.q}\n    A: ${c.a}`)
          .join("\n")
        parts.push(`Recent Q&A this session (use to resolve "it", "that", "why?" etc.):\n${recent}`)
      }

      // Session transcript context
      if (cumulativeTranscript) {
        const excerpt =
          cumulativeTranscript.length > 1500
            ? "\u2026" + cumulativeTranscript.slice(-1500)
            : cumulativeTranscript
        parts.push(`Session transcript (resolve pronouns using this):\n"${excerpt}"`)
      }

      // Decision rules — personality-aware
      parts.push(
        `DECISION RULES — follow exactly:\n` +
        `1. Answer ONLY if the transcript is asking for an answer: a direct question, an explicit request for help/explanation/action, ` +
        `or a clearly elliptical follow-up that still asks for an answer using recent context.\n` +
        `2. Treat elliptical follow-ups ("why?", "and X?", "explain more", "how?") as referring to the most recent relevant topic.\n` +
        `3. Return exactly SKIP for anything that is not asking for an answer, including plain statements, narration, observations, commentary, ` +
        `greetings, filler, incomplete thoughts, or topic mentions without a request.\n` +
        `4. Keep this boundary strict: do not answer unless a real question/request is present.\n` +
        `5. If you answer, answer completely; do not truncate a multi-part question.\n\n` +
        `Transcript: "${trimmed}"\n\n` +
        `Your response (full answer OR the single word SKIP):`,
      )

      const prompt = parts.join("\n\n---\n\n")
      const answer = await llmHelper.chat(prompt)
      const cleaned = answer.trim()

      // SKIP detection: explicit word or verbose rejection paraphrase
      const isSkip = /^\[?skip\]?\s*(?:[^a-z0-9]|$)/i.test(cleaned)
      const looksLikeRejection =
        !isSkip &&
        /\b(not\s+related\s+to|doesn'?t\s+(appear|seem)\s+to\s+be|outside\s+(the\s+)?scope|this\s+(statement|question|text)\s+(is\s+not|appears?\s+unrelated)|cannot\s+provide|i\s+can(?:'?t| ?not)\s+(?:answer|assist\s+with)\s+(?:this|that)\b)/i.test(
          cleaned,
        )

      if (isSkip || looksLikeRejection) {
        return { success: true, answer: null, skipped: true }
      }

      recentQAContext.push({ q: trimmed, a: cleaned })
      if (recentQAContext.length > 40) recentQAContext.shift()

      return { success: true, answer: cleaned, skipped: false }
    } catch (error: unknown) {
      logError("Error answering question", error)
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle("start-realtime-transcription", async () => {
    try {
      // IMPORTANT: do NOT await startRealtimeRecording() here.
      // It opens the realtime websocket session and then enters an audio-capture loop.
      // Awaiting it from the IPC handler would block all
      // renderer IPC calls for that duration — Windows then marks the app as
      // "not responding" and the packaged EXE appears to freeze.
      // Fire-and-forget; errors are logged inside ProcessingHelper.
      void appState.processingHelper.startRealtimeRecording().catch((err: unknown) => {
        logError("startRealtimeRecording unhandled error", err)
      })
      return { success: true }
    } catch (error: unknown) {
      logError("Error starting realtime transcription", error)
      return { success: false, error: errorMessage(error) }
    }
  })

  ipcMain.handle("stop-realtime-transcription", async () => {
    try {
      appState.processingHelper.stopRealtimeRecording()
      return { success: true }
    } catch (error: unknown) {
      return { success: false, error: errorMessage(error) }
    }
  })

  // ── Screenshot capture + Gemini vision analysis ───────────────
  ipcMain.handle("capture-and-analyze-screenshot", async () => {
    const mainWindow = appState.getMainWindow()
    const captureId = Date.now().toString()

    const emitProgress = (stage: string, progress: number, detail?: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("screenshot:status", { id: captureId, stage, progress, detail })
      }
    }

    try {
      emitProgress("uploading", 0, "Capturing screen\u2026")

      const screenshotHelper = appState.processingHelper.getScreenshotHelper()
      const base64Png = await screenshotHelper.captureScreen()

      emitProgress("uploading", 30, "Screenshot captured")
      emitProgress("analyzing", 40, "Analyzing with Gemini\u2026")

      const chatPersonality = appState.processingHelper.getChatPersonality()
      const cumulativeTranscript = appState.processingHelper.getCumulativeTranscript()

      // Build a context-aware vision prompt
      let contextHint = ""
      if (cumulativeTranscript) {
        const excerpt =
          cumulativeTranscript.length > 1500
            ? "…" + cumulativeTranscript.slice(-1500)
            : cumulativeTranscript
        contextHint = `\n\nSession context (use to interpret the screenshot if relevant):\n"${excerpt}"`
      }

      const visionPrompt = chatPersonality
        ? `${chatPersonality}${contextHint}\n\n` +
          `Analyze this screenshot and do the following:\n` +
          `1. If there are questions, problems, exercises, or tasks — solve or answer them directly and completely.\n` +
          `2. If there is code — identify bugs, explain the logic, or suggest concrete improvements.\n` +
          `3. If there is text content — extract and clearly present the key information.\n` +
          `4. Do NOT describe or narrate what you see. Go straight to the answer or extracted content.\n` +
          `Use the session context above only if it helps interpret the screenshot. Be thorough but focused. No filler.`
        : undefined

      const llmHelper = appState.processingHelper.getLLMHelper()
      const analysis = await llmHelper.analyzeImage(base64Png, visionPrompt, (stage, detail) => {
        emitProgress(stage, 60, detail)
      })

      emitProgress("done", 100, "Analysis complete")
      return { success: true, analysis }
    } catch (error: unknown) {
      const message = errorMessage(error) || "Screenshot analysis failed"
      logError("Error in capture-and-analyze-screenshot", error)
      emitProgress("failed", 0, message)
      return { success: false, error: message }
    }
  })
}
