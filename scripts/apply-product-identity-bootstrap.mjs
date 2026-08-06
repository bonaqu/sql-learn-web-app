import { readFileSync, writeFileSync } from 'node:fs';

const read = path => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');
const write = (path, content) => writeFileSync(path, content.replace(/\r\n/g, '\n'));
const replaceOnce = (source, before, after, label) => {
  if (!source.includes(before)) throw new Error(`Missing bootstrap marker: ${label}`);
  if (source.indexOf(before) !== source.lastIndexOf(before)) throw new Error(`Ambiguous bootstrap marker: ${label}`);
  return source.replace(before, after);
};

const indexHtml = `<!doctype html>
<html lang="__PRODUCT_LOCALE__">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#09090b" />
    <meta name="description" content="__PRODUCT_DESCRIPTION__" />
    <meta name="application-name" content="__PRODUCT_NAME__" />
    <meta name="license" content="__PRODUCT_LICENSE_NAME__" />
    <meta name="privacy" content="__PRODUCT_PRIVACY_SUMMARY__" />
    <meta property="og:type" content="website" />
    <meta property="og:locale" content="__PRODUCT_OG_LOCALE__" />
    <meta property="og:title" content="__PRODUCT_FULL_TITLE__" />
    <meta property="og:description" content="__PRODUCT_DESCRIPTION__" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="__PRODUCT_FULL_TITLE__" />
    <meta name="twitter:description" content="__PRODUCT_DESCRIPTION__" />
    <!-- PRODUCT_CANONICAL -->
    <link rel="icon" type="image/svg+xml" href="./logo.svg" />
    <title>__PRODUCT_FULL_TITLE__</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`;
write('index.html', indexHtml);

const viteConfig = `import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { escapeHtml, loadProductIdentity, productFullTitle } from './scripts/product-identity';

const identity = loadProductIdentity(process.cwd());
const fullTitle = productFullTitle(identity);
const ogLocale = identity.locale === 'ru' ? 'ru_RU' : identity.locale.replace('-', '_');

function productIdentityHtml() {
  return {
    name: 'product-identity-html',
    transformIndexHtml(html: string) {
      const canonical = [
        \`<link rel="canonical" href="\${escapeHtml(identity.homepageUrl)}" />\`,
        \`<meta property="og:url" content="\${escapeHtml(identity.homepageUrl)}" />\`
      ].join('\\n    ');
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
  resolve: {
    alias: [
      {
        find: /^sql\\.js$/,
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
        navigateFallbackDenylist: [/^\\/api\\//],
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
              test: /(?:node_modules[\\\\/]sql\\.js[\\\\/]|src[\\\\/]lib[\\\\/]sql-browser\\.ts$)/,
              priority: 50
            },
            {
              name: 'assessment',
              test: /src[\\\\/](?:components[\\\\/]AssessmentCenterPortal\\.tsx|lib[\\\\/]assessment(?:-runtime)?\\.ts|data[\\\\/]sql-exams\\.ts)$/,
              priority: 40
            },
            {
              name: 'learning-path',
              test: /src[\\\\/](?:components[\\\\/]LearningPathPortal\\.tsx|lib[\\\\/]learning-path\\.ts)$/,
              priority: 30
            }
          ]
        }
      }
    }
  }
}));
`;
write('vite.config.ts', viteConfig);

let app = read('src/App.tsx');
app = replaceOnce(app,
  "import { localMentor, MentorMode } from './lib/mentor';",
  "import { localMentor, MentorMode } from './lib/mentor';\nimport { productIdentity } from './generated/product-identity';",
  'App identity import');
app = replaceOnce(app,
  '<button className="logo" onClick={() => navigate(\'home\')} aria-label="SQL Academy — главная">',
  '<button className="logo" onClick={() => navigate(\'home\')} aria-label={`${productIdentity.productName} — главная`}>',
  'App logo aria-label');
app = replaceOnce(app, '<strong>SQL Academy</strong>', '<strong>{productIdentity.shortName}</strong>', 'App logo name');
app = replaceOnce(app,
  `      <div className="sidebar-bottom">
        <a href="https://github.com/bonaqu/sql-learn-web-app" target="_blank" rel="noreferrer"><Code2 size={17} /> GitHub</a>
        <span className="privacy">Open-source · privacy-first</span>
      </div>`,
  `      <div className="sidebar-bottom">
        <a href={productIdentity.repositoryUrl} target="_blank" rel="noreferrer"><Code2 size={17} /> Репозиторий</a>
        <a href={productIdentity.supportUrl} target="_blank" rel="noreferrer"><MessageSquareText size={17} /> Поддержка</a>
        <span className="privacy">{productIdentity.licenseLabel} · {productIdentity.privacyLabel}</span>
      </div>`,
  'App sidebar identity');
