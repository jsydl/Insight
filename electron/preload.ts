import { contextBridge, ipcRenderer } from "electron"

type RealtimeTranscriptPayload = {
  text: string
  cumulative: string
  isFinal: boolean
  timestamp: number
  seq: number
}

type RealtimeStatusPayload = {
  status: "starting" | "ready" | "retrying" | "stopped" | "error"
  message: string
  active: boolean
  connected: boolean
  timestamp: number
}

type RawFragmentPayload = {
  text: string
  seq: number
  timestamp: number
}

type ScreenshotStatusPayload = {
  id: string
  stage: string
  progress: number
  detail?: string
}

// Expose the Electron API to the renderer process
contextBridge.exposeInMainWorld("electronAPI", {
  updateContentDimensions: (dimensions: { width: number; height: number }) =>
    ipcRenderer.invoke("update-content-dimensions", dimensions),
  toggleWindow: () => ipcRenderer.invoke("toggle-window"),
  quitApp: () => ipcRenderer.invoke("quit-app"),

  // View events
  onResetView: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("reset-view", subscription)
    return () => {
      ipcRenderer.removeListener("reset-view", subscription)
    }
  },

  // Real-time transcription (streaming)
  startRealtimeTranscription: () => ipcRenderer.invoke("start-realtime-transcription"),
  stopRealtimeTranscription: () => ipcRenderer.invoke("stop-realtime-transcription"),
  onRealtimeTranscriptUpdate: (callback: (data: RealtimeTranscriptPayload) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, data: RealtimeTranscriptPayload) => callback(data)
    ipcRenderer.on("realtime-transcript-update", subscription)
    return () => {
      ipcRenderer.removeListener("realtime-transcript-update", subscription)
    }
  },
  onRealtimeTranscriptionStatus: (callback: (data: RealtimeStatusPayload) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, data: RealtimeStatusPayload) => callback(data)
    ipcRenderer.on("realtime-transcription-status", subscription)
    return () => {
      ipcRenderer.removeListener("realtime-transcription-status", subscription)
    }
  },

  // Raw transcript fragments (unmerged, for question detection)
  onRawFragment: (callback: (data: RawFragmentPayload) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, data: RawFragmentPayload) => callback(data)
    ipcRenderer.on("realtime-raw-fragment", subscription)
    return () => {
      ipcRenderer.removeListener("realtime-raw-fragment", subscription)
    }
  },

  // Screenshot trigger (from global shortcut)
  onTriggerScreenshot: (callback: () => void) => {
    const subscription = () => callback()
    ipcRenderer.on("trigger-screenshot", subscription)
    return () => {
      ipcRenderer.removeListener("trigger-screenshot", subscription)
    }
  },

  // Screenshot analysis progress events
  onScreenshotStatus: (callback: (data: ScreenshotStatusPayload) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, data: ScreenshotStatusPayload) => callback(data)
    ipcRenderer.on("screenshot:status", subscription)
    return () => {
      ipcRenderer.removeListener("screenshot:status", subscription)
    }
  },

  // Personality events from tray / main process
  onPersonalityChanged: (callback: (presetId: string) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, presetId: string) => callback(presetId)
    ipcRenderer.on("personality-changed", subscription)
    return () => {
      ipcRenderer.removeListener("personality-changed", subscription)
    }
  },

  // Generic IPC invoke
  invoke: <T = unknown>(channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args) as Promise<T>
})
