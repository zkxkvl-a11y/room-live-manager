import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Cloudflare Pages exposes the deployed commit SHA during production builds.
const buildId = process.env.CF_PAGES_COMMIT_SHA || process.env.GITHUB_SHA || 'local-dev'

export default defineConfig({
  plugins: [react(), {
    name: 'room-live-version-manifest',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ version: buildId }) })
    },
  }],
  define: { __ROOM_LIVE_BUILD__: JSON.stringify(buildId) },
})
