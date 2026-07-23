import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig(({ command }) => ({
  base: command === 'build' && process.env.GITHUB_ACTIONS ? '/sql-learn-web-app/' : '/',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
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
        navigateFallback: 'index.html',
        globPatterns: ['**/*.{js,css,html,svg,wasm}'],
        runtimeCaching: [{
          urlPattern: /^https:\/\/sql\.js\.org\//,
          handler: 'CacheFirst',
          options: { cacheName: 'sqljs-runtime', expiration: { maxEntries: 4, maxAgeSeconds: 2592000 } }
        }]
      }
    })
  ],
  build: { sourcemap: true }
}));