# Human-learning pilot field kit

This kit turns the protocol into a repeatable owner-run study. It does not recruit participants, record consent, or claim outcomes.

## Before recruitment

1. Select 12–20 adults across the bands in `docs/human-learning-pilot.md`.
2. Ensure participation is voluntary, declining analytics changes neither access nor compensation, and no observer has coercive authority over a participant.
3. Store scheduling details and consent receipts outside the repository.
4. Pin the full 40-character production release SHA.
5. Prepare a clean browser profile and one disposable account per participant.
6. Name one safety owner who can stop recruitment and roll back a release.

## Plain-language consent notice

> Мы проверяем, помогает ли SQL Academy самостоятельно понять следующий шаг, решить новую задачу и вспомнить материал через 7–14 дней. Первая встреча займёт 45–60 минут, повторная — 15–25 минут. Участие добровольное: можно отказаться или остановиться в любой момент без потери компенсации. Мы фиксируем только результат шага, факт использования подсказки/решения, ограниченную категорию затруднения и крупный тип технической проблемы. Мы не записываем имя, контакты, логин, пароль, SQL-запросы, строки результатов, данные работодателя, экран, камеру или аудио. Необязательная аналитика включается отдельно; отказ от неё не мешает участию. Временные заметки удаляются после внесения агрегата. Для удаления уже собранных разрешённых наблюдений обратитесь к координатору, указанному в выданной вам форме согласия.

The owner must adapt contact, compensation and withdrawal details to the applicable jurisdiction before use. Do not put those private details in this repository.

## Observer checklist

Before Session A:

- affirmative consent is recorded outside the repository;
- optional analytics choice is recorded separately;
- participant knows how to withdraw and request deletion;
- clean profile and disposable account are ready;
- observer will not copy SQL, results or free-form speech.

During Session A:

- do not navigate for the participant;
- mark hint, solution and observer intervention before judging success;
- use only the bounded misconception family already produced by the product;
- stop after five minutes without a comprehensible next action and classify product friction;
- stop immediately for the safety conditions in the protocol.

Before Session B:

- schedule it 7–14 days after Session A;
- do not show the prior solution;
- record missing follow-up separately from success or failure;
- use a related but non-identical retrieval task.

After each session:

- delete temporary free-form notes;
- keep consent custody outside Git;
- aggregate only groups with at least five contributors;
- put all smaller bands into `suppressedParticipants` without publishing their individual counts.

## Publishing the aggregate

1. Copy `docs/human-learning-pilot-report.template.json` into `docs/evidence/pilot/`.
2. Remove `_templateNotice`; fill only allowlisted aggregate fields.
3. For every proportion, calculate the 90% Wilson interval. The validator rejects a mismatched interval rather than silently correcting it.
4. Use catalog task and lesson IDs only for journey rows with at least five contributors.
5. Run:

   ```powershell
   npm run validate:pilot-evidence -- "docs/evidence/pilot/pilot-YYYY-MM-DD-session-a.json"
   ```

6. Review the file manually for source custody and consent authenticity.
7. Attach the aggregate, release SHA, validator result and any linked incident numbers to issue #82.
8. Change `status` to `complete` only after Session B exists, every required Session A/B KPI has a publishable denominator of at least five, and both sessions contain at least one privacy-safe canonical journey row.

Passing the validator proves schema, arithmetic, privacy-field and catalog-reference constraints. It does not authenticate participants, consent receipts or educational efficacy.
