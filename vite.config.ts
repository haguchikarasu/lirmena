import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  base: '/lirmena/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        contents: resolve(__dirname, 'contents.html'),
      },
    },
  },
})