app = replaceOnce(app,
  '<span>SQL Academy · T-Bonk training dataset · privacy-first</span>',
  '<span>{productIdentity.productName} · T-Bonk training dataset · {productIdentity.privacyLabel}</span>',
  'App footer identity');
write('src/App.tsx', app);

let commercial = read('src/components/CommercialIdentityPortal.tsx');
commercial = replaceOnce(commercial,
  "import { useDialogFocus } from '../lib/dialog-focus';",
  "import { useDialogFocus } from '../lib/dialog-focus';\nimport { productIdentity } from '../generated/product-identity';",
  'Commercial identity import');
commercial = replaceOnce(commercial,
  'Контакт используется только для подтверждения, восстановления и чувствительных действий. SQL Academy сохраняет HMAC-отпечаток и маску, а не полный адрес или номер.',
  'Контакт используется только для подтверждения, восстановления и чувствительных действий. {productIdentity.productName} сохраняет HMAC-отпечаток и маску, а не полный адрес или номер.',
  'Commercial identity product name');
write('src/components/CommercialIdentityPortal.tsx', commercial);

let readme = read('README.md');
readme = replaceOnce(readme,
  'Open-source SQL-платформа для быстрого профессионального обучения 2nd Support Engineer. Репозиторий не содержит имени владельца, работодателя, адресов, телефонов или реальных рабочих данных. Все компании, сотрудники и обращения в учебном наборе вымышлены; основной банк в кейсах называется **T-Bonk**.',
  'Коммерчески лицензируемая SQL-платформа для быстрого профессионального обучения 2nd Support Engineer. Публичный бренд, homepage, repository и support URL задаются единым buyer-owned контрактом; учебные компании, сотрудники и обращения вымышлены, а основной банк в кейсах называется **T-Bonk**.',
  'README license posture');
readme = replaceOnce(readme,
  '- GitHub Pages: https://bonaqu.github.io/sql-learn-web-app/\n- Cloudflare Worker: https://sql-learn-web-app.bonaqu.workers.dev',
  '- Канонический frontend URL: поле `homepageUrl` в [`config/product-identity.json`](config/product-identity.json).\n- Репозиторий и поддержка: поля `repositoryUrl` и `supportUrl` в том же identity-контракте.\n- Cloudflare API hostname относится к deployment security configuration и не используется как публичный бренд.',
  'README deployment URLs');
readme += `

## Product identity и передача покупателю

Публичное имя, track, описание, homepage, repository/support URL, лицензионная подпись и privacy label находятся в одном файле [`config/product-identity.json`](config/product-identity.json). После изменения выполняются \`npm run identity:generate\`, \`npm run identity:check\` и production build.

Полная процедура ребрендинга, URL/security boundary и правило сохранения внутренних storage/API identifiers: [`docs/product-identity-handoff.md`](docs/product-identity-handoff.md).

## Лицензия

Исходный код распространяется по условиям файла [`LICENSE`](LICENSE) и не заявляется как open source. Сторонние зависимости сохраняют собственные лицензии и перечислены в [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
`;
write('README.md', readme);

const manifest = JSON.parse(read('package.json'));
manifest.license = 'SEE LICENSE IN LICENSE';
manifest.scripts['identity:generate'] = 'tsx scripts/generate-product-identity.ts';
manifest.scripts['identity:check'] = 'tsx scripts/generate-product-identity.ts --check';
manifest.scripts['validate:product-identity'] = 'tsx scripts/validate-product-identity.ts';
manifest.scripts.build = `npm run identity:check && ${manifest.scripts.build}`;
manifest.scripts.check = `npm run identity:check && ${manifest.scripts.check} && npm run validate:product-identity`;
write('package.json', `${JSON.stringify(manifest, null, 2)}\n`);

const lock = JSON.parse(read('package-lock.json'));
lock.packages[''].license = 'SEE LICENSE IN LICENSE';
write('package-lock.json', `${JSON.stringify(lock, null, 2)}\n`);

console.log('Applied buyer product identity bootstrap across HTML, PWA build, runtime, README and package metadata.');
