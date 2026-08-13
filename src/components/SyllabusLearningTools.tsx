import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  BookMarked,
  CheckCircle2,
  ChevronRight,
  CircleHelp,
  Clock3,
  Code2,
  Database,
  Gauge,
  KeyRound,
  Layers3,
  LockKeyhole,
  RefreshCw,
  ShieldAlert,
  Table2
} from 'lucide-react';
import { errorAtlas, type ErrorAtlasCategory } from '../data/sql-error-atlas';
import { schemaTables } from '../data/schema-explorer';
import {
  dueReviewCards,
  gradeReviewCard,
  loadReviewState,
  nextReviewAt,
  reviewStats,
  type ReviewGrade,
  type ReviewIntroductionSource
} from '../lib/spaced-repetition';

const gradeLabels: Record<ReviewGrade, { title: string; detail: string }> = {
  again: { title: 'Снова', detail: 'через 10 минут' },
  hard: { title: 'Тяжело', detail: 'короткий интервал' },
  good: { title: 'Нормально', detail: 'обычный интервал' },
  easy: { title: 'Легко', detail: 'длинный интервал' }
};

const introductionLabels: Record<ReviewIntroductionSource, string> = {
  lesson: 'пройденная теория и проверка понимания',
  'independent-practice': 'самостоятельно выполненный SQL',
  'legacy-practice': 'ранее завершённая практика без доказательства прочного освоения'
};

export function SpacedReview() {
  const [state, setState] = useState(() => loadReviewState());
  const [revealed, setRevealed] = useState(false);
  const due = useMemo(() => dueReviewCards(state), [state]);
  const stats = useMemo(() => reviewStats(state), [state]);
  const card = due[0];
  const schedule = card ? state.schedules[card.id] : null;
  const next = nextReviewAt(state);

  const grade = (value: ReviewGrade) => {
    if (!card) return;
    setState(gradeReviewCard(card.id, value));
    setRevealed(false);
  };

  return <main className="review-studio" data-testid="spaced-review">
    <header className="learning-tool-hero">
      <div><small>Воспроизведение по памяти · интервальное повторение</small><h1>Карточки для повторения</h1><p>Сначала воспроизведи модель по памяти, затем сравни ответ и оцени сложность. Самооценка меняет только расписание карточки: прочное освоение подтверждает отдельная отложенная SQL-задача без помощи.</p></div>
      <div className="review-due-badge"><RefreshCw /><strong>{stats.due}</strong><span>карточек сегодня</span></div>
    </header>

    <section className="review-stat-grid" aria-label="Статистика повторения">
      <span><BookMarked /><strong>{stats.available}</strong><small>доступно по учебным сигналам</small></span>
      <span><Gauge /><strong>{stats.mature}</strong><small>интервал 21+ день</small></span>
      <span><AlertTriangle /><strong>{stats.lapses}</strong><small>повторных затруднений</small></span>
      <span><LockKeyhole /><strong>{stats.locked}</strong><small>тем ещё не изучено</small></span>
    </section>

    {card ? <section className="review-card" aria-live="polite">
      <div className="review-card-top"><span>{card.moduleTitle}</span><small>{due.length} осталось · повторений {schedule?.repetitions || 0}</small></div>
      <div className="review-introduction-source"><CheckCircle2 /><span><strong>Почему карточка доступна</strong><small>{schedule?.introductionSource ? introductionLabels[schedule.introductionSource] : 'learning evidence'}</small></span></div>
      <h2>{card.prompt}</h2>
      {!revealed ? <div className="review-recall-state">
        <CircleHelp /><p>Скажи ответ вслух или сформулируй его в голове. Пример SQL открывай только после попытки.</p>
        <button onClick={() => setRevealed(true)} data-testid="reveal-review-answer"><BookMarked />Показать ответ</button>
      </div> : <>
        <div className="review-answer"><strong>Модель</strong><p>{card.answer}</p></div>
        <div className="review-example"><strong>Мини-пример</strong><pre><code>{card.example}</code></pre></div>
        <div className="review-trap"><ShieldAlert /><span><strong>Типичная ловушка</strong><small>{card.trap}</small></span></div>
        <div className="review-grades" aria-label="Оценить сложность карточки; это не проверка правильности">
          {(Object.keys(gradeLabels) as ReviewGrade[]).map(value => <button key={value} className={value} onClick={() => grade(value)} data-testid={`review-grade-${value}`}>
            <strong>{gradeLabels[value].title}</strong><small>{gradeLabels[value].detail}</small>
          </button>)}
        </div>
      </>}
    </section> : <section className="review-empty"><CheckCircle2 /><h2>Карточки на сегодня закончились</h2><p>{next ? `Следующее повторение: ${next.toLocaleString('ru-RU')}.` : 'Новые карточки появятся после теории или самостоятельной практики. Неизученные темы не попадают в очередь.'}</p></section>}
  </main>;
}

const categoryLabels: Record<ErrorAtlasCategory, string> = {
  syntax: 'Syntax',
  runtime: 'Runtime',
  logical: 'Logical',
  performance: 'Performance'
};

