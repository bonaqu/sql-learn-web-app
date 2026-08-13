import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { escapeHtml, loadProductIdentity, productFullTitle } from './scripts/product-identity.ts';

const identity = loadProductIdentity(process.cwd());
const fullTitle = productFullTitle(identity);
const ogLocale = identity.locale === 'ru' ? 'ru_RU' : identity.locale.replace('-', '_');

function productIdentityHtml() {
  return {
    name: 'product-identity-html',
    transformIndexHtml(html: string) {
      const canonical = [
        `<link rel="canonical" href="${escapeHtml(identity.homepageUrl)}" />`,
        `<meta property="og:url" content="${escapeHtml(identity.homepageUrl)}" />`
      ].join('\n    ');
      return html
        .replaceAll('__PRODUCT_LOCALE__', escapeHtml(identity.locale))
        .replaceAll('__PRODUCT_OG_LOCALE__', escapeHtml(ogLocale))
        .replaceAll('__PRODUCT_FULL_TITLE__', escapeHtml(fullTitle))
        .replaceAll('__PRODUCT_DESCRIPTION__', escapeHtml(identity.description))
        .replaceAll('__PRODUCT_NAME__', escapeHtml(identity.productName))
        .replaceAll('__PRODUCT_LICENSE_NAME__', escapeHtml(identity.licenseName))
        .replaceAll('__PRODUCT_PRIVACY_SUMMARY__', escapeHtml(identity.privacySummary))
        .replace('<!-- PRODUCT_CANONICAL -->', canonical);
    }
  };
}

export default defineConfig(({ command }) => ({
  base: command === 'build' && process.env.GITHUB_ACTIONS ? '/sql-learn-web-app/' : '/',
  preview: {
    proxy: {
      '/api': {
        target: `http://127.0.0.1:${process.env.PLAYWRIGHT_WORKER_PORT || '8792'}`,
        changeOrigin: true
      }
    }
  },
  resolve: {
    alias: [
      {
        find: /^sql\.js$/,
        replacement: fileURLToPath(new URL('./src/lib/sql-browser.ts', import.meta.url))
      }
    ]
  },
  plugins: [
    productIdentityHtml(),
    react(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: null,
      includeAssets: ['logo.svg', 'maskable.svg'],
      manifest: {
        name: fullTitle,
        short_name: identity.shortName,
        description: identity.description,
        lang: identity.locale,
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
    sourcemap: false,
    rolldownOptions: {
      output: {
        codeSplitting: {
          includeDependenciesRecursively: false,
          groups: [
            {
              name: 'monaco-base',
              test: /node_modules[\\/]monaco-editor[\\/]esm[\\/]vs[\\/]base[\\/]/,
              priority: 70
            },
            {
              name: 'monaco-platform',
              test: /node_modules[\\/]monaco-editor[\\/]esm[\\/]vs[\\/]platform[\\/]/,
              priority: 69
            },
            {
              name: 'monaco-editor-browser',
              test: /node_modules[\\/]monaco-editor[\\/]esm[\\/]vs[\\/]editor[\\/]browser[\\/]/,
              priority: 68
            },
            {
              name: 'monaco-editor-common',
              test: /node_modules[\\/]monaco-editor[\\/]esm[\\/]vs[\\/]editor[\\/]common[\\/]/,
              priority: 67
            },
            {
              name: 'monaco-editor-contrib',
              test: /node_modules[\\/]monaco-editor[\\/]esm[\\/]vs[\\/]editor[\\/]contrib[\\/]/,
              priority: 66
            },
            {
              name: 'monaco-editor-standalone',
              test: /node_modules[\\/]monaco-editor[\\/]esm[\\/]vs[\\/]editor[\\/]standalone[\\/]/,
              priority: 65
            },
            {
              name: 'monaco-editor-core',
              test: /node_modules[\\/]monaco-editor[\\/]esm[\\/]vs[\\/]editor[\\/]/,
              priority: 64
            },
            {
              name: 'monaco-features',
              test: /node_modules[\\/]monaco-editor[\\/]esm[\\/]vs[\\/]features[\\/]/,
              priority: 63
            },
            {
              name: 'monaco-language',
              test: /node_modules[\\/]monaco-editor[\\/]esm[\\/]vs[\\/]languages?[\\/]/,
              priority: 62
            },
            {
              name: 'sqlite',
              test: /(?:node_modules[\\/]sql\.js[\\/]|src[\\/]lib[\\/]sql-browser\.ts$)/,
              priority: 50
            },
            {
              name: 'assessment',
              test: /src[\\/](?:components[\\/]AssessmentCenterPortal\.tsx|lib[\\/]assessment(?:-runtime)?\.ts|data[\\/]sql-exams\.ts)$/,
              priority: 40
            },
            {
              name: 'learning-path',
              test: /src[\\/](?:components[\\/]LearningPathPortal\.tsx|lib[\\/]learning-path\.ts)$/,
              priority: 30
            }
          ]
        }
      }
    }
  }
}));
