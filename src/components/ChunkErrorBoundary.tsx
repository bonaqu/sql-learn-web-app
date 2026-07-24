import { Component, ErrorInfo, ReactNode } from 'react';

function chunkFailure(error: unknown) {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return /ChunkLoadError|dynamically imported module|Loading chunk|Importing a module script failed/i.test(message);
}

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class ChunkErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('lazy_chunk_boundary', { name: error.name, message: error.message, componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;
    const recoverable = chunkFailure(this.state.error);
    return <main className="runtime-recovery" role="alert" data-testid="runtime-recovery">
      <h1>{recoverable ? 'Приложение обновилось' : 'Не удалось открыть модуль'}</h1>
      <p>{recoverable
        ? 'Запрошенный модуль относится к предыдущей версии. Локальный прогресс не потерян.'
        : 'Интерфейс остановлен, чтобы не продолжать работу в неконсистентном состоянии.'}</p>
      <div>
        <button type="button" onClick={() => window.location.reload()}>Перезагрузить приложение</button>
        <button type="button" onClick={() => this.setState({ error: null })}>Попробовать без перезагрузки</button>
      </div>
    </main>;
  }
}