type ToolMode = 'schema' | 'errors';

export function SqlLearningTools() {
  const [mode, setMode] = useState<ToolMode>('schema');
  const [tableId, setTableId] = useState('tickets');
  const [category, setCategory] = useState<ErrorAtlasCategory>('logical');
  const [errorId, setErrorId] = useState('logical-not-in-null');
  const table = schemaTables.find(item => item.id === tableId) || schemaTables[0];
  const categoryEntries = errorAtlas.filter(item => item.category === category);
  const error = categoryEntries.find(item => item.id === errorId) || categoryEntries[0];

  const selectCategory = (value: ErrorAtlasCategory) => {
    setCategory(value);
    setErrorId(errorAtlas.find(item => item.category === value)?.id || '');
  };

  return <main className="learning-tools" data-testid="learning-tools">
    <header className="learning-tool-hero">
      <div><small>Рабочая диагностика SQL</small><h1>Schema Explorer + Error Atlas</h1><p>Сначала проверь grain, ключи и кардинальность. Когда запрос сломан — классифицируй ошибку, а не перебирай синтаксис наугад.</p></div>
      <div className="learning-tool-switch" role="tablist" aria-label="Инструменты SQL">
        <button role="tab" aria-selected={mode === 'schema'} className={mode === 'schema' ? 'active' : ''} onClick={() => setMode('schema')}><Database />Schema</button>
        <button role="tab" aria-selected={mode === 'errors'} className={mode === 'errors' ? 'active' : ''} onClick={() => setMode('errors')}><AlertTriangle />Errors</button>
      </div>
    </header>

    {mode === 'schema' ? <div className="schema-explorer" data-testid="schema-explorer">
      <aside aria-label="Таблицы учебной базы">
        {schemaTables.map(item => <button key={item.id} className={item.id === table.id ? 'active' : ''} onClick={() => setTableId(item.id)}><Table2 /><span><strong>{item.id}</strong><small>{item.grain}</small></span><ChevronRight /></button>)}
      </aside>
      <section className="schema-workspace">
        <header><div><small>Таблица</small><h2>{table.id}</h2><p>{table.purpose}</p></div><span><Layers3 />{table.cardinality}</span></header>
        <div className="schema-column-list" role="table" aria-label={`Столбцы ${table.id}`}>
          <div className="schema-column-head" role="row"><span>Поле</span><span>Тип</span><span>Правило</span><span>Смысл</span></div>
          {table.columns.map(column => <div key={column.name} role="row">
            <span role="cell"><code>{column.name}</code>{column.role && <i><KeyRound />{column.role.toUpperCase()}</i>}</span>
            <span role="cell"><code>{column.type}</code></span>
            <span role="cell">{column.nullable ? 'NULL допустим' : 'NOT NULL'}{column.references && <small>→ {column.references}</small>}</span>
            <span role="cell">{column.meaning}</span>
          </div>)}
        </div>
        {!!table.indexes.length && <section className="schema-indexes"><strong>Индексы</strong>{table.indexes.map(index => <article key={index.name}><Code2 /><span><b>{index.name}</b><small>({index.columns.join(', ')}) · {index.purpose}</small></span></article>)}</section>}
        <section className="schema-sample"><strong>{table.sampleQuestion}</strong><pre><code>{table.sampleSql}</code></pre></section>
      </section>
    </div> : <div className="error-atlas" data-testid="error-atlas">
      <aside>
        <div className="error-categories" role="tablist" aria-label="Категории ошибок">{(Object.keys(categoryLabels) as ErrorAtlasCategory[]).map(value => <button key={value} role="tab" aria-selected={category === value} className={category === value ? 'active' : ''} onClick={() => selectCategory(value)}>{categoryLabels[value]}<span>{errorAtlas.filter(item => item.category === value).length}</span></button>)}</div>
        <div className="error-entry-list">{categoryEntries.map(item => <button key={item.id} className={item.id === error.id ? 'active' : ''} onClick={() => setErrorId(item.id)}><AlertTriangle /><span><strong>{item.title}</strong><small>{item.symptom}</small></span><ChevronRight /></button>)}</div>
      </aside>
      <section className="error-workspace">
        <header><small>{categoryLabels[error.category]} error</small><h2>{error.title}</h2><p>{error.symptom}</p></header>
        <article className="error-cause"><ShieldAlert /><div><strong>Почему это происходит</strong><p>{error.cause}</p></div></article>
        <section className="error-checks"><strong>Диагностический порядок</strong><ol>{error.checks.map(check => <li key={check}>{check}</li>)}</ol></section>
        <div className="error-sql-grid"><article><span>Сломано</span><pre><code>{error.brokenSql}</code></pre></article><article><span>Исправлено</span><pre><code>{error.fixedSql}</code></pre></article></div>
        <footer><CheckCircle2 /><span><strong>Правило</strong><small>{error.rule}</small></span></footer>
      </section>
    </div>}
  </main>;
}
