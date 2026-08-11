import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  FlaskConical,
  Lightbulb,
  Play,
  RefreshCw,
  ShieldQuestion
} from 'lucide-react';
import type { QueryExecResult, SqlJsStatic } from 'sql.js';
import type { CurriculumLesson } from '../data/complete-curriculum';
import { conceptsForModule, misconceptionById, type RunnableCounterexample } from '../data/concept-inventory';
import { lessonCheckProgress, lessonChecks } from '../data/lesson-checks';
import { trainingSeedSql } from '../data/training-dataset';
import { answerCurriculumCheck, type CurriculumProgressV1 } from '../lib/curriculum-progress';
import initSqlJs from '../lib/sql-browser';

const kindLabels = { prediction: 'Предсказание', explanation: 'Объяснение', diagnosis: 'Диагностика', transfer: 'Перенос' } as const;
type SqlTable = { columns: string[]; values: unknown[][] };
type CounterexampleResult = { wrong: SqlTable[]; correct: SqlTable[]; message: string };

function resultSummary(blocks: SqlTable[]) {
  if (!blocks.length) return 'SQL выполнен без табличного результата.';
  const rows = blocks.reduce((sum, block) => sum + block.values.length, 0);
  const columns = blocks[0]?.columns.join(', ') || 'без столбцов';
  const preview = blocks[0]?.values.slice(0, 3).map(row => row.map(value => value === null ? 'NULL' : String(value)).join(' · ')).join(' | ');
  return `${rows} строк · ${columns}${preview ? ` · ${preview}` : ''}`;
}

function selectionsFor(lesson: CurriculumLesson, curriculum: CurriculumProgressV1) {
  return Object.fromEntries(lessonChecks(lesson).map(check => [
    check.id,
    curriculum.answers[check.id]?.optionIndex ?? null
  ]));
}

