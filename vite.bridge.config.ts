import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  build: {
    outDir: '.',
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, 'src/content/chart-bridge.ts'),
      name: 'PaperMemesBridge',
      formats: ['iife'],
      fileName: () => 'content/chart-bridge.js',
    },
  },
})
