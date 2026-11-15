import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

const target = `http://127.0.0.1:${process.env.EDIT_PORT || 4317}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // the shared package from source, not via a node_modules link (survives a renamed/moved repo)
  resolve: { alias: { '@edit/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: {
      '/api': target,
      '/files': target,
      '/graphics-lib': target,
      '/ws': { target: target.replace('http', 'ws'), ws: true },
    },
  },
});
