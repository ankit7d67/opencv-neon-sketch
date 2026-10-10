import { defineConfig } from 'vite';

export default defineConfig({
  base: './',   // build works from any path/subdirectory
  server: { port: 5173 },
});
