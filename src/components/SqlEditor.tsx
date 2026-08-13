import MonacoEditor, { loader, type EditorProps } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api';
import 'monaco-editor/languages/definitions/sql/register';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';

type MonacoEnvironment = typeof globalThis & {
  MonacoEnvironment?: { getWorker: () => Worker };
};

(globalThis as MonacoEnvironment).MonacoEnvironment = {
  getWorker: () => new EditorWorker()
};
loader.config({ monaco });

const DARK_THEME = 'sql-academy-dark';

type MonacoApi = Parameters<NonNullable<EditorProps['beforeMount']>>[0];

function defineAccessibleDarkTheme(monaco: MonacoApi) {
  monaco.editor.defineTheme(DARK_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '7FBA70' },
      { token: 'string', foreground: 'FF8080' },
      { token: 'string.sql', foreground: 'FF8080' }
    ],
    colors: {}
  });
}

export default function SqlEditor({ beforeMount, theme, ...props }: EditorProps) {
  const prepareTheme: NonNullable<EditorProps['beforeMount']> = monaco => {
    defineAccessibleDarkTheme(monaco);
    beforeMount?.(monaco);
  };

  return <MonacoEditor
    {...props}
    beforeMount={prepareTheme}
    theme={theme === 'vs-dark' ? DARK_THEME : theme}
  />;
}
