import MonacoEditor, { type EditorProps } from '@monaco-editor/react';

const DARK_THEME = 'sql-academy-dark';

type MonacoApi = Parameters<NonNullable<EditorProps['beforeMount']>>[0];

function defineAccessibleDarkTheme(monaco: MonacoApi) {
  monaco.editor.defineTheme(DARK_THEME, {
    base: 'vs-dark',
    inherit: true,
    rules: [
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
