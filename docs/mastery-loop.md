# Mastery Loop 1.0

## Зачем

SQL Academy разделяет четыре разных состояния, которые раньше могли выглядеть одной зелёной галочкой:

1. **Theory complete** — learner изучил все разделы урока.
2. **Understanding check** — learner правильно ответил на knowledge check.
3. **Applied mastery** — learner самостоятельно получил правильный SQL result без подсказки и открытого эталона в текущей сессии.
4. **Durable mastery** — после applied mastery learner успешно вернулся к модели через retrieval practice.

Чтение и правильный вариант в MCQ не доказывают, что пользователь способен построить запрос самостоятельно. Поэтому lesson evidence в Skill Evidence Graph теперь основан на applied mastery.

## Attempt evidence

`TaskStats` остаётся обратно совместимым с Progress V4, но может содержать:

- `solutionViews`;
- `independentPasses`;
- `lastIndependentAt`;
- `errorKinds`;
- `lastDiagnostic`.

Guided success сохраняет completion и XP, но не создаёт independent evidence. Открытие подсказки или эталона относится только к текущей task session. Поздний чистый retry может подтвердить applied mastery.

Старый progress без новых полей мигрируется консервативно: completion с одной-двумя попытками и без hints может считаться legacy independent evidence; hinted legacy completion — нет.

## Deterministic diagnostics

Classifier различает:

- syntax;
- schema;
- runtime;
- result shape;
- row set;
- ordering;
- values;
- NULL/filter logic;
- aggregation grain;
- JOIN cardinality.

Каждый diagnostic обязан иметь:

- краткое название;
- объяснение наблюдаемого несовпадения;
- один конкретный следующий шаг;
- при наличии — ссылку на соответствующую модель Error Atlas.

AI Mentor получает эту диагностику как контекст, но не является источником истины для классификации.

## Retention introduction

Review card не активируется при первом запуске приложения. Она вводится только после evidence:

1. completed lesson;
2. independent practice;
3. conservative legacy practice migration.

Свежая тема получает первый retrieval через десять минут. Старое migrated evidence может стать due сразу. `available`, `due`, `learned`, `mature` и `locked` — разные показатели.

Lapse (`again`) возвращает карточку через десять минут и повышает remediation priority.

## Readiness integration

Lesson evidence per module:

- `completed` — число уроков с theory + check + independent SQL;
- `total` — число уроков модуля;
- `score` — доля applied lessons;
- `sourceIds` — ID applied lessons.

Обычный `curriculum.completedLessons` продолжает хранить theory/check completion для совместимости и синхронизации. Он больше не выдаётся за applied lesson readiness.

## Quality contract

`npm run validate:mastery` обязан проверять:

- все diagnostic branches;
- guided vs independent success;
- solution-view evidence;
- legacy migration;
- theory/check without practice;
- applied lesson score;
- evidence-gated card introduction;
- first retrieval interval;
- separation of available, due and locked cards.

Browser tests дополнительно подтверждают реальный UI на desktop и Pixel 7.
