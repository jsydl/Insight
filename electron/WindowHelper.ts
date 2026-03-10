
import { BrowserWindow, screen, app } from "electron"
import { AppState } from "./main"
import path from "node:path"
import { appendAppLog } from "./logger"

const isDev = process.env.NODE_ENV === "development"

export class WindowHelper {
  private mainWindow: BrowserWindow | null = null
  private isWindowVisible: boolean = false
  private windowPosition: { x: number; y: number } | null = null
  private windowSize: { width: number; height: number } | null = null
  private hitRegions: Array<{ x: number; y: number; width: number; height: number }> = []
  private hitTestInterval: ReturnType<typeof setInterval> | null = null
  private ignoreMouseState: boolean | null = null
  private lastCursorPoint: { x: number; y: number } | null = null
  private appState: AppState

  // Position saved before toggle-off, restored on toggle-on
  private savedTogglePosition: { x: number; y: number } | null = null

  // Brief lock to prevent ResizeObserver from overriding position right after show
  private dimensionLock: boolean = false
  private showFallbackTimer: ReturnType<typeof setTimeout> | null = null
  private dimensionUnlockTimer: ReturnType<typeof setTimeout> | null = null

  // Initialize with explicit number type and 0 value
  private screenWidth: number = 0
  private screenHeight: number = 0
  private step: number = 50
  private currentX: number = 0
  private currentY: number = 0

  // ── Tweak these to adjust startup position ──
  // STARTUP_Y_OFFSET: pixels from top of screen (increase to move bubble down)
  private static readonly STARTUP_Y_OFFSET = 6

  constructor(appState: AppState) {
    this.appState = appState
  }

  private log(message: string): void {
    appendAppLog(`[WindowHelper] ${message}`)
  }

  public setWindowDimensions(width: number, height: number): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    // Don't update dimensions while window is hidden or just being restored
    if (this.dimensionLock || !this.isWindowVisible) return

    // Get current window position
    const [currentX, currentY] = this.mainWindow.getPosition()

    // Get screen dimensions
    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workArea

    // Use 50% width by default (previously 75% for debug mode)
    const maxAllowedWidth = Math.floor(
      workArea.width * 0.5
    )

    // Ensure width doesn't exceed max allowed width and height is reasonable
    const newWidth = Math.min(width, maxAllowedWidth)
    const newHeight = Math.ceil(height)

    // Keep current X position — only clamp if off screen
    const minX = workArea.x
    const maxX = workArea.x + workArea.width - newWidth
    const newX = Math.min(Math.max(currentX, minX), maxX)

    // Update window bounds
    this.mainWindow.setBounds({
      x: newX,
      y: currentY,
      width: newWidth,
      height: newHeight
    })

