// LLMHelper.ts - Gemini-only AI helper.
// Interactive chat / Q&A / image analysis use Gemini 2.5 Flash with dynamic thinking.
// Lightweight prompt paraphrase stays on Gemini 2.5 Flash Lite.

import { GoogleGenAI, createPartFromBase64 } from "@google/genai"
import type { Content, GenerateContentConfig, GenerateContentResponse } from "@google/genai"

const GEMINI_INTERACTIVE_MODEL = "gemini-2.5-flash"
const GEMINI_LITE_MODEL = "gemini-2.5-flash-lite"
const GEMINI_INTERACTIVE_CONFIG: GenerateContentConfig = {
  thinkingConfig: {
    thinkingBudget: -1,
  },
}
const MAX_RETRIES = 2
const RETRY_BASE_DELAY_MS = 1500

type GenerateOptions = {
  model: string
  config?: GenerateContentConfig
}

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

  /** Call Gemini generateContent with retry for transient 503/overload errors. */
  private async generate(contents: string | Content[], options: GenerateOptions): Promise<string> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response: GenerateContentResponse = await this.ai.models.generateContent({
          model: options.model,
          contents,
          config: options.config,
        })
        return response.text ?? ""
      } catch (err: unknown) {
        const { status, message } = extractErrorDetails(err)
        const isOverload = status === 503 || status === 429 ||
          /unavailable|overloaded|high demand|resource.*exhausted/i.test(message)
        if (isOverload && attempt < MAX_RETRIES) {
          const delay = (attempt + 1) * RETRY_BASE_DELAY_MS
          await new Promise(r => setTimeout(r, delay))
          continue
        }
        throw err
      }
    }
    throw new Error("Unreachable")
  }

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
        return await this.generate(contents, {
          model: GEMINI_INTERACTIVE_MODEL,
          config: GEMINI_INTERACTIVE_CONFIG,
        })
      }
      return await this.generate(message, {
        model: GEMINI_INTERACTIVE_MODEL,
        config: GEMINI_INTERACTIVE_CONFIG,
      })
    } catch (error) {
      throw error
    }
  }

  /** Simple single-turn text generation for interactive flows. */
  public async chat(message: string): Promise<string> {
    return this.chatWithGemini(message)
  }

  /** Lightweight single-turn generation for non-interactive helper flows. */
  public async chatLite(message: string): Promise<string> {
    return this.generate(message, { model: GEMINI_LITE_MODEL })
  }

  /**
   * Analyze a screenshot image using Gemini vision.
   * All image analysis routes through Gemini - no local fallback.
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
      "Rules: Do NOT describe what you see ('I can see a web page…'). Go straight to the substance. " +
      "Be as thorough as the content demands. Use Markdown formatting when it improves readability."

    onProgress?.("analyzing", "Using Gemini vision")

    const imagePart = createPartFromBase64(base64Png, "image/png")
    const contents: Content[] = [{ role: "user", parts: [{ text: prompt }, imagePart] }]
    return this.generate(contents, {
      model: GEMINI_INTERACTIVE_MODEL,
      config: GEMINI_INTERACTIVE_CONFIG,
    })
  }

  public getCurrentModel(): string {
    return `${GEMINI_INTERACTIVE_MODEL} (chat/q&a/image, dynamic thinking), ${GEMINI_LITE_MODEL} (personality paraphrase)`
  }

  public getCurrentProvider(): "gemini" {
    return "gemini"
  }
}
