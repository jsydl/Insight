import React, { useState, useEffect, useRef } from "react"
import { IoLogOutOutline, IoChevronDown, IoChevronUp } from "react-icons/io5"

interface QueueCommandsProps {
  onChatToggle: () => void
  onChatClear?: () => void
}

interface TranscriptionItem {
  id: string
  question: string
  answer: string | null
  isLoading: boolean
  timestamp: number
}

type AnswerQuestionResult = {
  success: boolean
  skipped?: boolean
  answer?: string | null
  error?: string
}

const createClientId = (): string => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

const MAX_TRANSCRIPTIONS = 60

const QueueCommands: React.FC<QueueCommandsProps> = ({
  onChatToggle,
  onChatClear,
}) => {
  const [isRecording, setIsRecording] = useState(false)
  const [transcriptions, setTranscriptions] = useState<TranscriptionItem[]>([])
  const [rawTranscripts, setRawTranscripts] = useState<string[]>([])
  const [livePartialTranscript, setLivePartialTranscript] = useState("")
  const [showTranscriptLog, setShowTranscriptLog] = useState(false)
  const isRecordingRef = useRef(false)
  const lastCommittedTextRef = useRef("")
  const lastRawFragmentRef = useRef("")
  const transcriptionSessionIdRef = useRef(0)

  const handleToggleWindow = () => {
    window.electronAPI.toggleWindow()
  }

  // Unified pipeline: send every transcript chunk to the model.
  // The model itself decides whether it's worth answering (returns skipped=true if not).
  const processTranscription = async (text: string, sessionId: number) => {
    if (!text.trim()) return

    const itemId = createClientId()
    const newItem: TranscriptionItem = {
      id: itemId,
      question: text,
      answer: null,
      isLoading: true,
      timestamp: Date.now()
    }

    setTranscriptions((prev) => [newItem, ...prev].slice(0, MAX_TRANSCRIPTIONS))

    try {
      const result = await window.electronAPI.invoke<AnswerQuestionResult>("answer-question", text)

      // Ignore stale responses from older recording sessions.
      if (sessionId !== transcriptionSessionIdRef.current) {
        setTranscriptions((prev) => prev.filter((item) => item.id !== itemId))
        return
      }

      if (result.success && !result.skipped && typeof result.answer === "string") {
        const answerText = result.answer
        // Model provided an answer — show it
        setTranscriptions((prev) =>
          prev.map((item) =>
            item.id === itemId
              ? { ...item, answer: answerText, isLoading: false }
              : item
          )
        )
      } else {
        // Model skipped or failed — remove the pending item silently
        setTranscriptions((prev) => prev.filter((item) => item.id !== itemId))
      }
    } catch (err) {
      console.error('Error processing transcription:', err)
      setTranscriptions((prev) => prev.filter((item) => item.id !== itemId))
    }
  }

  // Ref to always call the latest processTranscription (avoids stale closure in useEffect)
  const processTranscriptionRef = useRef(processTranscription)
  processTranscriptionRef.current = processTranscription

  const handleRecordClick = async () => {
    if (isRecordingRef.current) {
      // Stop recording
      transcriptionSessionIdRef.current += 1
      isRecordingRef.current = false
      setIsRecording(false)
      try {
        await window.electronAPI.stopRealtimeTranscription()
      } catch (err) {
        console.error("Error stopping realtime transcription:", err)
      }
      return
    }

    // Start recording
    transcriptionSessionIdRef.current += 1
    isRecordingRef.current = true
    setIsRecording(true)

    try {
      await window.electronAPI.startRealtimeTranscription()
    } catch (err) {
      console.error("Error starting realtime transcription:", err)
      isRecordingRef.current = false
      setIsRecording(false)
    }
  }

  const handleClearTranscripts = () => {
    setRawTranscripts([])
    setLivePartialTranscript("")
    setShowTranscriptLog(false)
    window.electronAPI.invoke("clear-transcription-context").catch((error) => {
      console.warn("Failed to clear transcription context", error)
    })
  }

  const handleClearHistory = () => {
    setTranscriptions([])
    setRawTranscripts([])
    setLivePartialTranscript("")
    setShowTranscriptLog(false)
    lastCommittedTextRef.current = ""
    transcriptionSessionIdRef.current += 1
    window.electronAPI.invoke("clear-transcription-context").catch((error) => {
      console.warn("Failed to clear transcription context", error)
    })
  }

  useEffect(() => {
    // Raw fragment listener — update the single live partial line only.
    const cleanupRaw = window.electronAPI.onRawFragment((data) => {
      if (!data.text?.trim()) return
      const fragment = data.text.trim()
      lastRawFragmentRef.current = fragment
      setLivePartialTranscript(fragment)
    })

    // Committed transcript listener — finalize one raw-log line and trigger Q/A once.
    const cleanupTranscript = window.electronAPI.onRealtimeTranscriptUpdate((data) => {
      if (!data.text?.trim()) return
      if (!isRecordingRef.current) return

      const committedText = data.text.trim()
      if (committedText === lastCommittedTextRef.current) return

      lastCommittedTextRef.current = committedText

      // Root cause fix: raw transcript log should prefer the raw fragment stream.
      // Some providers normalize committed text, which can look like rewritten output.
      const finalizedLogText = (lastRawFragmentRef.current || committedText).trim()
      lastRawFragmentRef.current = ""

      setLivePartialTranscript("")
      if (finalizedLogText) {
        setRawTranscripts((prev) => [finalizedLogText, ...prev].slice(0, 50))
      }
      void processTranscriptionRef.current(committedText, transcriptionSessionIdRef.current)
    })

    return () => {
      isRecordingRef.current = false
      cleanupRaw()
      cleanupTranscript()
      // Ensure we stop recording on unmount
      window.electronAPI.stopRealtimeTranscription().catch((error) => {
        console.warn("Failed to stop realtime transcription during cleanup", error)
      })
    }
  }, [])

  const answeredItems = transcriptions.filter((t) => t.answer !== null)

  return (
    <div className="w-[320px]">
      <div data-hit-region="active" className="text-xs text-white/90 liquid-glass-bar py-1 px-4 flex items-center justify-center gap-6 draggable-area">
        {/* Toggle Button */}
        <button 
          type="button"
          onClick={handleToggleWindow}
          className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-2 py-1 text-[11px] leading-none text-white/70 cursor-pointer"
        >
          ⊕
        </button>

        {/* Record + Transcript arrow group */}
        <div className="flex items-center">
          <button
            className={`bg-white/10 hover:bg-white/20 transition-colors px-2 py-1 text-[11px] leading-none text-white/70 flex items-center gap-1 ${
              rawTranscripts.length > 0 || livePartialTranscript ? 'rounded-l-md' : 'rounded-md'
            } ${isRecording ? 'bg-red-500/70 hover:bg-red-500/90' : ''}`}
            onClick={handleRecordClick}
            onContextMenu={(e) => {
              e.preventDefault()
              handleClearHistory()
            }}
            type="button"
          >
            {isRecording ? (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                <span>Stop</span>
              </span>
            ) : (
              <span>Record</span>
            )}
          </button>
          {/* Transcript log arrow dropdown toggle — right-click clears log */}
          {(rawTranscripts.length > 0 || livePartialTranscript) && (
            <button
              type="button"
              onClick={() => setShowTranscriptLog(!showTranscriptLog)}
              onContextMenu={(e) => {
                e.preventDefault()
                handleClearTranscripts()
              }}
              className={`bg-white/10 hover:bg-white/20 transition-colors rounded-r-md px-1 py-1 text-[11px] leading-none text-white/50 border-l border-white/10 flex items-center justify-center ${
                isRecording ? 'bg-red-500/40' : ''
              }`}
              title="Toggle transcript log (right-click to clear)"
            >
              {showTranscriptLog ? <IoChevronUp className="w-[11px] h-[11px]" /> : <IoChevronDown className="w-[11px] h-[11px]" />}
            </button>
          )}
        </div>

        {/* Chat Button — right-click to clear chat */}
        <button
          className="bg-white/10 hover:bg-white/20 transition-colors rounded-md px-2 py-1 text-[11px] leading-none text-white/70 flex items-center gap-1"
          onClick={onChatToggle}
          onContextMenu={(e) => {
            e.preventDefault()
            onChatClear?.()
          }}
          type="button"
        >
          💬 Chat
        </button>

        {/* Sign Out Button */}
        <button
          className="text-red-500/70 hover:text-red-500/90 transition-colors hover:cursor-pointer"
          onClick={() => window.electronAPI.quitApp()}
        >
          <IoLogOutOutline className="w-4 h-4" />
        </button>
      </div>

      {/* Transcript log dropdown - directly below command bar */}
      {showTranscriptLog && (rawTranscripts.length > 0 || livePartialTranscript) && (
        <div
          data-hit-region="active"
          className="mt-1 rounded-lg px-3 py-2 overflow-y-auto"
          style={{
            maxHeight: '120px',
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(20px) saturate(160%) brightness(85%)',
            WebkitBackdropFilter: 'blur(20px) saturate(160%) brightness(85%)',
            borderRadius: '0.75rem',
            border: '1px solid rgba(255,255,255,0.06)'
          }}
        >
          {livePartialTranscript && (
            <p className="text-[10px] text-white/50 leading-relaxed mb-1">
              {livePartialTranscript}
            </p>
          )}
          {rawTranscripts.map((text, idx) => (
            <p key={idx} className="text-[10px] text-white/50 leading-relaxed mb-1">
              {text}
            </p>
          ))}
        </div>
      )}

      {/* Questions & Answers — model-decided, no rule-based filter */}
      {answeredItems.length > 0 && (
        <div
          data-hit-region="active"
          className="mt-1 rounded-lg p-3 space-y-2 overflow-y-auto"
          style={{
            maxHeight: '250px',
            background: 'rgba(0,0,0,0.55)',
            backdropFilter: 'blur(20px) saturate(160%) brightness(85%)',
            WebkitBackdropFilter: 'blur(20px) saturate(160%) brightness(85%)',
            borderRadius: '0.75rem',
            border: '1px solid rgba(255,255,255,0.06)'
          }}
        >
          {answeredItems.map((item) => (
            <div
              key={item.id}
              className="bg-black/30 rounded px-2.5 py-2 space-y-1.5 border border-white/10"
            >
              <div className="flex items-start gap-1.5">
                <span className="text-[11px] font-semibold text-blue-300 shrink-0 leading-4">Q:</span>
                <p className="text-[11px] text-white/80 leading-4">{item.question}</p>
              </div>

              {item.isLoading ? (
                <div className="flex items-center gap-1.5 text-[10px] text-white/50 pl-4">
                  <span className="animate-pulse">Generating answer...</span>
                </div>
              ) : item.answer ? (
                <div className="pl-4">
                  <p className="text-[10px] font-medium text-green-300/80 mb-0.5">A:</p>
                  <p className="text-[11px] text-white/70 bg-black/20 rounded px-2 py-1 leading-relaxed">
                    {item.answer}
                  </p>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default QueueCommands
