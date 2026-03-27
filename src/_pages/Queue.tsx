import React, { useState, useEffect, useRef } from "react"
import QueueCommands from "../components/Queue/QueueCommands"
import MarkdownMessage from "../components/MarkdownMessage"

// ── Screenshot status types ──────────────────────────────────────
type ScreenshotStage = "uploading" | "analyzing" | "done" | "failed"
interface ScreenshotStatus {
  id: string
  stage: ScreenshotStage
  progress: number      // 0-100
  detail?: string
  analysis?: string     // filled on success
}

type ScreenshotAnalyzeResult = {
  success: boolean
  analysis?: string
  screenshotBase64?: string
  error?: string
}

type ChatMessage =
  | { kind: "text"; role: "user" | "gemini"; text: string }
  | { kind: "image"; role: "user"; src: string; alt: string }

const createClientId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const Queue: React.FC = () => {
  const [chatInput, setChatInput] = useState("")
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([])
  const [chatLoading, setChatLoading] = useState(false)
  const [isChatOpen, setIsChatOpen] = useState(false)
  const chatInputRef = useRef<HTMLInputElement>(null)
  const chatEndRef = useRef<HTMLDivElement>(null)

  // Screenshot status — one at a time, ephemeral
  const [screenshotStatus, setScreenshotStatus] = useState<ScreenshotStatus | null>(null)
  const screenshotDismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const barRef = useRef<HTMLDivElement>(null)

  // Auto-scroll chat to bottom when new messages arrive
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [chatMessages, chatLoading])

  const handleChatSend = async () => {
    if (!chatInput.trim()) return
    setChatMessages((msgs) => [...msgs, { kind: "text", role: "user", text: chatInput }])
    setChatLoading(true)
    setChatInput("")
    try {
      const response = await window.electronAPI.invoke<string>("gemini-chat", chatInput)
      setChatMessages((msgs) => [...msgs, { kind: "text", role: "gemini", text: response }])
    } catch (err) {
      setChatMessages((msgs) => [...msgs, { kind: "text", role: "gemini", text: "Error: " + String(err) }])
    } finally {
      setChatLoading(false)
      chatInputRef.current?.focus()
    }
  }

  // Screenshot capture → show attachment chip with progress, result in chat
  const handleScreenshotCapture = async () => {
    // Auto-open chat to show the response
    if (!isChatOpen) setIsChatOpen(true)

    // Clear any previous dismiss timer
    if (screenshotDismissTimer.current) clearTimeout(screenshotDismissTimer.current)

    const captureId = createClientId()
    setScreenshotStatus({ id: captureId, stage: "uploading", progress: 5 })

    try {
      const result = await window.electronAPI.invoke<ScreenshotAnalyzeResult>("capture-and-analyze-screenshot")
      if (result.success && typeof result.analysis === "string") {
        const analysisText = result.analysis
        const nextMessages: ChatMessage[] = []
        if (typeof result.screenshotBase64 === "string" && result.screenshotBase64.length > 0) {
          nextMessages.push({
            kind: "image",
            role: "user",
            src: `data:image/png;base64,${result.screenshotBase64}`,
            alt: "Captured screenshot",
          })
        }
        nextMessages.push({ kind: "text", role: "gemini", text: analysisText })
        setChatMessages((msgs) => [...msgs, ...nextMessages])
        window.electronAPI.invoke("add-screenshot-context", { analysisText }).catch((error) => {
          console.warn("Failed to persist screenshot context", error)
        })
        setScreenshotStatus((prev) => prev?.id === captureId ? { ...prev, stage: "done", progress: 100 } : prev)
        // Auto-dismiss after ~1s
        screenshotDismissTimer.current = setTimeout(() => {
          setScreenshotStatus((prev) => prev?.id === captureId ? null : prev)
        }, 1200)
      } else {
        setScreenshotStatus({
          id: captureId,
          stage: "failed",
          progress: 0,
          detail: result.error || "Unknown error",
        })
      }
    } catch (err) {
      setScreenshotStatus({
        id: captureId,
        stage: "failed",
        progress: 0,
        detail: String(err),
      })
    }
  }

  // Listen for structured progress events from main process
  useEffect(() => {
    const cleanup = window.electronAPI.onScreenshotStatus((data: { id: string; stage: string; progress: number; detail?: string }) => {
      setScreenshotStatus((prev) => {
        // Only update if this is the current capture
        if (prev && prev.id !== data.id) return prev
        return { ...prev, ...data } as ScreenshotStatus
      })
    })
    return cleanup
  }, [])

  // Listen for Ctrl+H screenshot trigger from main process
  useEffect(() => {
    const cleanup = window.electronAPI.onTriggerScreenshot(() => {
      handleScreenshotCapture()
    })
    return cleanup
  }, [isChatOpen])

  useEffect(() => {
    return () => {
      if (screenshotDismissTimer.current) {
        clearTimeout(screenshotDismissTimer.current)
        screenshotDismissTimer.current = null
      }
    }
  }, [])

  useEffect(() => {
    let rafId: number | null = null

    const updateDimensions = () => {
      // Debounce via rAF to prevent rapid-fire resize during state transitions
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        if (barRef.current) {
          const contentHeight = Math.min(barRef.current.offsetHeight, 500)
          const contentWidth = barRef.current.offsetWidth
          window.electronAPI.updateContentDimensions({
            width: contentWidth,
            height: contentHeight
          })
        }
      })
    }

    const resizeObserver = new ResizeObserver(updateDimensions)
    if (barRef.current) {
      resizeObserver.observe(barRef.current)
    }
    updateDimensions()

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
    }
  }, [])

  const handleChatToggle = () => {
    setIsChatOpen(!isChatOpen)
  }


  return (
    <div
      ref={barRef}
      style={{
        position: "relative",
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        width: "320px",
        overflow: "hidden",
        padding: "0",
        boxSizing: "border-box",
        background: "transparent"
      }}
      className="select-none"
    >
      <div className="bg-transparent">
        <div className="px-2 pb-1">
          <QueueCommands
            onChatToggle={handleChatToggle}
            onChatClear={() => {
              setChatMessages([])
              window.electronAPI.invoke("clear-conversation-history").catch((error) => {
                console.warn("Failed to clear conversation history", error)
              })
            }}

          />
        </div>
      </div>

      {/* Chat Interface — centered below the bubble bar */}
      {isChatOpen && (
        <div
          data-hit-region="active"
          className="mt-2 liquid-glass chat-container p-3 flex flex-col w-full"
          style={{ maxWidth: '320px' }}
        >
          {(chatMessages.length > 0 || chatLoading) && (
            <div className="overflow-y-auto overflow-x-hidden mb-2 p-2 rounded-lg bg-black/30 max-h-48 min-h-[80px] border border-white/10">
              {chatMessages.length > 0 &&
                chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`w-full flex ${
                      msg.role === "user" ? "justify-end" : "justify-start"
                    } mb-2`}
                  >
                    <div
                      className={`max-w-[85%] rounded-lg border ${
                        msg.role === "user"
                          ? "bg-white/15 text-gray-100 border-white/10"
                          : "bg-white/10 text-gray-200 border-white/10"
                      }`}
                      style={msg.kind === "text"
                        ? { overflowWrap: "break-word", wordBreak: "break-word", lineHeight: "1.4" }
                        : undefined}
                    >
                      {msg.kind === "image" ? (
                        <img
                          src={msg.src}
                          alt={msg.alt}
                          className="block max-w-full h-auto rounded-lg"
                        />
                      ) : msg.role === "gemini" ? (
                        <MarkdownMessage
                          content={msg.text}
                          className="px-2.5 py-1.5 text-[11px]"
                        />
                      ) : (
                        <div className="px-2.5 py-1.5 text-[11px]">
                          {msg.text}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              {chatLoading && (
                <div className="flex justify-start mb-2">
                  <div className="bg-white/10 text-gray-300 px-2.5 py-1.5 rounded-lg text-[11px] border border-white/10">
                    <span className="inline-flex items-center gap-0.5">
                      <span className="animate-pulse text-gray-400">●</span>
                      <span className="animate-pulse text-gray-400">●</span>
                      <span className="animate-pulse text-gray-400">●</span>
                    </span>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>
          )}

          {/* Screenshot attachment chip — ephemeral progress indicator */}
          {screenshotStatus && (
            <div
              className={`mb-2 rounded-lg px-2.5 py-2 border transition-all duration-300 ${
                screenshotStatus.stage === "failed"
                  ? "bg-red-500/10 border-red-500/20"
                  : screenshotStatus.stage === "done"
                  ? "bg-green-500/10 border-green-500/20"
                  : "bg-white/5 border-white/10"
              }`}
            >
              {/* Top row: icon + label + dismiss */}
              <div className="flex items-center gap-1.5">
                {/* Camera icon */}
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5}
                  stroke={screenshotStatus.stage === "failed" ? "#f87171" : screenshotStatus.stage === "done" ? "#4ade80" : "#9ca3af"}
                  className="w-3 h-3 shrink-0"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
                </svg>
                <span className={`text-[10px] font-medium flex-1 ${
                  screenshotStatus.stage === "failed" ? "text-red-300" : screenshotStatus.stage === "done" ? "text-green-300" : "text-white/70"
                }`}>
                  {screenshotStatus.stage === "failed" ? "Couldn't analyze screenshot"
                    : screenshotStatus.stage === "done" ? "Screenshot analyzed"
                    : "Screenshot attached"}
                </span>
                {/* Dismiss button for errors */}
                {screenshotStatus.stage === "failed" && (
                  <button
                    type="button"
                    onClick={() => setScreenshotStatus(null)}
                    className="text-white/30 hover:text-white/60 text-[10px] leading-none p-0.5"
                  >✕</button>
                )}
              </div>

              {/* Progress bar (uploading / analyzing) */}
              {(screenshotStatus.stage === "uploading" || screenshotStatus.stage === "analyzing") && (
                <div className="mt-1.5 h-[3px] rounded-full bg-white/5 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out"
                    style={{
                      width: `${screenshotStatus.progress}%`,
                      background: "linear-gradient(90deg, rgba(255,255,255,0.25), rgba(255,255,255,0.40))",
                      animation: screenshotStatus.stage === "analyzing" ? "screenshot-pulse 1.8s ease-in-out infinite" : undefined,
                    }}
                  />
                </div>
              )}

              {/* Stage detail */}
              {screenshotStatus.detail && screenshotStatus.stage !== "failed" && (
                <p className="mt-1 text-[9px] text-white/40 truncate">{screenshotStatus.detail}</p>
              )}

              {/* Error detail + fix */}
              {screenshotStatus.stage === "failed" && screenshotStatus.detail && (
                <div className="mt-1.5 space-y-1">
                  <p className="text-[9px] text-red-300/70 leading-relaxed" style={{ overflowWrap: "break-word", wordBreak: "break-word" }}>
                    {screenshotStatus.detail.split("\n").slice(0, 3).join(" · ")}
                  </p>
                </div>
              )}
            </div>
          )}

          <form
            className="flex gap-2 items-center"
            onSubmit={e => {
              e.preventDefault();
              handleChatSend();
            }}
          >
            <input
              ref={chatInputRef}
              className="flex-1 rounded-lg px-2.5 py-1.5 bg-white/10 text-gray-100 placeholder-gray-400 text-[11px] focus:outline-none focus:ring-1 focus:ring-white/20 border border-white/10 transition-all duration-200"
              placeholder="Type your message..."
              value={chatInput}
              onChange={e => setChatInput(e.target.value)}
              disabled={chatLoading}
            />
            {/* Screenshot (picture) icon button */}
            <button
              type="button"
              className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 border border-white/10 flex items-center justify-center transition-all duration-200 disabled:opacity-50"
              disabled={chatLoading || (screenshotStatus !== null && screenshotStatus.stage !== "done" && screenshotStatus.stage !== "failed")}
              onClick={handleScreenshotCapture}
              tabIndex={-1}
              aria-label="Screenshot"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="white" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0022.5 18.75V5.25A2.25 2.25 0 0020.25 3H3.75A2.25 2.25 0 001.5 5.25v13.5A2.25 2.25 0 003.75 21z" />
              </svg>
            </button>
            <button
              type="submit"
              className="p-1.5 rounded-lg bg-white/15 hover:bg-white/25 border border-white/10 flex items-center justify-center transition-all duration-200 disabled:opacity-50"
              disabled={chatLoading || !chatInput.trim()}
              tabIndex={-1}
              aria-label="Send"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="white" className="w-3.5 h-3.5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 19.5l15-7.5-15-7.5v6l10 1.5-10 1.5v6z" />
              </svg>
            </button>
          </form>
        </div>
      )}

    </div>
  )
}

export default Queue