    // Update internal state
    this.windowPosition = { x: newX, y: currentY }
    this.windowSize = { width: newWidth, height: newHeight }
    this.currentX = newX
    this.currentY = currentY
    this.updateMouseIgnoreState(true)
  }

  public setHitRegions(regions: Array<{ x: number; y: number; width: number; height: number }>): void {
    this.hitRegions = regions.filter(region => region.width > 0 && region.height > 0)
    this.updateMouseIgnoreState(true)
  }

  private startHitTestLoop(): void {
    this.stopHitTestLoop()
    this.hitTestInterval = setInterval(() => {
      this.updateMouseIgnoreState()
    }, 75)
  }

  private stopHitTestLoop(): void {
    if (this.hitTestInterval) {
      clearInterval(this.hitTestInterval)
      this.hitTestInterval = null
    }
  }

  private updateMouseIgnoreState(force = false): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed() || !this.isWindowVisible) return
    if (this.hitRegions.length === 0) {
      if (this.ignoreMouseState !== false) {
        this.mainWindow.setIgnoreMouseEvents(false)
        this.ignoreMouseState = false
      }
      return
    }

    const cursor = screen.getCursorScreenPoint()
    if (!force && this.lastCursorPoint && this.lastCursorPoint.x === cursor.x && this.lastCursorPoint.y === cursor.y) {
      return
    }
    this.lastCursorPoint = { x: cursor.x, y: cursor.y }
    const bounds = this.mainWindow.getBounds()
    const localX = cursor.x - bounds.x
    const localY = cursor.y - bounds.y
    const insideWindow = localX >= 0 && localY >= 0 && localX < bounds.width && localY < bounds.height

    const overHitRegion = insideWindow && this.hitRegions.some(region => (
      localX >= region.x &&
      localY >= region.y &&
      localX < region.x + region.width &&
      localY < region.y + region.height
    ))

    const shouldIgnore = insideWindow ? !overHitRegion : true
    if (this.ignoreMouseState !== shouldIgnore) {
      this.mainWindow.setIgnoreMouseEvents(shouldIgnore, { forward: true })
      this.ignoreMouseState = shouldIgnore
    }
  }

  public createWindow(): void {
    this.log('createWindow called')
    if (this.mainWindow !== null) {
      this.log('createWindow: mainWindow already exists, returning')
      return
    }

    this.log('createWindow: getting primary display')
    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workArea
    this.screenWidth = workArea.width
    this.screenHeight = workArea.height
    this.log('createWindow: got workArea: ' + JSON.stringify(workArea))

    
    // Start at horizontal center, near top of screen
    const startX = workArea.x + Math.floor((workArea.width - 320) / 2)
    const startY = workArea.y + WindowHelper.STARTUP_Y_OFFSET

    const windowSettings: Electron.BrowserWindowConstructorOptions = {
      width: 350,
      height: 60,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, "preload.js")
      },
      show: false, // Start hidden, then show after setup
      alwaysOnTop: true,
      frame: false,
      transparent: true,
      fullscreenable: false,
      hasShadow: false,
      backgroundColor: "#00000000",
      focusable: true,
      resizable: false,
      movable: true,
      x: startX,
      y: startY
    }

    this.log('createWindow: creating BrowserWindow')
    this.mainWindow = new BrowserWindow(windowSettings)
    this.log('createWindow: BrowserWindow created')

    // DevTools: only open when explicitly requested via OPEN_DEVTOOLS=1 env var.
    // Do NOT auto-open in dev mode — it causes a dimension overlay and Autofill errors.
    if (process.env.OPEN_DEVTOOLS === '1') {
      this.log('createWindow: opening devtools')
      this.mainWindow.webContents.openDevTools({ mode: 'detach' })
    }

    this.mainWindow.setContentProtection(true)
    this.log('createWindow: setContentProtection(true)')

    if (process.platform === "darwin") {
      this.log('createWindow: platform is darwin, setting macOS options')
      this.mainWindow.setVisibleOnAllWorkspaces(true, {
        visibleOnFullScreen: true
      })
      this.mainWindow.setHiddenInMissionControl(true)
      this.mainWindow.setAlwaysOnTop(true, "floating")
    }
    if (process.platform === "linux") {
      this.log('createWindow: platform is linux, setting Linux options')
      // Linux-specific optimizations for better compatibility
      if (this.mainWindow.setHasShadow) {
        this.mainWindow.setHasShadow(false)
      }
      // Keep window focusable on Linux for proper interaction
      this.mainWindow.setFocusable(true)
    } 
    this.mainWindow.setSkipTaskbar(true)
    this.mainWindow.setAlwaysOnTop(true)
    this.log('createWindow: setSkipTaskbar/AlwaysOnTop')

    if (isDev) {
      this.log("Loading dev URL: http://localhost:5180")
      this.mainWindow.loadURL("http://localhost:5180").catch((err) => {
        this.log("Failed to load dev URL: " + err)
      })
    } else {
      const indexPath = path.join(app.getAppPath(), "dist", "index.html")
      this.log("Loading file: " + indexPath)
      this.mainWindow.loadFile(indexPath).then(() => {
        this.log('loadFile resolved')
      }).catch((err) => {
        this.log("Failed to load file: " + err)
      })
    }

    // Show window after loading URL — use initial position (don't re-center)
    this.mainWindow.once('ready-to-show', () => {
      this.log('mainWindow ready-to-show')
      if (this.mainWindow) {
        // Only re-center if window is somehow off-screen (edge case)
        const bounds = this.mainWindow.getBounds()
        const primaryDisplay = screen.getPrimaryDisplay()
        const workArea = primaryDisplay.workArea
        const outOfBounds =
          bounds.x < workArea.x ||
          bounds.x > workArea.x + workArea.width ||
          bounds.y < workArea.y ||
          bounds.y > workArea.y + workArea.height
        if (outOfBounds) {
          this.log("Window appears off-screen, centering as fallback")
          this.centerWindow()
        }
        this.log('calling mainWindow.show()')
        this.mainWindow.show()
        this.log('calling mainWindow.focus()')
        this.mainWindow.focus()
        this.mainWindow.setAlwaysOnTop(true)
        this.log("Window is now visible at startup position")
      }
    })

    // Fallback: force show after 3 seconds if ready-to-show hasn't fired
    this.showFallbackTimer = setTimeout(() => {
      if (this.mainWindow && !this.mainWindow.isVisible()) {
        this.log("Force showing window after timeout")
        this.mainWindow.show()
        this.mainWindow.focus()
      }
      this.showFallbackTimer = null
    }, 3000)

    const bounds = this.mainWindow.getBounds()
    this.windowPosition = { x: bounds.x, y: bounds.y }
    this.windowSize = { width: bounds.width, height: bounds.height }
    this.currentX = bounds.x
    this.currentY = bounds.y

    this.setupWindowListeners()
    this.isWindowVisible = true
    this.startHitTestLoop()
  }

  private setupWindowListeners(): void {
    if (!this.mainWindow) return

    this.mainWindow.on("move", () => {
      if (this.mainWindow) {
        const bounds = this.mainWindow.getBounds()
        this.windowPosition = { x: bounds.x, y: bounds.y }
        this.currentX = bounds.x
        this.currentY = bounds.y
      }
    })

    this.mainWindow.on("resize", () => {
      if (this.mainWindow) {
        const bounds = this.mainWindow.getBounds()
        this.windowSize = { width: bounds.width, height: bounds.height }
        this.updateMouseIgnoreState(true)
      }
    })

    this.mainWindow.on("closed", () => {
      this.stopHitTestLoop()
      if (this.showFallbackTimer) {
        clearTimeout(this.showFallbackTimer)
        this.showFallbackTimer = null
      }
      if (this.dimensionUnlockTimer) {
        clearTimeout(this.dimensionUnlockTimer)
        this.dimensionUnlockTimer = null
      }
      this.mainWindow = null
      this.isWindowVisible = false
      this.windowPosition = null
      this.windowSize = null
      this.hitRegions = []
      this.ignoreMouseState = null
      this.lastCursorPoint = null
    })
  }

  public getMainWindow(): BrowserWindow | null {
    return this.mainWindow
  }

  public isVisible(): boolean {
    return this.isWindowVisible
  }

  public hideMainWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.log("Main window does not exist or is destroyed.")
      return
    }

    // Save current position so toggle-on restores it
    const bounds = this.mainWindow.getBounds()
    this.savedTogglePosition = { x: bounds.x, y: bounds.y }
    this.windowPosition = { x: bounds.x, y: bounds.y }
    this.windowSize = { width: bounds.width, height: bounds.height }
    this.mainWindow.hide()
    this.stopHitTestLoop()
    this.isWindowVisible = false
    this.mainWindow.setIgnoreMouseEvents(false)
    this.ignoreMouseState = false
    this.lastCursorPoint = null
  }

  private bringMainWindowToFront(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return
    }

    this.mainWindow.show()
    this.mainWindow.focus()
    this.mainWindow.setAlwaysOnTop(true)
    this.startHitTestLoop()
    this.isWindowVisible = true
    this.lastCursorPoint = null
    this.updateMouseIgnoreState(true)
  }

  public showMainWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.log("Main window does not exist or is destroyed.")
      return
    }

    // Lock dimensions briefly so ResizeObserver doesn't override our position
    this.dimensionLock = true

    // Restore to the position it was at before toggle-off
    if (this.savedTogglePosition && this.windowSize) {
      this.mainWindow.setBounds({
        x: this.savedTogglePosition.x,
        y: this.savedTogglePosition.y,
        width: this.windowSize.width,
        height: this.windowSize.height
      })
      this.windowPosition = { ...this.savedTogglePosition }
      this.currentX = this.savedTogglePosition.x
      this.currentY = this.savedTogglePosition.y
    } else if (this.windowPosition && this.windowSize) {
      this.mainWindow.setBounds({
        x: this.windowPosition.x,
        y: this.windowPosition.y,
        width: this.windowSize.width,
        height: this.windowSize.height
      })
    }

    this.bringMainWindowToFront()

    // Release dimension lock after a short delay
    if (this.dimensionUnlockTimer) {
      clearTimeout(this.dimensionUnlockTimer)
    }
    this.dimensionUnlockTimer = setTimeout(() => {
      this.dimensionLock = false
      this.dimensionUnlockTimer = null
    }, 300)
  }

  public toggleMainWindow(): void {
    if (this.isWindowVisible) {
      this.hideMainWindow()
    } else {
      this.showMainWindow()
    }
  }

  private centerWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      return
    }

    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workArea
    
    const windowBounds = this.mainWindow.getBounds()
    const windowWidth = windowBounds.width || 350
    const windowHeight = windowBounds.height || 50
    
    // Horizontal center, near top of screen
    const centerX = workArea.x + Math.floor((workArea.width - windowWidth) / 2)
    const topY = workArea.y + WindowHelper.STARTUP_Y_OFFSET
    
    this.mainWindow.setBounds({
      x: centerX,
      y: topY,
      width: windowWidth,
      height: windowHeight
    })
    
    this.windowPosition = { x: centerX, y: topY }
    this.windowSize = { width: windowWidth, height: windowHeight }
    this.currentX = centerX
    this.currentY = topY
  }

  public centerAndShowWindow(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) {
      this.log("Main window does not exist or is destroyed.")
      return
    }

    this.centerWindow()
    this.bringMainWindowToFront()
    
    this.log("Window centered and shown")
  }

  /**
   * Reset position to center without changing visibility.
   * Used by tray right-click to re-center regardless of toggle state.
   */
  public resetToCenter(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return

    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workArea
    const windowBounds = this.mainWindow.getBounds()
    const windowWidth = windowBounds.width || 350
    const windowHeight = windowBounds.height || 50

    const centerX = workArea.x + Math.floor((workArea.width - windowWidth) / 2)
    const topY = workArea.y + WindowHelper.STARTUP_Y_OFFSET

    // Update internal position state (even if hidden)
    this.windowPosition = { x: centerX, y: topY }
    this.windowSize = { width: windowWidth, height: windowHeight }
    this.currentX = centerX
    this.currentY = topY
    this.savedTogglePosition = { x: centerX, y: topY }

    if (this.isWindowVisible) {
      // If visible, move the window now
      this.mainWindow.setBounds({
        x: centerX,
        y: topY,
        width: windowWidth,
        height: windowHeight
      })
      this.mainWindow.setAlwaysOnTop(true)
      this.updateMouseIgnoreState(true)
    }
    // If hidden, the saved position will be used when toggle-on happens

    this.log(`Window position reset to center (visible=${this.isWindowVisible})`)
  }

  // New methods for window movement
  public moveWindowRight(): void {
    if (!this.mainWindow) return

    const windowWidth = this.windowSize?.width || 0
    const halfWidth = windowWidth / 2

    // Ensure currentX and currentY are numbers
    this.currentX = Number(this.currentX) || 0
    this.currentY = Number(this.currentY) || 0

    this.currentX = Math.min(
      this.screenWidth - halfWidth,
      this.currentX + this.step
    )
    this.mainWindow.setPosition(
      Math.round(this.currentX),
      Math.round(this.currentY)
    )
    this.mainWindow.setAlwaysOnTop(true)
  }

  public moveWindowLeft(): void {
    if (!this.mainWindow) return

    const windowWidth = this.windowSize?.width || 0
    const halfWidth = windowWidth / 2

    // Ensure currentX and currentY are numbers
    this.currentX = Number(this.currentX) || 0
    this.currentY = Number(this.currentY) || 0

    this.currentX = Math.max(-halfWidth, this.currentX - this.step)
    this.mainWindow.setPosition(
      Math.round(this.currentX),
      Math.round(this.currentY)
    )
    this.mainWindow.setAlwaysOnTop(true)
  }

  public moveWindowDown(): void {
    if (!this.mainWindow) return

    const windowHeight = this.windowSize?.height || 0
    const halfHeight = windowHeight / 2

    // Ensure currentX and currentY are numbers
    this.currentX = Number(this.currentX) || 0
    this.currentY = Number(this.currentY) || 0

    this.currentY = Math.min(
      this.screenHeight - halfHeight,
      this.currentY + this.step
    )
    this.mainWindow.setPosition(
      Math.round(this.currentX),
      Math.round(this.currentY)
    )
    this.mainWindow.setAlwaysOnTop(true)
  }

  public moveWindowUp(): void {
    if (!this.mainWindow) return

    const windowHeight = this.windowSize?.height || 0
    const halfHeight = windowHeight / 2

    // Ensure currentX and currentY are numbers
    this.currentX = Number(this.currentX) || 0
    this.currentY = Number(this.currentY) || 0

    this.currentY = Math.max(-halfHeight, this.currentY - this.step)
    this.mainWindow.setPosition(
      Math.round(this.currentX),
      Math.round(this.currentY)
    )
    this.mainWindow.setAlwaysOnTop(true)
  }
}
