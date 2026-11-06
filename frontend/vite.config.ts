import { defineConfig } from 'vite'
import path from 'path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

// production บน Pi: Apache เสิร์ฟ backend/build ที่ /I-DOJO — ห้ามเปลี่ยน base/outDir (ดู DEPLOYMENT.md)
export default defineConfig({
  base: '/I-DOJO/',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/I-DOJO/api': {
        target: 'http://localhost:5000',
        rewrite: (path) => path.replace('/I-DOJO', ''),
      },
    },
  },
  build: {
    outDir: '../backend/build',
    emptyOutDir: true,
  },
});
