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
    rolldownOptions: {
      output: {
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            {
              name: 'sqlite',
              test: /(?:node_modules[\\/]sql\.js[\\/]|src[\\/]lib[\\/]sql-browser\.ts$)/,
              priority: 50
            },
            {
              name: 'assessment',
              test: /src[\\/](?:components[\\/]AssessmentCenterPortal\.tsx|lib[\\/]assessment(?:-runtime)?\.ts)$/,
              priority: 40
            },
            {
              name: 'learning-path',
              test: /src[\\/](?:components[\\/]LearningPathPortal\.tsx|lib[\\/]learning-path\.ts)$/,
              priority: 30
            },
            {
              name: 'charts',
              test: /node_modules[\\/]recharts[\\/]/,
              priority: 10
            }
          ]
        }
      }
    }
  }
}));
