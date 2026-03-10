import Queue from "./_pages/Queue"
import { useEffect, useRef } from "react"
import PersonalityPanel from "./components/PersonalityPanel"

declare global {
  interface Window {
    electronAPI: {
      // Window management
      updateContentDimensions: (dimensions: {
        width: number
        height: number
      }) => Promise<void>
      toggleWindow: () => Promise<void>
      quitApp: () => Promise<void>

      // View events
      onResetView: (callback: () => void) => () => void

      // Real-time transcription (streaming)
      startRealtimeTranscription: () => Promise<{ success: boolean; error?: string }>
      stopRealtimeTranscription: () => Promise<{ success: boolean; error?: string }>
      onRealtimeTranscriptUpdate: (callback: (data: { text: string; cumulative: string; isFinal: boolean; timestamp: number; seq: number }) => void) => () => void
      onRawFragment: (callback: (data: { text: string; seq: number; timestamp: number }) => void) => () => void

      // Screenshot
      onTriggerScreenshot: (callback: () => void) => () => void
      onScreenshotStatus: (callback: (data: { id: string; stage: string; progress: number; detail?: string }) => void) => () => void

      // Personality events from tray
      onPersonalityChanged: (callback: (presetId: string) => void) => () => void

      // Generic IPC
      invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>
    }
  }
}

const App: React.FC = () => {
  const containerRef = useRef<HTMLDivElement>(null)

  // Detect if this window is the personality panel
  const isPersonalityView = new URLSearchParams(window.location.search).get("view") === "personality"

  // Effect for height monitoring
  useEffect(() => {
    const cleanup = window.electronAPI.onResetView(() => {})

    return () => {
      cleanup()
    }
  }, [])

  useEffect(() => {
    if (isPersonalityView) return

    let rafId: number | null = null

    const reportHitRegions = () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      rafId = requestAnimationFrame(() => {
        const regions = Array.from(document.querySelectorAll('[data-hit-region="active"]'))
          .map((element) => {
            const rect = element.getBoundingClientRect()
            return {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            }
          })
          .filter((rect) => rect.width > 0 && rect.height > 0)

        window.electronAPI.invoke("set-window-hit-regions", regions).catch((error) => {
          console.warn("Failed to set hit regions", error)
        })
      })
    }

    const resizeObserver = new ResizeObserver(reportHitRegions)
    resizeObserver.observe(document.body)
    document.querySelectorAll('[data-hit-region="active"]').forEach((element) => {
      resizeObserver.observe(element)
    })

    const mutationObserver = new MutationObserver(() => {
      document.querySelectorAll('[data-hit-region="active"]').forEach((element) => {
        resizeObserver.observe(element)
      })
      reportHitRegions()
    })

    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-hit-region", "class", "style"],
    })

    window.addEventListener("resize", reportHitRegions)
    reportHitRegions()

    return () => {
      if (rafId !== null) cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      mutationObserver.disconnect()
      window.removeEventListener("resize", reportHitRegions)
      window.electronAPI.invoke("set-window-hit-regions", []).catch((error) => {
        console.warn("Failed to clear hit regions", error)
      })
    }
  }, [isPersonalityView])

  // Dimension reporting is handled by individual views (Queue.tsx, etc.)
  // to ensure only visible content dimensions are reported.

  // If this is the personality window, render only the panel
  if (isPersonalityView) {
    return (
      <div className="min-h-0 w-full h-screen">
        <PersonalityPanel />
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className="min-h-0"
    >
      <Queue />
    </div>
  )
}

export default App
