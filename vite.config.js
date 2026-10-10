import { defineConfig } from 'vite'

// base applies to the production build only — GitHub Pages serves the app
// under /opencv-neon-sketch/; local dev stays at the root.
export default defineConfig(({ command }) => ({
  base: command === 'serve' ? '/' : '/opencv-neon-sketch/',
  server: { port: 5180, strictPort: true },   // 5173 reserved for cosmic-portal
  preview: { port: 4180, strictPort: true },
}))
