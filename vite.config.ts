import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command }) => ({
  base: command === 'build' && process.env.GITHUB_ACTIONS ? '/sql-learn-web-app/' : '/',
  resolve: {
    alias: [
      {
        find: /^sql\.js$/,
        replacement: fileURLToPath(new URL('./src/lib/sql-browser.ts', import.meta.url))
      }
    ]
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['logo.svg', 'maskable.svg'],
      manifest: {
        name: 'SQL Academy — Support Engineering Track',
        short_name: 'SQL Academy',
        description: 'Практическая SQL Academy для 2nd Support Engineer',
        theme_color: '#09090b',
        background_color: '#09090b',
        display: 'standalone',
        start_url: '.',
        scope: '.',
        icons: [
          { src: 'logo.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' }
        ]
      },
      workbox: {
        cleanupOutdatedCaches: true,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ['**/*.{js,css,html,svg,wasm}']
      }
    })
  ],
  build: {
    sourcemap: true,
    rollupOptions: {
      output: {
        onlyExplicitManualChunks: true,
        manualChunks(id) {
          const normalized = id.replace(/\\/g, '/');
          if (normalized.includes('/node_modules/sql.js/')
            || normalized.endsWith('/src/lib/sql-browser.ts')) return 'sqlite';
          if (normalized.includes('/src/components/AssessmentCenterPortal.tsx')
            || normalized.endsWith('/src/lib/assessment.ts')
            || normalized.endsWith('/src/lib/assessment-runtime.ts')) return 'assessment';
          if (normalized.includes('/src/components/LearningPathPortal.tsx')
            || normalized.endsWith('/src/lib/learning-path.ts')) return 'learning-path';
          if (normalized.includes('/node_modules/@monaco-editor/')) return 'editor';
          if (normalized.includes('/node_modules/recharts/')) return 'charts';
          return undefined;
        }
      }
    }
  }
}));
