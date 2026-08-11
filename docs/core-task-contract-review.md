# Core SQL contract review

Дата ревью: 2026-08-11  
Область: 20 core-модулей, 120 учебных задач, 20 отдельных checkpoint-задач.

## Решение ревью

Core-каталог принят для публикации при прохождении автоматических gates. Все новые формулировки, SQL-эталоны, контексты и контрпримеры написаны для SQL Academy в этом репозитории. Заимствованные банки задач и косметические варианты с заменой чисел, литералов или алиасов не использовались.

## Что считается полным контрактом

Каждая core-задача хранит:

- рабочую постановку и явную гранулярность результата;
- идентификатор контекста и семейства решения;
- правила порядка, дублей, NULL и изменения состояния;
- минимум два контрпримера;
- понятия для адресного исправления ошибки;
- цепочку подсказок «модель → структура → проверка»;
- исполняемый evaluation contract с public, hidden и adversarial fixture.

Checkpoint-задачи имеют отдельные ID, новые контексты и SQL, который после нормализации не совпадает с практикой модуля.

## Матрица авторского покрытия

| Пакет | Модули | Основные семейства задач | Проверенные риски |
| --- | --- | --- | --- |
| Foundation | sql-thinking, select, filtering, sorting, aggregates | форма результата, выражения, boolean/NULL, business order, top-N, агрегаты | лишние столбцы, NULL, ties, деление на пустой набор |
| Query design | grouping, joins, subqueries, cte, windows | HAVING, outer/anti/self join, EXISTS, корреляция, recursive CTE, ranking/LAG/running totals | размножение строк, пустые связи, ties, неверная гранулярность |
| Production | dates, text, set-ops, data-quality, indexes | calendar buckets, timestamp math, CASE/COALESCE, UNION/INTERSECT/EXCEPT, quality flags, plan inspection | границы времени, дубли, NULL, потеря кратности, ложные обещания индекса |
| Support readiness | explain, transactions, schema, support, final | планы сложных запросов, rollback rehearsals, DDL introspection, SLA/backlog, operating marts | unsafe mutation, scope UPDATE, schema invariants, пустые связи, mixed-grain metrics |

## Автоматические доказательства

`validate:core-transfer`:

- удаляет комментарии, литералы, числа и алиасы из structural fingerprint;
- содержит mutation control, доказывающий, что замена литералов/алиасов не создаёт новое решение;
- требует разнообразие структур, solution families и контекстов в каждом модуле;
- исполняет эталон каждой задачи и checkpoint на трёх fixtures;
- проверяет осторожную диагностику и обязательное повторение после просмотра эталона.

`validate:course` дополнительно выполняет все 240 эталонов на базовой SQLite-схеме. Диалектные утверждения остаются в отдельных dialect labs и проходят существующие real-engine gates; core-каталог не выдаёт SQLite-план за переносимую гарантию другого движка.

## Ограничения

- План `EXPLAIN QUERY PLAN` проверяется как наблюдение конкретной версии SQLite, а не как обещание производительности production-базы.
- Транзакционные и DDL-задачи выполняются только в одноразовой evaluator-базе. Транзакционные упражнения обязаны завершаться `ROLLBACK`.
- Первые три foundation-модуля намеренно используют более узкий синтаксический словарь; их разнообразие дополнительно доказывается разными semantic contracts, а не искусственным усложнением SQL.
