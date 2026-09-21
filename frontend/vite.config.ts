import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Body scanner & virtual try-on API (backend/app.py)
  const backend = env.SCANNER_BACKEND_URL || 'http://127.0.0.1:5050'

  // Every backend path the frontend uses. Proxying them keeps the UI and API
  // on one origin, so the app also works through a public share tunnel.
  const proxy = Object.fromEntries(
    [
      '/start', '/status', '/reset', '/retake_current', '/stop_camera', '/video_feed',
      '/push_frame', '/ground_truth', '/calibration_status', '/measurement_report', '/try_on',
      '/api', '/static/captures', '/static/models',
    ].map((path) => [path, { target: backend, changeOrigin: true }])
  )

  // Hosts of free share tunnels (see ../share.sh)
  const allowedHosts = ['.trycloudflare.com']

  return {
    plugins: [
      react(),
      tailwindcss()
    ],
    server: { proxy, allowedHosts },
    preview: { proxy, allowedHosts },
  }
})
