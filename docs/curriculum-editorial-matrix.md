# Curriculum editorial matrix

Issue #51 переводит Curriculum Studio с одного MCQ на проверяемый concept inventory. Для каждого урока обязательны:

1. explanation check на исходную модель урока;
2. diagnosis check с distractors, связанными с misconception IDs;
3. transfer check с наблюдаемым evidence;
4. prediction check, когда у модуля есть runnable counterexample;
5. independent SQL и retrieval review вне knowledge checks.

`npm run validate:concepts` является исполняемой версией concept-check части матрицы: проверяет lesson coverage, уникальность IDs, 3–4 checks, answer-position distribution, per-option feedback, duplicate prose и выполнение wrong/correct SQL.

`npm run validate:beginner-loop` проверяет полный практический цикл для всех строк ниже. 20 core-уроков получают блоки по 6 задач (`lesson → practice → practice → faded practice → interview → independent puzzle`), 24 advanced-урока — непересекающиеся блоки по 5 (`lesson → practice → faded practice → interview → independent puzzle`). Итоговый gate требует 44/44 циклов, 240/240 task IDs без повторов, distinct supported/faded/independent IDs, канонический semantic pass и negative mutant на каждый урок. `tests/e2e/lesson-continuity.spec.ts` открывает в браузере все 44 цикла; один advanced DML-цикл проходит полностью до puzzle-переноса.

| Lesson | Module | Editorial focus | Review state |
|---|---|---|---|
| lesson-sql-thinking | sql-thinking | result contract, grain, stable order | automated + browser |
| lesson-select | select | projection, aliases, result types | automated |
| lesson-filtering | filtering | three-valued logic, AND/OR, NULL | automated + executable |
| lesson-sorting | sorting | deterministic order, tie-breaker | automated |
| lesson-aggregates | aggregates | population, COUNT and NULL | automated |
| lesson-grouping | grouping | group grain, WHERE vs HAVING | automated + executable |
| lesson-joins | joins | join cardinality and null-extension | automated + executable |
| lesson-subqueries | subqueries | scalar/set/existence contracts | automated |
| lesson-cte | cte | named stages and intermediate contracts | automated |
| lesson-windows | windows | partition, order and preserved rows | automated + executable |
| lesson-dates | dates | time grain and missing periods | automated |
| lesson-text | text | normalization, CASE and NULL meaning | automated |
| lesson-set-ops | set-ops | compatible projections and duplicate policy | automated |
| lesson-data-quality | data-quality | measurement before mutation | automated |
| lesson-indexes | indexes | access path, selectivity and write cost | automated + executable |
| lesson-explain | explain | plan evidence instead of intuition | automated |
| lesson-transactions | transactions | atomicity, rollback and state | automated + executable |
| lesson-schema | schema | invariants, keys and normalization | automated |
| lesson-support | support | SLA denominator and reproducible evidence | automated |
| lesson-final | final | integrated result contract and auditability | automated |
| lesson-dml-foundation | dml | target set and safe mutation | automated |
| lesson-dml-applied | dml | UPSERT and production verification | automated |
| lesson-schema-evolution-foundation | schema-evolution | compatible schema changes | automated |
| lesson-schema-evolution-applied | schema-evolution | migration invariants and rollback | automated |
| lesson-null-logic-advanced-foundation | null-logic-advanced | UNKNOWN and null-safe predicates | automated + executable |
| lesson-null-logic-advanced-applied | null-logic-advanced | NOT IN, nullable joins and transfer | automated + executable |
| lesson-conditional-aggregation-foundation | conditional-aggregation | denominator and conditional counts | automated |
| lesson-conditional-aggregation-applied | conditional-aggregation | metric validation and integer division | automated |
| lesson-advanced-joins-foundation | advanced-joins | semi/anti join semantics | automated |
| lesson-advanced-joins-applied | advanced-joins | relational division and multiplicity | automated |
| lesson-recursive-cte-foundation | recursive-cte | anchor and recursive member | automated |
| lesson-recursive-cte-applied | recursive-cte | cycle/depth guards | automated |
| lesson-window-frames-foundation | window-frames | frame boundaries and peer rows | automated + executable |
| lesson-window-frames-applied | window-frames | deterministic frames and gaps/islands | automated + executable |
| lesson-json-sql-foundation | json-sql | JSON validity and missing keys | automated |
| lesson-json-sql-applied | json-sql | JSON null vs SQL NULL | automated |
| lesson-sql-security-foundation | sql-security | bind parameters and identifiers | automated |
| lesson-sql-security-applied | sql-security | least privilege and injection boundaries | automated |
| lesson-concurrency-foundation | concurrency | lost update and version checks | automated + executable |
| lesson-concurrency-applied | concurrency | idempotency and safe retries | automated + executable |
| lesson-pagination-patterns-foundation | pagination-patterns | complete keyset cursor | automated |
| lesson-pagination-patterns-applied | pagination-patterns | strict continuation and ties | automated |
| lesson-incident-investigation-foundation | incident-investigation | baseline, period and denominator | automated |
| lesson-incident-investigation-applied | incident-investigation | falsifiable hypothesis and evidence query | automated |

## Human editorial checklist

- Russian wording explains behavior, not only terminology.
- English SQL terms remain where they are industry-standard and are defined in context.
- A distractor represents a plausible misconception, not a joke or obviously unrelated option.
- Feedback states why the selected model fails and gives one concrete next action.
- Counterexamples differ observably on the shared training seed.
- No lesson completion is granted by reading sections or one legacy answer alone.
- Faded practice opens only after the runnable example, and independent transfer opens only after semantic success.
- Independent transfer is a distinct puzzle task, not the same example with renamed columns.
