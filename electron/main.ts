import dotenv from "dotenv"
import { app, BrowserWindow, Tray, nativeImage, Menu, screen } from "electron"
import fs from "fs"
import { initializeIpcHandlers } from "./ipcHandlers"
import { WindowHelper } from "./WindowHelper"
import { ShortcutsHelper } from "./shortcuts"
import { PERSONALITY_PRESETS, ProcessingHelper } from "./ProcessingHelper"
import path from "node:path"
import { appendAppLog } from "./logger"

function log(msg: string) {
  appendAppLog(msg)
}

function resolveEnvCandidates(): string[] {
  const candidates = new Set<string>()
  const cwd = process.cwd()
  const execDir = path.dirname(process.execPath)
  const resourcesPath = process.resourcesPath
  const portableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR
  const portableExecutableFile = process.env.PORTABLE_EXECUTABLE_FILE

  if (process.env.NODE_ENV === "development") {
    candidates.add(path.join(cwd, ".env"))
    candidates.add(path.join(app.getAppPath(), ".env"))
    return Array.from(candidates)
  }

  if (portableExecutableDir) {
    candidates.add(path.join(portableExecutableDir, ".env"))
    candidates.add(path.join(portableExecutableDir, "..", ".env"))
  }
  if (portableExecutableFile) {
    const portableFileDir = path.dirname(portableExecutableFile)
    candidates.add(path.join(portableFileDir, ".env"))
    candidates.add(path.join(portableFileDir, "..", ".env"))
  }
  candidates.add(path.join(execDir, ".env"))
  candidates.add(path.join(execDir, "..", ".env"))
  candidates.add(path.join(app.getPath("userData"), ".env"))
  if (resourcesPath) {
    candidates.add(path.join(resourcesPath, ".env"))
  }
  candidates.add(path.join(cwd, ".env"))
  candidates.add(path.join(app.getAppPath(), ".env"))

  return Array.from(candidates)
}

function loadRuntimeEnvironment(): void {
  const candidates = resolveEnvCandidates()
  const loadedFrom: string[] = []
  const portableExecutableDir = process.env.PORTABLE_EXECUTABLE_DIR
  const portableExecutableFile = process.env.PORTABLE_EXECUTABLE_FILE

  for (const envPath of candidates) {
    try {
      if (!envPath) continue
      if (!fs.existsSync(envPath)) continue
      dotenv.config({ path: envPath, override: false })
      loadedFrom.push(envPath)
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "unknown error"
      log(`[ENV] Failed loading ${envPath}: ${message}`)
    }
  }

  log(`[ENV] cwd=${process.cwd()}`)
  log(`[ENV] execPath=${process.execPath}`)
  log(`[ENV] portableExecutableDir=${portableExecutableDir ?? ""}`)
  log(`[ENV] portableExecutableFile=${portableExecutableFile ?? ""}`)
  log(`[ENV] appPath=${app.getAppPath()}`)
  log(`[ENV] resourcesPath=${process.resourcesPath ?? ""}`)
  log(`[ENV] searched=${candidates.join(" | ")}`)
  log(`[ENV] loaded=${loadedFrom.length > 0 ? loadedFrom.join(" | ") : "none"}`)
  log(`[ENV] ELEVENLABS_API_KEY length=${(process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY || "").trim().length}`)
  log(`[ENV] ELEVENLABS_REALTIME_TOKEN length=${(process.env.ELEVENLABS_REALTIME_TOKEN || "").trim().length}`)
}

// Load environment variables from explicit runtime locations.
loadRuntimeEnvironment()
log('App started')

const isDev = process.env.NODE_ENV === "development"

export class AppState {
  private static instance: AppState | null = null

  private windowHelper: WindowHelper
  public shortcutsHelper: ShortcutsHelper
  public processingHelper: ProcessingHelper
  private tray: Tray | null = null
  private personalityWindow: BrowserWindow | null = null

