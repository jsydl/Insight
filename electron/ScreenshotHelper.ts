// ScreenshotHelper.ts — Captures the screen excluding the app overlay.

import screenshot from "screenshot-desktop"
import { AppState } from "./main"

export class ScreenshotHelper {
  private appState: AppState

  constructor(appState: AppState) {
    this.appState = appState
  }

  /**
   * Capture the full primary screen as a PNG base64 string.
   * Hides the overlay window before capture and restores it after.
   */
  public async captureScreen(): Promise<string> {
    const mainWindow = this.appState.getMainWindow()
    const wasVisible = mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible()

    try {
      // Hide overlay so it doesn't appear in the screenshot
      if (wasVisible && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.hide()
        // Small delay to let the OS finish hiding the window
        await new Promise((r) => setTimeout(r, 150))
      }

      // Capture primary screen as PNG buffer
      const imgBuffer: Buffer = await screenshot({ format: "png" })
      return imgBuffer.toString("base64")
    } finally {
      // Restore overlay visibility and always-on-top
      if (wasVisible && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.showInactive()
        mainWindow.setAlwaysOnTop(true, "floating")
      }
    }
  }
}
