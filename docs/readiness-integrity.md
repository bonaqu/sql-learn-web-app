# Readiness integrity

SQL Academy использует readiness как объяснимый агрегат доказательств, а не как скрытый игровой рейтинг.

## Статусы evidence

В scored evidence участвуют только завершённые проверки:

- `AssessmentReport.status === completed`;
- `CheckpointReport.status === completed`.

`expired` и `abandoned` attempts сохраняются в истории для анализа поведения, но не могут:

- стать best score;
- увеличить module readiness;
- разблокировать prerequisite через diagnostic;
- приблизить Production/Final certificate.

## Module evidence

Для каждого модуля используются пять видов доказательств:

| Evidence | Базовый вес | Источник |
| --- | ---: | --- |
| Practice | 55 | result-checked SQL tasks, accuracy и independence |
| Lesson | 10 | завершённые structured lessons |
| Checkpoint | 15 | completed executable report либо явно помеченный migrated legacy pass |
| Assessment | 15 | completed assessment report с module score |
| Project | 5 | завершённый связанный capstone |

Вес применяется только когда evidence относится к модулю. Например, если модуль не входит ни в один capstone, project weight исключается из знаменателя. Поэтому полный набор применимых доказательств даёт 100%, а не искусственные 95%.

Формула:

```text
module readiness =
  sum(evidence score × configured weight)
  / sum(weights of applicable evidence)
```

`available` означает, что evidence kind применим к модулю. Наличие фактического completed evidence отражается отдельно через `completed`, `sourceIds` и `sourceKinds`.

## Evidence provenance

Источники не маскируются друг под друга:

- `lesson-progress`;
- `task-progress`;
- `checkpoint-report`;
- `legacy-checkpoint-task`;
- `assessment-report`;
- `project-progress`.

Старое косвенное прохождение checkpoint сохраняется для обратной совместимости, но отображается как migrated legacy evidence. Пользователю рекомендуется подтвердить его новой executable session.

## Prerequisite policy

Advanced lesson может быть открыт одним из доказательств prerequisite-модуля:

1. task mastery не ниже 55%;
2. завершены все structured lessons модуля;
3. есть passed completed checkpoint report;
4. есть migrated legacy checkpoint pass;
5. diagnostic module score не ниже 70%;
6. exceptional global diagnostic score не ниже 85%.

Expired или abandoned diagnostic не участвует в bypass.

## Certificate policy

Complete certificate требует одновременно:

- overall complete readiness не ниже 82%;
- task readiness не ниже 80%;
- не менее 90% structured lessons;
- все 8 checkpoints;
- все capstone-проекты;
- completed Production exam с проходным score;
- completed Final exam с проходным score.

Checkpoint criterion отдельно сообщает количество cloud reports и migrated legacy passes.

## Quality gate

`scripts/validate-readiness-policy.ts` блокирует merge при следующих регрессиях:

- threshold drift между policy и access/checkpoint modules;
- expired/abandoned report участвует в score;
- неприменимый project снижает максимальную readiness;
- completed checkpoint не удовлетворяет prerequisite evidence;
- invalid exam открывает certificate;
- полный валидный evidence не может достичь 100% / certificate eligibility.