  constructor() {
    // Initialize WindowHelper with this
    log('Constructing WindowHelper')
    this.windowHelper = new WindowHelper(this)
    log('WindowHelper initialized')

    log('Constructing ProcessingHelper')
    this.processingHelper = new ProcessingHelper(this)
    log('ProcessingHelper initialized')

    log('Constructing ShortcutsHelper')
    this.shortcutsHelper = new ShortcutsHelper(this)
    log('ShortcutsHelper initialized')
  }

  public static getInstance(): AppState {
    if (!AppState.instance) {
      AppState.instance = new AppState()
    }
    return AppState.instance
  }

  // Getters and Setters
  public getMainWindow(): BrowserWindow | null {
    return this.windowHelper.getMainWindow()
  }

  public isVisible(): boolean {
    return this.windowHelper.isVisible()
  }

  // Window management methods
  public createWindow(): void {
    log('AppState.createWindow called')
    this.windowHelper.createWindow()
  }

  public hideMainWindow(): void {
    this.windowHelper.hideMainWindow()
  }

  public showMainWindow(): void {
    this.windowHelper.showMainWindow()
  }

  public toggleMainWindow(): void {
    this.windowHelper.toggleMainWindow()
  }

  public setWindowDimensions(width: number, height: number): void {
    this.windowHelper.setWindowDimensions(width, height)
  }

  public setHitRegions(regions: Array<{ x: number; y: number; width: number; height: number }>): void {
    this.windowHelper.setHitRegions(regions)
  }

  // New methods to move the window
  public moveWindowLeft(): void {
    this.windowHelper.moveWindowLeft()
  }

  public moveWindowRight(): void {
    this.windowHelper.moveWindowRight()
  }
  public moveWindowDown(): void {
    this.windowHelper.moveWindowDown()
  }
  public moveWindowUp(): void {
    this.windowHelper.moveWindowUp()
  }

  public centerAndShowWindow(): void {
    this.windowHelper.centerAndShowWindow()
  }

  public resetToCenter(): void {
    this.windowHelper.resetToCenter()
  }

  public createTray(): void {
    const iconCandidates = [
      path.join(process.resourcesPath, "assets", "icons", "win", "icon.ico"),
      path.join(app.getAppPath(), "assets", "icons", "win", "icon.ico"),
      path.join(__dirname, "..", "electron", "tray-icon.png"),
    ]
    const iconPath = iconCandidates.find((candidate) => fs.existsSync(candidate)) || iconCandidates[0]
    const trayImage = nativeImage.createFromPath(iconPath)
    this.tray = new Tray(trayImage)
    this.tray.setToolTip('Insight')
    log(`[Tray] icon path=${iconPath}, empty=${trayImage.isEmpty()}`)

    // Left-click toggles window (preserves last position)
    this.tray.on('click', () => {
      this.toggleMainWindow()
    })

    // Right-click shows context menu with Reset + Personality options
    this.tray.on('right-click', () => {
      const presets = PERSONALITY_PRESETS.map((preset) => ({
        id: preset.id,
        label: preset.label,
      }))

      const personalitySubmenu = presets.map(p => ({
        label: p.label,
        click: () => {
          this.processingHelper.applyPreset(p.id)
          const mainWindow = this.getMainWindow()
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("personality-changed", p.id)
          }
        },
      }))

      personalitySubmenu.push(
        { type: "separator" } as any,
        {
          label: "Custom…",
          click: () => {
            this.createPersonalityWindow()
          },
        }
      )

      const contextMenu = Menu.buildFromTemplate([
        {
          label: "Reset Position",
          click: () => this.resetToCenter(),
        },
        { type: "separator" },
        {
          label: "Personality",
          submenu: personalitySubmenu as any,
        },
        { type: "separator" },
        {
          label: "Quit",
          click: () => {
            app.quit()
            setTimeout(() => process.exit(0), 3000)
          },
        },
      ])

      this.tray!.popUpContextMenu(contextMenu)
    })
    
