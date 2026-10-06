import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// vite.config.js
// This tells Vite (our build tool) how to run the React app.
// The proxy section forwards /api requests to our Express backend.
// This way, the frontend can call /api/chat and it automatically goes to localhost:3001/api/chat

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        secure: false,
      }
    }
  }
})
