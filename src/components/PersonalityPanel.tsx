import React, { useState, useEffect, useCallback } from "react"

interface PersonalityScope {
  raw: string
  effective: string
}

interface PersonalitySettings {
  chat: PersonalityScope
  transcription: PersonalityScope
  activePreset: string | null
}

type GetPersonalityResult = {
  success: boolean
  personality: PersonalitySettings
  error?: string
}

/**
 * Standalone personality editor rendered in its own BrowserWindow.
 * No props needed — the window itself is the container.
 */
const PersonalityPanel: React.FC = () => {
  const [personality, setPersonality] = useState<PersonalitySettings | null>(null)
  const [activeTab, setActiveTab] = useState<"chat" | "transcription">("chat")
  const [customText, setCustomText] = useState("")
  const [saving, setSaving] = useState(false)

  // Load current personality on mount
  useEffect(() => {
    const load = async () => {
      try {
        const persResult = await window.electronAPI.invoke<GetPersonalityResult>("get-personality")
        if (persResult?.success) {
          setPersonality(persResult.personality)
          setCustomText(persResult.personality.chat?.raw || "")
        }
      } catch (err) {
        console.error("Failed to load personality:", err)
      }
    }
    void load()
  }, [])

  // Update custom text when tab changes
  useEffect(() => {
    if (personality) {
      setCustomText(personality[activeTab]?.raw || "")
    }
  }, [activeTab, personality])

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        window.electronAPI.invoke("close-personality-window")
      }
    }
    document.addEventListener("keydown", handleKey)
    return () => document.removeEventListener("keydown", handleKey)
  }, [])

  const handleSaveCustom = useCallback(async () => {
    if (!customText.trim()) return
    setSaving(true)
    try {
      await window.electronAPI.invoke("set-custom-personality", activeTab, customText.trim())
      const persResult = await window.electronAPI.invoke<GetPersonalityResult>("get-personality")
      if (persResult?.success) {
        setPersonality(persResult.personality)
      }
    } catch (err) {
      console.error("Failed to save custom personality:", err)
    } finally {
      setSaving(false)
    }
  }, [activeTab, customText])

  const handleClose = () => {
    window.electronAPI.invoke("close-personality-window")
  }

  return (
    <div
      className="liquid-glass p-3 w-full h-full select-none flex flex-col"
      style={{ borderRadius: "1rem" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5 shrink-0">
        <span className="text-[11px] font-semibold text-white/80 tracking-wide uppercase">
          Custom Personality
        </span>
        <button
          type="button"
          onClick={handleClose}
          className="text-white/30 hover:text-white/60 text-[11px] leading-none p-0.5 transition-colors"
        >
          ✕
        </button>
      </div>

      {/* Scope tabs */}
      <div className="flex gap-0.5 mb-2 bg-black/20 rounded-lg p-0.5 shrink-0">
        {(["chat", "transcription"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`flex-1 px-2 py-1 rounded-md text-[10px] font-medium transition-all duration-200 ${
              activeTab === tab
                ? "bg-white/15 text-white/90"
                : "text-white/40 hover:text-white/60"
            }`}
          >
            {tab === "chat" ? "Chat" : "Transcription"}
          </button>
        ))}
      </div>

      {/* Current effective personality preview */}
      {personality?.[activeTab]?.effective && (
        <div className="mb-2 rounded-lg px-2.5 py-2 bg-black/20 border border-white/5 shrink-0">
          <p className="text-[9px] text-white/35 uppercase tracking-wider mb-1">Active</p>
          <p className="text-[10px] text-white/55 leading-relaxed" style={{ overflowWrap: "break-word" }}>
            {personality[activeTab].effective.substring(0, 200)}
            {personality[activeTab].effective.length > 200 ? "…" : ""}
          </p>
        </div>
      )}

      {/* Custom text editor */}
      <div className="flex flex-col gap-1.5 flex-1 min-h-0">
        <textarea
          value={customText}
          onChange={(e) => setCustomText(e.target.value)}
          placeholder={`Describe how you want the AI to behave for ${activeTab}…`}
          className="flex-1 w-full rounded-lg px-2.5 py-2 bg-white/5 text-gray-200 placeholder-white/20 text-[10px] leading-relaxed focus:outline-none focus:ring-1 focus:ring-white/15 border border-white/5 resize-none transition-all duration-200"
          style={{ minHeight: "60px" }}
        />
        <button
          type="button"
          onClick={handleSaveCustom}
          disabled={saving || !customText.trim()}
          className="w-full py-1.5 rounded-lg text-[10px] font-medium border transition-all duration-200 disabled:opacity-30 bg-white/10 text-white/70 border-white/10 hover:bg-white/15 hover:text-white/90 shrink-0"
        >
          {saving ? "Saving…" : "Save Custom Personality"}
        </button>
      </div>

      {/* Paraphrase info */}
      <p className="mt-2 text-[8px] text-white/20 text-center shrink-0">
        Custom text is paraphrased by the AI into a system prompt
      </p>
    </div>
  )
}

export default PersonalityPanel
