type TurnstileWidgetId = string;

type TurnstileOptions = {
  sitekey: string;
  action: string;
  theme: 'auto';
  size: 'flexible';
  execution: 'execute';
  appearance: 'interaction-only';
  language: 'ru';
  callback: (token: string) => void;
  'error-callback': (code?: string) => void;
  'expired-callback': () => void;
  'timeout-callback': () => void;
  'unsupported-callback': () => void;
};

type TurnstileApi = {
  render(container: HTMLElement, options: TurnstileOptions): TurnstileWidgetId;
  execute(widget: TurnstileWidgetId): void;
  remove(widget: TurnstileWidgetId): void;
};

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_ID = 'sql-academy-turnstile-script';
const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const ACTION_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;
const SITE_KEY_PATTERN = /^[A-Za-z0-9_-]{8,160}$/;
const TOKEN_TIMEOUT_MS = 60_000;

let scriptPromise: Promise<TurnstileApi> | null = null;
let activeAction = '';
let activePromise: Promise<string> | null = null;

function waitForBody() {
  if (document.body) return Promise.resolve(document.body);
  return new Promise<HTMLElement>(resolve => {
    window.addEventListener('DOMContentLoaded', () => resolve(document.body), { once: true });
  });
}

function loadTurnstileScript() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<TurnstileApi>((resolve, reject) => {
    const existing = document.getElementById(SCRIPT_ID) as HTMLScriptElement | null;
    const script = existing || document.createElement('script');
    const timeout = window.setTimeout(() => reject(new Error('Turnstile не загрузился вовремя. Проверь сеть и попробуй снова.')), 20_000);

    const finish = () => {
      window.clearTimeout(timeout);
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile загрузился без клиентского API. Обнови страницу.'));
    };
    const fail = () => {
      window.clearTimeout(timeout);
      scriptPromise = null;
      reject(new Error('Не удалось загрузить Turnstile. Проверь блокировщик скриптов и сеть.'));
    };

    script.addEventListener('load', finish, { once: true });
    script.addEventListener('error', fail, { once: true });
    if (!existing) {
      script.id = SCRIPT_ID;
      script.src = SCRIPT_URL;
      script.async = true;
      script.defer = true;
      script.referrerPolicy = 'no-referrer';
      document.head.appendChild(script);
    }
  });

  return scriptPromise;
}

function challengeShell(action: string) {
  const shell = document.createElement('section');
  shell.className = 'turnstile-challenge-shell';
  shell.setAttribute('role', 'dialog');
  shell.setAttribute('aria-modal', 'false');
  shell.setAttribute('aria-label', 'Проверка безопасности');
  shell.dataset.action = action;

  const copy = document.createElement('div');
  copy.className = 'turnstile-challenge-copy';
  const title = document.createElement('strong');
  title.textContent = 'Проверка безопасности';
  const status = document.createElement('span');
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.textContent = 'Подтверждаем, что запрос отправляет человек…';
  copy.append(title, status);

  const widget = document.createElement('div');
  widget.className = 'turnstile-widget-slot';
  shell.append(copy, widget);
  return { shell, widget, status };
}

export function getTurnstileToken(siteKey: string, action: string): Promise<string> {
  if (!SITE_KEY_PATTERN.test(siteKey)) return Promise.reject(new Error('Публичный ключ Turnstile настроен неверно.'));
  if (!ACTION_PATTERN.test(action)) return Promise.reject(new Error('Действие Turnstile настроено неверно.'));
  if (activePromise) {
    if (activeAction === action) return activePromise;
    return Promise.reject(new Error('Другая проверка безопасности уже выполняется. Заверши её и повтори действие.'));
  }

  activeAction = action;
  activePromise = (async () => {
    const [body, api] = await Promise.all([waitForBody(), loadTurnstileScript()]);
    const { shell, widget, status } = challengeShell(action);
    body.appendChild(shell);

    return new Promise<string>((resolve, reject) => {
      let settled = false;
      let widgetId: TurnstileWidgetId | null = null;
      const timeout = window.setTimeout(() => finish(new Error('Проверка Turnstile заняла слишком много времени. Повтори действие.')), TOKEN_TIMEOUT_MS);

      const cleanup = () => {
        window.clearTimeout(timeout);
        if (widgetId) {
          try { api.remove(widgetId); } catch { /* Widget may already be gone. */ }
        }
        shell.remove();
      };
      const finish = (result: string | Error) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (typeof result === 'string') resolve(result);
        else reject(result);
      };

      try {
        widgetId = api.render(widget, {
          sitekey: siteKey,
          action,
          theme: 'auto',
          size: 'flexible',
          execution: 'execute',
          appearance: 'interaction-only',
          language: 'ru',
          callback: token => finish(token),
          'error-callback': code => finish(new Error(`Turnstile не завершил проверку${code ? ` (${code})` : ''}. Повтори действие.`)),
          'expired-callback': () => finish(new Error('Проверка Turnstile истекла. Повтори действие.')),
          'timeout-callback': () => finish(new Error('Turnstile ожидает повторной попытки. Запусти действие ещё раз.')),
          'unsupported-callback': () => finish(new Error('Этот браузер не поддерживает Turnstile. Обнови браузер или используй другой.'))
        });
        status.textContent = 'Проверка выполняется. Если потребуется действие, виджет появится здесь.';
        api.execute(widgetId);
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  })().finally(() => {
    activeAction = '';
    activePromise = null;
  });

  return activePromise;
}

export {};
