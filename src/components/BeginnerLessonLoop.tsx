import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Code2, Eye, Play, Route, Sparkles, Target } from 'lucide-react';
import type { QueryExecResult } from 'sql.js';
import type { CurriculumLesson } from '../data/complete-curriculum';
import { tasks } from '../data/course-catalog';
import { trainingSeedSql } from '../data/training-dataset';
import initSqlJs from '../lib/sql-browser';
import { evaluateTaskSql } from '../lib/task-evaluation-contract';

type SqlTable = { columns: string[]; values: unknown[][] };

function formatValue(value: unknown) {
  if (value === null) return 'NULL';
  return String(value);
}

export default function BeginnerLessonLoop({ lesson, onStageComplete, onOpenTask, onRevisit }: {
  lesson: CurriculumLesson;
  onStageComplete: (sectionId: string) => void;
  onOpenTask: (taskId: string) => void;
  onRevisit: (sectionId: string) => void;
}) {
  const cycle = lesson.beginnerCycle!;
  const [prediction, setPrediction] = useState<number | null>(null);
  const [predictionChecked, setPredictionChecked] = useState(false);
  const [workedSql, setWorkedSql] = useState(cycle.workedExample.sql);
  const [fadedSql, setFadedSql] = useState(cycle.fadedPractice.starterSql);
  const [running, setRunning] = useState<'worked' | 'faded' | null>(null);
  const [sqlReady, setSqlReady] = useState(false);
  const [workedResult, setWorkedResult] = useState<SqlTable[]>([]);
  const [fadedResult, setFadedResult] = useState<SqlTable[]>([]);
  const [message, setMessage] = useState('Измени запрос, если хочешь, затем выполни его локально.');
  const [fadedFeedback, setFadedFeedback] = useState<{ correct: boolean; message: string } | null>(null);

  useEffect(() => {
    setPrediction(null);
    setPredictionChecked(false);
    setWorkedSql(cycle.workedExample.sql);
    setFadedSql(cycle.fadedPractice.starterSql);
    setRunning(null);
    setWorkedResult([]);
    setFadedResult([]);
    setMessage('Измени запрос, если хочешь, затем выполни его локально.');
    setFadedFeedback(null);
  }, [cycle]);

  useEffect(() => {
    let active = true;
    void initSqlJs().then(() => { if (active) setSqlReady(true); }).catch(() => { if (active) setSqlReady(false); });
    return () => { active = false; };
  }, []);

  const checkPrediction = () => {
    if (prediction === null) return;
    setPredictionChecked(true);
    onStageComplete(lesson.sections[0].id);
  };

  const runSql = async (kind: 'worked' | 'faded', sql: string) => {
    setRunning(kind);
    if (kind === 'worked') setWorkedResult([]);
    else {
      setFadedResult([]);
      setFadedFeedback(null);
    }
    setMessage('SQLite выполняет запрос на учебных данных…');
    try {
      const sqlEngine = await initSqlJs();
      if (kind === 'faded') {
        const evaluationTask = tasks.find(task => task.id === cycle.fadedPractice.evaluationTaskId);
        if (!evaluationTask) throw new Error('Контракт проверки упражнения не найден.');
        const evaluation = evaluateTaskSql(sqlEngine, evaluationTask, sql, 'practice');
        setFadedResult(evaluation.output as SqlTable[]);
        if (evaluation.correct) {
          onStageComplete(lesson.sections[2].id);
          setFadedFeedback({ correct: true, message: cycle.fadedPractice.successFeedback });
        } else {
          const detail = evaluation.diagnostic
            ? `${evaluation.diagnostic.title}. ${evaluation.diagnostic.explanation} ${evaluation.diagnostic.nextStep}`
            : cycle.fadedPractice.retryFeedback;
          setFadedFeedback({ correct: false, message: detail });
        }
        return;
      }
      const database = new sqlEngine.Database();
      try {
        database.run(trainingSeedSql);
        const output = database.exec(sql) as QueryExecResult[];
        setWorkedResult(output as SqlTable[]);
        const rowCount = output.reduce((sum, block) => sum + block.values.length, 0);
        setMessage(output.length ? `Готово: ${rowCount} строк. ${cycle.workedExample.observation}` : 'Запрос выполнен без табличного результата.');
        onStageComplete(lesson.sections[1].id);
      } finally {
        database.close();
      }
    } catch (reason) {
      const detail = `Не удалось выполнить SQL: ${reason instanceof Error ? reason.message : String(reason)}`;
      if (kind === 'faded') setFadedFeedback({ correct: false, message: detail });
      else setMessage(detail);
    } finally {
      setRunning(null);
    }
  };

  const predictionCorrect = prediction === cycle.prediction.correctIndex;

  return <section className="beginner-loop" data-testid="beginner-lesson-loop" aria-labelledby={`beginner-loop-${lesson.id}`}>
    <header className="beginner-loop-header">
      <div><small>Практический цикл</small><h2 id={`beginner-loop-${lesson.id}`}>Сначала предскажи, затем проверь на данных</h2><p>{cycle.objective}</p></div>
      <span><Target /><b>Готово, когда</b>{cycle.successCriterion}</span>
    </header>

    <ol className="beginner-loop-steps" aria-label="Этапы урока" tabIndex={0}>
      <li className="current"><span>1</span>Прогноз</li><li><span>2</span>Пример</li><li><span>3</span>Меньше подсказок</li><li><span>4</span>Самостоятельно</li>
    </ol>

    <article className="beginner-loop-card prediction" data-testid="beginner-prediction">
      <div className="beginner-loop-card-title"><Eye /><div><small>Шаг 1 · ответ до запуска</small><h3>{cycle.prediction.prompt}</h3></div></div>
      <fieldset><legend className="sr-only">Выбери прогноз</legend>{cycle.prediction.options.map((option, index) => <label className={prediction === index ? 'selected' : ''} key={option}><input type="radio" name={`prediction-${lesson.id}`} checked={prediction === index} onChange={() => setPrediction(index)} /><span>{String.fromCharCode(65 + index)}</span><b>{option}</b></label>)}</fieldset>
      <button type="button" onClick={checkPrediction} disabled={prediction === null}>Проверить прогноз</button>
      {predictionChecked && <div className={`beginner-loop-feedback ${predictionCorrect ? 'success' : 'error'}`} role="status" aria-live="polite">{predictionCorrect ? <CheckCircle2 /> : <AlertTriangle />}<p><strong>{predictionCorrect ? 'Верно.' : 'Есть расхождение.'}</strong> {predictionCorrect ? cycle.prediction.correctFeedback : cycle.prediction.incorrectFeedback}</p></div>}
    </article>

    {!predictionChecked && <div className="beginner-loop-locked" data-testid="worked-example-locked"><Code2 /><p><strong>Сначала зафиксируй прогноз.</strong> Код и результат откроются после ответа — так проверка действительно показывает твою модель.</p></div>}

    {predictionChecked && <article className="beginner-loop-card worked" data-testid="beginner-worked-example">
      <div className="beginner-loop-card-title"><Code2 /><div><small>Шаг 2 · пример с запуском</small><h3>{cycle.workedExample.title}</h3><p>{cycle.workedExample.context}</p></div></div>
      <label className="beginner-sql-editor"><span>SQL — можно изменить перед запуском</span><textarea value={workedSql} onChange={event => setWorkedSql(event.target.value)} spellCheck={false} aria-label={`SQL примера: ${cycle.workedExample.title}`} /></label>
      <div className="beginner-loop-actions"><button type="button" onClick={() => void runSql('worked', workedSql)} disabled={running !== null || !sqlReady}><Play />{running === 'worked' ? 'Выполняю…' : sqlReady ? 'Выполнить пример' : 'Готовлю SQLite…'}</button><span role="status" aria-live="polite">{message}</span></div>
      {!!workedResult.length && <div className="beginner-loop-result" data-testid="beginner-example-result">{workedResult.map((block, blockIndex) => <div className="result-table-wrap" key={blockIndex}><table><caption>Результат запроса: {cycle.workedExample.title}</caption><thead><tr>{block.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{block.values.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{formatValue(value)}</td>)}</tr>)}</tbody></table></div>)}</div>}
    </article>}

    {predictionChecked && <article className="beginner-loop-card faded" data-testid="beginner-faded-practice">
      <div className="beginner-loop-card-title"><Sparkles /><div><small>Шаг 3 · подсказка сокращается</small><h3>{cycle.fadedPractice.title}</h3><p>{cycle.fadedPractice.prompt}</p></div></div>
      <label className="beginner-sql-editor"><span>Замени ___ и запусти</span><textarea value={fadedSql} onChange={event => setFadedSql(event.target.value)} spellCheck={false} aria-label={`SQL с пропуском: ${cycle.fadedPractice.title}`} /></label>
      <div className="beginner-loop-actions"><button type="button" onClick={() => void runSql('faded', fadedSql)} disabled={running !== null || !sqlReady}><Play />{running === 'faded' ? 'Проверяю…' : 'Проверить мой SQL'}</button></div>
      {fadedFeedback && <div className={`beginner-loop-feedback ${fadedFeedback.correct ? 'success' : 'error'}`} role="status" aria-live="polite">{fadedFeedback.correct ? <CheckCircle2 /> : <AlertTriangle />}<p>{fadedFeedback.message}</p></div>}
      {!!fadedResult.length && <div className="beginner-loop-result" data-testid="beginner-faded-result">{fadedResult.map((block, blockIndex) => <div className="result-table-wrap" key={blockIndex}><table><caption>Результат упражнения: {cycle.fadedPractice.title}</caption><thead><tr>{block.columns.map(column => <th scope="col" key={column}>{column}</th>)}</tr></thead><tbody>{block.values.map((row, rowIndex) => <tr key={rowIndex}>{row.map((value, columnIndex) => <td key={columnIndex}>{formatValue(value)}</td>)}</tr>)}</tbody></table></div>)}</div>}
    </article>}

    <div className="beginner-visual-grid">{cycle.visualizations.map(visual => <details className="beginner-visual" key={visual.id}><summary>{visual.title}</summary><div className="result-table-wrap"><table><caption>{visual.caption}</caption><thead><tr>{visual.columns.map(column => <th scope="col" key={column}>{column}</th>)}<th scope="col">Решение</th></tr></thead><tbody>{visual.rows.map((row, rowIndex) => <tr className={row.state} key={rowIndex}>{row.values.map((value, columnIndex) => <td key={columnIndex}>{value}</td>)}<td><strong>{row.stateLabel}</strong></td></tr>)}</tbody></table></div><p>{visual.note}</p></details>)}</div>

    <article className="beginner-transfer" data-testid="beginner-transfer">
      <div><Route /><span><small>Шаг 4 · ответственность у тебя</small><h3>Сначала с опорой, затем без эталона</h3><p>{cycle.independentContext}</p></span></div>
      <div className="beginner-transfer-actions"><button type="button" onClick={() => onOpenTask(cycle.supportedTaskId)}>Открыть задачу с опорой</button><button type="button" className="primary" onClick={() => onOpenTask(cycle.independentTaskId)}>Решить самостоятельно</button></div>
    </article>

    <aside className="beginner-misconception" data-testid="beginner-remediation"><AlertTriangle /><div><small>Если результат не совпал с прогнозом</small><h3>{cycle.misconception.title}</h3><p>{cycle.misconception.mismatch}</p><code>{cycle.misconception.counterexample}</code><button type="button" onClick={() => onRevisit(cycle.misconception.revisitSectionId)}>Вернуться к нужному объяснению</button></div></aside>
    <p className="beginner-delayed-review"><strong>Проверка позже:</strong> {cycle.delayedReview}</p>
  </section>;
}