export default function ConceptCheckPanel({ lesson, curriculum, onProgress }: {
  lesson: CurriculumLesson;
  curriculum: CurriculumProgressV1;
  onProgress: (progress: CurriculumProgressV1) => void;
}) {
  const checks = useMemo(() => lessonChecks(lesson), [lesson]);
  const concept = conceptsForModule(lesson.module)[0];
  const progress = lessonCheckProgress(lesson, curriculum.answers);
  const [selections, setSelections] = useState<Record<string, number | null>>(() => selectionsFor(lesson, curriculum));
  const [engine, setEngine] = useState<SqlJsStatic | null>(null);
  const [runningId, setRunningId] = useState<string | null>(null);
  const [counterexampleResults, setCounterexampleResults] = useState<Record<string, CounterexampleResult>>({});

  useEffect(() => {
    setSelections(selectionsFor(lesson, curriculum));
    setCounterexampleResults({});
    // Reset only when switching lessons. Answer updates must not overwrite a learner's next radio selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson.id]);

  const submit = (checkId: string) => {
    const optionIndex = selections[checkId];
    if (optionIndex === null || optionIndex === undefined) return;
    onProgress(answerCurriculumCheck(curriculum, lesson.id, optionIndex, checkId));
  };

  const runCounterexample = async (id: string, example: RunnableCounterexample) => {
    setRunningId(id);
    try {
      let sqlEngine = engine;
      if (!sqlEngine) {
        sqlEngine = await initSqlJs();
        setEngine(sqlEngine);
      }
      const database = new sqlEngine.Database();
      try {
        database.run(trainingSeedSql);
        const wrong = database.exec(example.wrongSql) as QueryExecResult[];
        const correct = database.exec(example.correctSql) as QueryExecResult[];
        setCounterexampleResults(current => ({ ...current, [id]: { wrong: wrong as SqlTable[], correct: correct as SqlTable[], message: example.explanation } }));
      } finally { database.close(); }
    } catch (reason) {
      setCounterexampleResults(current => ({ ...current, [id]: { wrong: [], correct: [], message: `Ошибка SQLite: ${reason instanceof Error ? reason.message : String(reason)}` } }));
    } finally { setRunningId(null); }
  };

  return <section className="concept-check-panel" data-testid="concept-check-panel">
    <header className="concept-check-header"><div><small>Проверка понимания</small><h2>{concept?.title || 'Проверяемая модель'}</h2><p>{concept?.mentalModel || lesson.subtitle}</p></div><span className={progress.complete ? 'complete' : ''}><strong>{progress.completed}/{progress.total}</strong><small>обязательных вопросов</small></span></header>
    {concept && <div className="concept-evidence"><Lightbulb /><div><strong>Как подтвердить понимание</strong><p>{concept.evidence}</p></div></div>}
    <div className="concept-check-list">{checks.map((check, checkIndex) => {
      const answer = curriculum.answers[check.id];
      const selected = selections[check.id];
      const misconceptionId = answer ? check.misconceptionIds[answer.optionIndex] : null;
      const misconception = misconceptionId ? misconceptionById(misconceptionId) : null;
      return <article className={`concept-check-card ${answer?.correct ? 'correct' : answer ? 'incorrect' : ''}`} key={check.id} data-testid={`concept-check-${check.kind}`}>
        <div className="concept-check-title"><span>{String(checkIndex + 1).padStart(2, '0')}</span><div><small>{kindLabels[check.kind]}</small><strong>{check.question}</strong></div>{answer?.correct ? <CheckCircle2 /> : <ShieldQuestion />}</div>
        <fieldset><legend className="sr-only">{check.question}</legend>{check.options.map((option, optionIndex) => <label className={selected === optionIndex ? 'selected' : ''} key={`${check.id}-${optionIndex}`}><input type="radio" name={check.id} checked={selected === optionIndex} onChange={() => setSelections(current => ({ ...current, [check.id]: optionIndex }))}/><span>{String.fromCharCode(65 + optionIndex)}</span><b>{option}</b></label>)}</fieldset>
        <button className="concept-check-submit" onClick={() => submit(check.id)} disabled={selected === null || selected === undefined}>{answer ? <RefreshCw /> : <ShieldQuestion />}{answer ? 'Проверить ещё раз' : 'Проверить рассуждение'}</button>
        {answer && <div className={`concept-option-feedback ${answer.correct ? 'success' : 'error'}`} role="status" aria-live="polite">{answer.correct ? <CheckCircle2 /> : <AlertTriangle />}<div><strong>{answer.correct ? 'Модель подтверждена' : misconception ? `Заблуждение: ${misconception.label}` : 'Нужно вернуться к объяснению'}</strong><p>{check.optionFeedback[answer.optionIndex]}</p>{!answer.correct && <b>{misconception?.remediation || check.remediation}</b>}</div></div>}
      </article>;
    })}</div>
    {concept?.misconceptions.some(item => item.counterexample) && <div className="counterexample-lab" data-testid="counterexample-lab"><div className="counterexample-lab-heading"><FlaskConical /><div><small>Контрпримеры с запуском</small><h3>Сначала предскажи, потом сравни</h3><p>Оба запроса выполняются на одних учебных данных в локальном SQLite. Данные не отправляются в сеть.</p></div></div>{concept.misconceptions.filter(item => item.counterexample).map(item => {
      const example = item.counterexample!;
      const output = counterexampleResults[item.id];
      return <article key={item.id}><header><div><strong>{item.label}</strong><p>{example.prediction}</p></div><button onClick={() => void runCounterexample(item.id, example)} disabled={runningId === item.id}><Play />{runningId === item.id ? 'Выполняю…' : 'Сравнить SQL'}</button></header><div className="counterexample-code-grid"><div><small>SQL с ошибочной моделью</small><pre><code>{example.wrongSql}</code></pre></div><div><small>Исправленный SQL</small><pre><code>{example.correctSql}</code></pre></div></div>{output && <div className="counterexample-output" role="status"><div><small>Неверная модель</small><p>{resultSummary(output.wrong)}</p></div><div><small>Исправленная модель</small><p>{resultSummary(output.correct)}</p></div><b>{output.message}</b></div>}</article>;
    })}</div>}
  </section>;
}
