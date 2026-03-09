import fs from "fs"
import os from "os"
import path from "path"

const defaultLogDir =
  process.platform === "win32"
    ? path.join(os.homedir(), "AppData", "Roaming", "Insight")
    : path.join(os.homedir(), ".config", "Insight")

export const appLogPath = path.join(defaultLogDir, "log.txt")

export function appendAppLog(message: string): void {
  try {
    fs.mkdirSync(defaultLogDir, { recursive: true })
    fs.appendFileSync(appLogPath, `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    // Logging must never crash the app.
  }
}