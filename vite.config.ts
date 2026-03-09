import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  // Use relative asset URLs so Electron file:// loads bundled JS/CSS in production.
  base: "./"
})
