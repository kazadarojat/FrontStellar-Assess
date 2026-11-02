import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages menyajikan situs di /<nama-repo>/, sedangkan server lokal di /.
// Workflow deploy mengisi VITE_BASE_PATH secara otomatis.
const base = process.env.VITE_BASE_PATH || '/';

export default defineConfig({
  base,
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