    // Set a title for macOS (will appear in menu bar)
    if (process.platform === 'darwin') {
      this.tray.setTitle('Insight')
    }
  }

  // ── Personality child window ─────────────────────────────────

  public createPersonalityWindow(): void {
    // If already open, focus it
    if (this.personalityWindow && !this.personalityWindow.isDestroyed()) {
      this.personalityWindow.focus()
      return
    }

    const PANEL_W = 320
    const PANEL_H = 380
    const EDGE_PAD = 16

    const primaryDisplay = screen.getPrimaryDisplay()
    const workArea = primaryDisplay.workArea

    const x = workArea.x + workArea.width - PANEL_W - EDGE_PAD
    const y = workArea.y + workArea.height - PANEL_H - EDGE_PAD

    this.personalityWindow = new BrowserWindow({
      width: PANEL_W,
      height: PANEL_H,
      x,
      y,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: "#00000000",
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: true,
        preload: path.join(__dirname, "preload.js"),
      },
    })

    this.personalityWindow.setContentProtection(true)
    log('[Personality] Creating personality window')
    if (isDev) {
      this.personalityWindow.loadURL("http://localhost:5180?view=personality")
      log('[Personality] Loading dev personality URL')
    } else {
      const pfile = path.join(app.getAppPath(), "dist", "index.html")
      this.personalityWindow.loadFile(pfile, { query: { view: "personality" } })
      log('[Personality] Loading file: ' + pfile)
    }

    this.personalityWindow.once("ready-to-show", () => {
      this.personalityWindow?.show()
    })

    this.personalityWindow.on("closed", () => {
      this.personalityWindow = null
    })

    // Close on blur (focus loss)
    this.personalityWindow.on("blur", () => {
      this.destroyPersonalityWindow()
    })
  }

  public destroyPersonalityWindow(): void {
    if (this.personalityWindow && !this.personalityWindow.isDestroyed()) {
      this.personalityWindow.close()
    }
    this.personalityWindow = null
  }
}

// Application initialization
async function initializeApp() {
  log('Calling AppState.getInstance')
  const appState = AppState.getInstance()
  log('AppState instance obtained')

  const hasSingleInstanceLock = app.requestSingleInstanceLock()
  log('Single instance lock result: ' + hasSingleInstanceLock)
  if (!hasSingleInstanceLock) {
    log('Second instance detected, quitting')
    app.quit()
    return
  }

    app.on("second-instance", () => {
      log('Second instance event: focusing main window')
      const mainWindow = appState.getMainWindow()
      if (mainWindow && !mainWindow.isDestroyed()) {
        appState.centerAndShowWindow()
      }
    })

  log('Initializing IPC handlers')
  initializeIpcHandlers(appState)
  log('IPC handlers initialized')

  app.whenReady().then(() => {
    log('App is ready')
    log('Calling appState.createWindow')
    appState.createWindow()
    log('Calling appState.createTray')
    appState.createTray()
    // Register global shortcuts using ShortcutsHelper
    log('Registering global shortcuts')
    appState.shortcutsHelper.registerGlobalShortcuts()
    log('Global shortcuts registered')
  })

  app.on("activate", () => {
    if (appState.getMainWindow() === null) {
      log('App activated: main window was null, recreating')
      appState.createWindow()
    }
  })

  // Graceful cleanup before quit: stop recording and clean up
  app.on("before-quit", () => {
    log('before-quit: cleaning up')
    try {
      if (appState.processingHelper.isRealtimeRecording()) {
        appState.processingHelper.stopRealtimeRecording()
        log('before-quit: recording stopped')
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "unknown error"
      log('before-quit cleanup error: ' + message)
    }
  })

  // Quit when all windows are closed, except on macOS
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      log('All windows closed, quitting app')
      app.quit()
    }
  })

  app.dock?.hide() // Hide dock icon (optional)
  app.commandLine.appendSwitch("disable-background-timer-throttling")
  log('App initialization complete')
}

// Start the application
initializeApp().catch((error) => {
  const message = error instanceof Error ? error.message : String(error)
  appendAppLog(`[App] initializeApp failed: ${message}`)
})
