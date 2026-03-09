import { globalShortcut, app } from "electron"
import { AppState } from "./main"
import { appendAppLog } from "./logger"

export class ShortcutsHelper {
  private appState: AppState
  private resetAlwaysOnTopTimer: ReturnType<typeof setTimeout> | null = null

  constructor(appState: AppState) {
    this.appState = appState
  }

  private log(message: string): void {
    appendAppLog(`[Shortcuts] ${message}`)
  }

  public registerGlobalShortcuts(): void {
    // Add global shortcut to show/center window
    globalShortcut.register("CommandOrControl+Shift+Space", () => {
      this.log("Show/Center window shortcut pressed")
      this.appState.centerAndShowWindow()
    })

    globalShortcut.register("CommandOrControl+R", () => {
      this.log("Command/Ctrl + R pressed. Resetting interview")

      this.appState.processingHelper.resetInterview()

      // Notify renderer process to reset view or chat if they want
      const mainWindow = this.appState.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("reset-view")
      }
    })

    // New shortcuts for moving the window
    globalShortcut.register("CommandOrControl+Left", () => {
      this.log("Command/Ctrl + Left pressed. Moving window left")
      this.appState.moveWindowLeft()
    })

    globalShortcut.register("CommandOrControl+Right", () => {
      this.log("Command/Ctrl + Right pressed. Moving window right")
      this.appState.moveWindowRight()
    })
    globalShortcut.register("CommandOrControl+Down", () => {
      this.log("Command/Ctrl + Down pressed. Moving window down")
      this.appState.moveWindowDown()
    })
    globalShortcut.register("CommandOrControl+Up", () => {
      this.log("Command/Ctrl + Up pressed. Moving window up")
      this.appState.moveWindowUp()
    })

    globalShortcut.register("CommandOrControl+B", () => {
      this.appState.toggleMainWindow()
      // If window exists and we're showing it, bring it to front
      const mainWindow = this.appState.getMainWindow()
      if (mainWindow && !this.appState.isVisible()) {
        // Force the window to the front on macOS
        if (process.platform === "darwin") {
          mainWindow.setAlwaysOnTop(true, "normal")
          // Reset alwaysOnTop after a brief delay
          if (this.resetAlwaysOnTopTimer) {
            clearTimeout(this.resetAlwaysOnTopTimer)
          }
          this.resetAlwaysOnTopTimer = setTimeout(() => {
            if (mainWindow && !mainWindow.isDestroyed()) {
              mainWindow.setAlwaysOnTop(true, "floating")
            }
            this.resetAlwaysOnTopTimer = null
          }, 100)
        }
      }
    })

    // Screenshot capture shortcut
    globalShortcut.register("CommandOrControl+H", () => {
      this.log("Ctrl/Cmd + H pressed. Triggering screenshot capture")
      const mainWindow = this.appState.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("trigger-screenshot")
      }
    })

    // Unregister shortcuts when quitting
    app.on("will-quit", () => {
      if (this.resetAlwaysOnTopTimer) {
        clearTimeout(this.resetAlwaysOnTopTimer)
        this.resetAlwaysOnTopTimer = null
      }
      globalShortcut.unregisterAll()
    })
  }
}
