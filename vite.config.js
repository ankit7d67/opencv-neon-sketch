import { defineConfig } from 'vite';

export default defineConfig({
  base: './',   // build works from any path/subdirectory
  // fixed ports — 5173 belongs to the cosmic-portal project, so Neon Sketch
  // gets its own. strictPort: true → Vite fails loudly instead of silently
  // hopping to another port if the address is taken.
  server: { port: 5180, strictPort: true },
  preview: { port: 4180, strictPort: true },
});
