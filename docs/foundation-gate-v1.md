# Foundation Gate v1

Версия evaluator: `task-evaluation-v1`. Версия допуска к следующему модулю: `foundation-evidence-v1`.

## Коридор из 18 задач

Все строки проверяются на трёх детерминированных наборах: `public-base`, `hidden-state-edge`, `adversarial-duplicates-ties`. Для всех контрактов дубли сохраняются, `NULL` не приводится к строке или нулю, запрос обязан быть одним read-only `SELECT`, а таблица `tickets` после выполнения должна остаться неизменной.

| Task | Модуль | Явные столбцы и типы | NULL | Порядок | Reference review |
|---|---|---|---|---|---|
| task-001 | sql-thinking | ticket_id integer, service text | запрещён | unordered | PASS |
| task-002 | sql-thinking | ticket_id integer, status text | запрещён | unordered | PASS |
| task-003 | sql-thinking | service text, status text | запрещён | unordered | PASS; duplicate projection preserved |
| task-004 | sql-thinking | ticket_id integer, resolution_minutes integer | разрешён во втором столбце | unordered | PASS |
| task-005 | sql-thinking | ticket_id integer, sla_minutes integer | запрещён | unordered | PASS |
| task-006 | sql-thinking | ticket_id integer, priority text, service text | запрещён | unordered | PASS |
| task-007 | select | ticket_id integer, resolution_minutes integer, sla_minutes integer, delta_minutes integer | разрешён в resolution/delta | unordered | PASS; Closed определяется `status`, не заполненным временем |
| task-008 | select | ticket_id integer, sla_hours real | запрещён | unordered | PASS |
| task-009 | select | ticket_id integer, product text | запрещён | unordered | PASS; alias обязателен |
| task-010 | select | ticket_id integer, double_sla_minutes integer | запрещён | unordered | PASS |
| task-011 | select | ticket_id integer, projected_minutes integer | разрешён во втором столбце | unordered | PASS; NULL остаётся NULL |
| task-012 | select | ticket_id integer, sla_usage_pct real | разрешён во втором столбце | unordered | PASS; tolerance 0.000001 |
| task-013 | filtering | ticket_id integer, status text | запрещён | unordered | PASS; Closed через `status` |
| task-014 | filtering | ticket_id integer, priority text, status text | запрещён | unordered | PASS |
| task-015 | filtering | ticket_id integer, service text | запрещён | unordered | PASS; OR сохраняет кратность |
| task-016 | filtering | ticket_id integer, resolution_minutes integer | NULL обязателен в выбранных строках | unordered | PASS; `IS NULL` |
| task-017 | filtering | ticket_id integer, status text, resolution_minutes integer | запрещён | unordered | PASS; Open с non-NULL временем исключается |
| task-018 | filtering | ticket_id integer, service text, priority text | запрещён | unordered | PASS; две OR-группы связаны AND |

Порядок frontier: `sql-thinking → filtering → select`. Первый модуль вводит форму результата, SELECT-list и FROM; второй — WHERE, булеву и NULL-логику; третий — выражения и алиасы. Валидатор удаляет по одному из восьми введённых concepts и требует, чтобы каждая такая мутация ломала frontier.

## Негативные семейства

| Семейство | Fixture/contract | Ожидаемый отказ |
|---|---|---|
| Числовой ID приведён к тексту | task-001 | wrong-types |
| Случайный DISTINCT удалил кратность | task-003 | wrong-row-count |
| NULL подменён нулём | task-004 | wrong-null-semantics |
| Closed определён как non-NULL duration | task-007 | wrong-null-semantics на hidden-state-edge |
| Closed заменён проверкой duration | task-013 | wrong-values |
| Потеряно условие status | task-014 | wrong-row-count |
| OR ошибочно заменён AND | task-015 | wrong-row-count |
| `= NULL` вместо `IS NULL` | task-016 | wrong-row-count |
| Open с заполненным duration принят за Closed | task-017 | wrong-row-count на hidden-state-edge |
| Потеряны скобки AND/OR | task-018 | wrong-row-count |
| DML вместо SELECT | task-001 | unsafe-mutation |
| Неверный tie-breaker | checkpoint-foundation-sorting | wrong-order |

Эквивалентный запрос task-001 с обратной сортировкой проходит, потому что порядок не входит в его условие. В checkpoint-сортировке порядок входит в контракт и требует полного tie-breaker `sla_minutes ASC, ticket_id ASC`.

## Независимый checkpoint

`checkpoint-foundation` использует пять ID из отдельного банка: thinking, filtering, select, sorting и aggregates. Ни один ID и ни один нормализованный reference SQL не совпадает с practice-каталогом. Эти задачи исполняются тем же evaluator и теми же hidden/adversarial правилами, но не показывались как учебные упражнения.

## Evidence и миграция

Зелёный результат открывает следующий модуль только если попытка независима и сохраняет:

- ID и версию evaluation contract;
- версию evidence contract;
- все три fixture ID;
- минимум два hidden/adversarial fixture ID.

Четыре foundation-задачи модуля должны дать четыре разных независимых contract ID. Просмотр решения, подсказки, completed lesson и MCQ не заменяют это доказательство. Старые single-seed отметки сохраняются как история и XP, но не повышаются до `foundation-evidence-v1`. Экспорт и восстановление проверяются детерминированным SHA-256 в `validate:foundation-gate`; посторонняя валидная evidence остаётся без потерь.

## Граница фазы

Typed evaluator работает для practice, checkpoint, placement и assessment. Контрактами v1 покрыт вертикальный коридор 18 задач и пять независимых задач Foundation checkpoint. Остальной каталог временно использует прежний single-seed fallback и должен мигрировать редакторскими пакетами в следующих фазах; он не заявлен как покрытый Foundation Gate v1.
