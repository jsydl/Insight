// LLMHelper.ts — Gemini-only AI helper.
// Text / multimodal model: gemini-2.5-flash-lite
// Chat, image analysis, and personality paraphrase flows go through this helper.

import { GoogleGenAI, createPartFromBase64 } from "@google/genai"
import type { Content, GenerateContentResponse } from "@google/genai"

// ── Configuration ─────────────────────────────────────────────────
const GEMINI_TEXT_MODEL = "gemini-2.5-flash-lite"
const MAX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 1500

function extractErrorDetails(err: unknown): { status: number | string | undefined; message: string } {
  if (typeof err === "object" && err !== null) {
    const maybe = err as {
      status?: number
      httpStatusCode?: number
      code?: string | number
      message?: string
    }
    return {
      status: maybe.status ?? maybe.httpStatusCode ?? maybe.code,
      message: maybe.message ?? "",
    }
  }
  return { status: undefined, message: "" }
}

export class LLMHelper {
  private ai: GoogleGenAI

  constructor() {
    const geminiApiKey = (process.env.GEMINI_API_KEY || "").trim()

    if (!geminiApiKey) {
      throw new Error("Missing GEMINI_API_KEY in environment. Please add it to your .env file")
    }
    this.ai = new GoogleGenAI({ apiKey: geminiApiKey })
  }

  // ── Core generation wrapper ────────────────────────────────────

  /** Call Gemini generateContent with retry for transient 503/overload errors. */
  private async generate(contents: string | Content[]): Promise<string> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response: GenerateContentResponse = await this.ai.models.generateContent({
          model: GEMINI_TEXT_MODEL,
          contents,
        })
        return response.text ?? ""
      } catch (err: unknown) {
        const { status, message } = extractErrorDetails(err)
        const isOverload = status === 503 || status === 429 ||
          /unavailable|overloaded|high demand|resource.*exhausted/i.test(message)
        if (isOverload && attempt < MAX_RETRIES) {
          const delay = (attempt + 1) * RETRY_BASE_DELAY_MS // 1.5s, 3s
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        throw err
      }
    }
    throw new Error("Unreachable")
  }

  // ── Chat ───────────────────────────────────────────────────────

  /**
   * Send a chat message with optional prior conversation history.
   * History is provided as Q&A pairs and converted to Gemini multi-turn format.
   */
  public async chatWithGemini(
    message: string,
    conversationHistory?: Array<{ question: string; answer: string }>,
  ): Promise<string> {
    try {
      if (conversationHistory && conversationHistory.length > 0) {
        const contents: Content[] = []
        for (const entry of conversationHistory) {
          contents.push({ role: "user", parts: [{ text: entry.question }] })
          contents.push({ role: "model", parts: [{ text: entry.answer }] })
        }
        contents.push({ role: "user", parts: [{ text: message }] })
        return await this.generate(contents)
      }
      return await this.generate(message)
    } catch (error) {
      throw error
    }
  }

  /** Simple single-turn text generation. */
  public async chat(message: string): Promise<string> {
    return this.chatWithGemini(message)
  }

  // ── Image analysis ─────────────────────────────────────────────

  /**
   * Analyze a screenshot image using Gemini vision.
   * All image analysis routes through Gemini — no local fallback.
   */
  public async analyzeImage(
    base64Png: string,
    userPrompt?: string,
    onProgress?: (stage: string, detail?: string) => void,
  ): Promise<string> {
    if (!base64Png || base64Png.length < 100) {
      throw new Error("Screenshot data is empty or too small — capture may have failed.")
    }

    const prompt = userPrompt ||
      "Analyze this screenshot and respond as follows:\n" +
      "1. If you see questions, problems, exercises, or tasks: solve or answer each one directly and completely.\n" +
      "2. If you see code: identify any bugs or logical errors, explain the code's behaviour, and suggest specific improvements with corrected snippets where applicable.\n" +
      "3. If you see diagrams, charts, or structured data: extract and interpret the key information clearly.\n" +
      "4. If you see general text: summarize the essential content accurately and concisely.\n" +
      "Rules: Do NOT describe what you see ('I can see a web page\u2026'). Go straight to the substance. " +
      "Be as thorough as the content demands. Use structured output (numbered lists, code blocks) where it aids clarity."

    onProgress?.("analyzing", "Using Gemini vision")

    const imagePart = createPartFromBase64(base64Png, "image/png")
    const contents: Content[] = [{ role: "user", parts: [{ text: prompt }, imagePart] }]
    const text = await this.generate(contents)
    return text
  }

  // ── Connection / diagnostics ───────────────────────────────────

  public getCurrentModel(): string {
    return GEMINI_TEXT_MODEL
  }

  public getCurrentProvider(): "gemini" {
    return "gemini"
  }
}
