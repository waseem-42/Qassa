import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const target = `http://127.0.0.1:${process.env.EDIT_PORT || 4317}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
