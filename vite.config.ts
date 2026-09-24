import { defineConfig } from 'vite';

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  server: { port: 5173, open: false },
  plugins: [cloudflare()],
  build: { target: 'es2023', chunkSizeWarningLimit: 1500 },
});