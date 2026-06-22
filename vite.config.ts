import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'pdf-vendor': [
            'pdfjs-dist',
            '@react-pdf-viewer/core',
            '@react-pdf-viewer/default-layout',
          ],
        },
      },
    },
  },
  base: './',
})
