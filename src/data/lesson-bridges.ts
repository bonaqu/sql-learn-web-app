import { modules, tasks } from './course-catalog';
import {
  curriculumCheckpoints,
  curriculumLessons,
  type CurriculumLesson
} from './complete-curriculum';
import {
  canonicalModuleIds,
  phaseForModule
} from './learning-structure';

export type LessonTransitionKind = 'within-module' | 'module' | 'phase';

export type LessonTransition = {
  id: string;
  kind: LessonTransitionKind;
  fromLessonId: string;
  toLessonId: string;
  fromModuleId: string;
  toModuleId: string;
  fromTitle: string;
  toTitle: string;
  carryForward: string;
  limitation: string;
  newMentalModel: string;
  evidencePrompt: string;
  practiceTaskId: string | null;
  checkpointId: string | null;
};

type BridgeNarrative = Pick<
  LessonTransition,
  'carryForward' | 'limitation' | 'newMentalModel' | 'evidencePrompt'
>;

const moduleTitle = new Map(modules.map(([id, title]) => [id, title]));

const bridgeNarratives: Record<string, BridgeNarrative> = {
  'sql-thinking->filtering': {
    carryForward: 'Сохрани контракт результата: какие строки, столбцы, гранулярность и порядок должен вернуть запрос.',
    limitation: 'Один контракт ещё не отделяет нужные строки от похожих пограничных случаев в исходной таблице.',
    newMentalModel: 'WHERE — проверяемый предикат допуска строки; несколько условий образуют булеву модель отбора.',
    evidencePrompt: 'Раздели условия на обязательные и альтернативные и проверь их на строках у границы условия.'
  },
  'filtering->select': {
    carryForward: 'Продолжай контролировать состав строк явным предикатом и проверять пограничные случаи.',
    limitation: 'Верный набор строк всё ещё может раскрывать лишние поля или не давать вычисленную форму, которая нужна пользователю.',
    newMentalModel: 'SELECT — это проекция: он формирует форму каждой выходной строки и вычисляет выражения.',
    evidencePrompt: 'Сначала опиши ожидаемые столбцы, затем собери их без лишних полей и скрытых допущений.'
  },
  'select->sorting': {
    carryForward: 'Сначала сформируй корректные строки и явную форму результата без лишних столбцов.',
    limitation: 'Отфильтрованное множество не имеет гарантированного порядка, поэтому LIMIT без порядка недетерминирован.',
    newMentalModel: 'ORDER BY задаёт воспроизводимый порядок, а уникальный tie-breaker делает его стабильным.',
    evidencePrompt: 'Докажи, что две строки с одинаковым главным ключом всё равно будут расположены однозначно.'
  },
  'sorting->aggregates': {
    carryForward: 'Сохрани детерминированность результата и понимание исходной гранулярности строк.',
    limitation: 'Построчный результат не отвечает на вопросы о количестве, диапазоне и среднем по всему набору.',
    newMentalModel: 'Агрегат сворачивает множество строк в одну метрику; COUNT(*) и COUNT(column) имеют разный NULL-контракт.',
    evidencePrompt: 'Перед расчётом назови входное множество и отдельно объясни, какие NULL участвуют в каждой метрике.'
  },
  'aggregates->grouping': {
    carryForward: 'Продолжай считать метрики только по заранее определённому входному набору.',
    limitation: 'Одна итоговая строка не позволяет сравнить сервисы, команды или периоды между собой.',
    newMentalModel: 'GROUP BY задаёт новую гранулярность результата, а HAVING фильтрует уже сформированные группы.',
    evidencePrompt: 'Сформулируй одну строку результата словами и проверь, что каждый неагрегированный столбец входит в ключ группы.'
  },
  'grouping->joins': {
    carryForward: 'Сохрани явную гранулярность: одна строка результата должна иметь понятный бизнес-смысл.',
    limitation: 'Метрики одной таблицы не содержат контекст из связанных сущностей, а наивное объединение размножает строки.',
    newMentalModel: 'JOIN соединяет отношения по ключу; результат определяется типом соединения и кардинальностью связи.',
    evidencePrompt: 'До написания JOIN назови ключи, ожидаемую кардинальность и строки, которые должны сохраниться без совпадения.'
  },
  'joins->subqueries': {
    carryForward: 'Продолжай проверять кардинальность и не допускай случайного размножения строк.',
    limitation: 'Не каждый вопрос требует добавлять столбцы второй таблицы: иногда нужен порог, набор или сам факт существования.',
    newMentalModel: 'Подзапрос создаёт скаляр, множество или проверку EXISTS, которую использует внешний запрос.',
    evidencePrompt: 'Выбери форму подзапроса по контракту результата и отдельно проверь NOT IN на присутствие NULL.'
  },
  'subqueries->cte': {
    carryForward: 'Сохрани понимание формы каждого промежуточного результата.',
    limitation: 'Глубоко вложенные подзапросы скрывают этапы вычисления и затрудняют локальную проверку ошибок.',
    newMentalModel: 'CTE превращает запрос в именованный конвейер: каждый этап можно прочитать и проверить отдельно.',
    evidencePrompt: 'Дай каждому CTE предметное имя и выполни его отдельно до сборки финального SELECT.'
  },
  'cte->windows': {
    carryForward: 'Продолжай строить запрос как последовательность проверяемых этапов.',
    limitation: 'GROUP BY и промежуточные агрегаты схлопывают строки, когда аналитике одновременно нужна деталь и метрика группы.',
    newMentalModel: 'Оконная функция вычисляет показатель по partition, сохраняя исходную строку в результате.',
    evidencePrompt: 'Назови partition, порядок внутри окна и объясни, почему итоговая детализация не изменилась.'
  },
  'windows->dates': {
    carryForward: 'Сохрани явные partition и порядок, от которых зависит аналитический контекст строки.',
    limitation: 'Временные данные нельзя надёжно сравнивать и группировать без общей гранулярности и границ периода.',
    newMentalModel: 'Дата и время — измерение с выбранным календарным бакетом, полуоткрытым интервалом и часовым контекстом.',
    evidencePrompt: 'Зафиксируй начало и конец периода и проверь события ровно на обеих границах.'
  },
  'dates->text': {
    carryForward: 'Продолжай нормализовать данные до сравнения и группировки.',
    limitation: 'Одинаковые по смыслу статусы, имена и идентификаторы могут различаться регистром, пробелами или отсутствием значения.',
    newMentalModel: 'Строковые функции, CASE и COALESCE формируют контролируемое представление сырых значений.',
    evidencePrompt: 'Покажи исходное и нормализованное значение и не маскируй COALESCE-ом неизвестное под реальный факт.'
  },
  'text->set-ops': {
    carryForward: 'Сохрани совместимую форму и типы столбцов после нормализации.',
    limitation: 'Один SELECT не всегда описывает все источники или независимые критерии, которые должны попасть в общий поток.',
    newMentalModel: 'UNION и UNION ALL вертикально объединяют совместимые результаты; удаление дублей является отдельной семантикой.',
    evidencePrompt: 'Сверь число и смысл столбцов в каждой ветке и обоснуй, нужны ли дубли в итоговом наборе.'
  },
  'set-ops->data-quality': {
    carryForward: 'Продолжай контролировать совместимость схемы и смысл дублей при объединении источников.',
    limitation: 'Композиция данных усиливает скрытые пропуски, дубли, невозможные диапазоны и конфликтующие справочники.',
    newMentalModel: 'Проверка качества — SQL-запрос, который возвращает нарушившие правило строки и измеряет масштаб проблемы.',
    evidencePrompt: 'Сначала выведи проблемные идентификаторы и частоту нарушения; не исправляй данные до диагностики причины.'
  },
  'data-quality->indexes': {
    carryForward: 'Сохрани корректность данных и проверяемый контракт результата.',
    limitation: 'Корректный запрос может читать слишком много страниц и деградировать по мере роста таблицы.',
    newMentalModel: 'Индекс — дополнительный путь доступа, полезность которого зависит от селективности и левого префикса.',
    evidencePrompt: 'Свяжи индекс с конкретным WHERE/JOIN/ORDER BY и назови цену записи и хранения.'
  },
  'indexes->explain': {
    carryForward: 'Продолжай предлагать индекс только под конкретный паттерн доступа.',
    limitation: 'Сам факт существования индекса не доказывает, что оптимизатор его выбрал или что план стал дешевле.',
    newMentalModel: 'EXPLAIN — наблюдаемое доказательство пути выполнения: scan/search, порядок join и оценка объёма.',
    evidencePrompt: 'Сравни план до и после изменения и проверь результат на репрезентативном объёме данных.'
  },
  'explain->transactions': {
    carryForward: 'Сохрани привычку подтверждать поведение системы наблюдаемыми доказательствами.',
    limitation: 'План объясняет выполнение отдельного запроса, но не защищает цепочку изменений от частичного применения и гонок.',
    newMentalModel: 'Транзакция задаёт атомарную единицу изменения с явными COMMIT, ROLLBACK и инвариантами.',
    evidencePrompt: 'Опиши состояние до, допустимое состояние после и точку, в которой весь сценарий обязан откатиться.'
  },
  'transactions->schema': {
    carryForward: 'Продолжай формулировать инварианты, которые должны пережить ошибку или параллельное выполнение.',
    limitation: 'Транзакция защищает операцию, но слабая схема всё равно допускает дубли, сиротские ссылки и неоднозначные сущности.',
    newMentalModel: 'Схема кодирует сущности, ключи, зависимости и ограничения до того, как ошибка попадёт в прикладной код.',
    evidencePrompt: 'Для каждого ограничения назови бизнес-инвариант и пример некорректной строки, которую база должна отвергнуть.'
  },
  'schema->support': {
    carryForward: 'Сохрани ключи, связи, ограничения и гранулярность операционной модели.',
    limitation: 'Хорошая схема ещё не отвечает на рабочие вопросы поддержки о SLA, очередях, нагрузке и причинах инцидентов.',
    newMentalModel: 'Support Analytics переводит операционный процесс в воспроизводимые метрики с владельцем, периодом и зерном.',
    evidencePrompt: 'Свяжи каждую метрику с решением инженера и покажи строки, из которых она получена.'
  },
  'support->final': {
    carryForward: 'Продолжай строить метрики из проверяемых операционных фактов, а не из красивых чисел.',
    limitation: 'Разрозненные запросы не образуют воспроизводимый аналитический продукт и плохо проходят ревью.',
    newMentalModel: 'Финальный аналитический пакет объединяет постановку вопроса, SQL, проверки качества, выводы и ограничения.',
    evidencePrompt: 'Собери цепочку от бизнес-вопроса до результата так, чтобы другой инженер мог повторить расчёт.'
  },
  'final->dml': {
    carryForward: 'Сохрани end-to-end проверяемость и явные ограничения результата.',
    limitation: 'До сих пор курс в основном читал данные; production support также требует безопасно менять состояние.',
    newMentalModel: 'DML — управляемое изменение с предварительным SELECT, ограниченным WHERE, транзакцией и проверкой числа строк.',
    evidencePrompt: 'Перед UPDATE/DELETE выполни эквивалентный SELECT и сформулируй ожидаемый row count.'
  },
  'dml->schema-evolution': {
    carryForward: 'Продолжай применять изменения ограниченно, атомарно и с проверяемым эффектом.',
    limitation: 'Изменение строк не решает развитие структуры, а несовместимая миграция может одновременно сломать старый и новый код.',
    newMentalModel: 'Schema evolution — поэтапная совместимая миграция expand/backfill/switch/contract с планом отката.',
    evidencePrompt: 'Назови, какие версии приложения работают на каждом этапе и как проверить завершение backfill.'
  },
  'schema-evolution->null-logic-advanced': {
    carryForward: 'Сохрани совместимость переходных состояний и не считай backfill мгновенным.',
    limitation: 'Новые и мигрируемые поля неизбежно создают неизвестные значения, которые ломают обычную двухзначную логику.',
    newMentalModel: 'NULL участвует в трёхзначной логике; UNKNOWN требует явных IS NULL, null-safe сравнений и контрактов отсутствия.',
    evidencePrompt: 'Построй таблицу истинности для NULL и проверь условие на известном, неизвестном и отсутствующем значении.'
  },
  'null-logic-advanced->conditional-aggregation': {
    carryForward: 'Продолжай явно различать false, unknown и отсутствующее значение.',
    limitation: 'Построчная классификация не даёт компактных операционных метрик по нескольким условиям одновременно.',
    newMentalModel: 'Условная агрегация превращает предикаты в измеримые категории через CASE/FILTER внутри агрегата.',
    evidencePrompt: 'Докажи, что категории исчерпывающие и не пересекаются, а знаменатель метрики определён явно.'
  },
  'conditional-aggregation->advanced-joins': {
    carryForward: 'Сохрани точные предикаты категорий и контролируемые знаменатели.',
    limitation: 'Многие бизнес-вопросы спрашивают не атрибут связанной строки, а наличие, отсутствие или покрытие всех требований.',
    newMentalModel: 'Semi join, anti join и relational division выражают EXISTS, NOT EXISTS и «для всех» без размножения строк.',
    evidencePrompt: 'Сформулируй вопрос словами «существует», «не существует» или «для каждого» до выбора SQL-паттерна.'
  },
  'advanced-joins->recursive-cte': {
    carryForward: 'Продолжай выбирать форму связи по квантору задачи и избегать лишнего размножения строк.',
    limitation: 'Обычный JOIN знает фиксированное число уровней и не обходит дерево, граф зависимостей или цепочку эскалаций.',
    newMentalModel: 'Рекурсивный CTE расширяет anchor-набор повторяемым recursive term до точки остановки.',
    evidencePrompt: 'Отдельно проверь anchor, один шаг рекурсии, условие остановки и защиту от цикла.'
  },
  'recursive-cte->window-frames': {
    carryForward: 'Сохрани явную структуру итерации, порядок и условие завершения.',
    limitation: 'Рекурсия решает иерархии, но последовательные метрики по соседним строкам требуют управляемого окна, а не обхода графа.',
    newMentalModel: 'Window frame определяет физический или логический диапазон строк вокруг текущей строки внутри partition.',
    evidencePrompt: 'Сравни ROWS и RANGE на peer-строках и назови границы frame для первой и последней строки.'
  },
  'window-frames->json-sql': {
    carryForward: 'Продолжай контролировать контекст вычисления и границы данных.',
    limitation: 'Современные события часто содержат вложенные необязательные атрибуты, которых нет в фиксированных столбцах.',
    newMentalModel: 'JSON в SQL — типизированное извлечение по пути с проверкой отсутствующих ключей и формы документа.',
    evidencePrompt: 'Различи отсутствующий путь, JSON null и строку "null", затем приведи значение к ожидаемому типу.'
  },
  'json-sql->sql-security': {
    carryForward: 'Сохрани проверку структуры, типа и отсутствующих значений на границе данных.',
    limitation: 'Динамические фильтры, пути и сортировки становятся каналом инъекции, если смешать данные пользователя и синтаксис SQL.',
    newMentalModel: 'Параметры защищают значения, allowlist защищает идентификаторы, а least privilege ограничивает последствия ошибки.',
    evidencePrompt: 'Раздели динамические части на значения и идентификаторы и покажи защиту каждой категории.'
  },
  'sql-security->concurrency': {
    carryForward: 'Продолжай минимизировать права и отделять пользовательские данные от SQL-синтаксиса.',
    limitation: 'Безопасно составленный запрос всё равно может потерять обновление или прочитать несогласованное состояние параллельно с другим.',
    newMentalModel: 'Concurrency требует модели изоляции, блокировок, конфликтов и повторяемых идемпотентных операций.',
    evidencePrompt: 'Опиши interleaving двух транзакций и укажи, на каком шаге возникает аномалия или блокировка.'
  },
  'concurrency->pagination-patterns': {
    carryForward: 'Сохрани стабильный порядок операций и понимание изменений между двумя чтениями.',
    limitation: 'OFFSET-пагинация пропускает или дублирует строки, когда набор меняется между запросами, и дорожает на глубоких страницах.',
    newMentalModel: 'Keyset pagination продолжает чтение после составного курсора в строгом уникальном порядке.',
    evidencePrompt: 'Докажи продолжение после курсора при одинаковых значениях главного sort key и вставке новой строки.'
  },
  'pagination-patterns->incident-investigation': {
    carryForward: 'Сохрани детерминированный порядок, курсоры и устойчивость чтения при изменяющихся данных.',
    limitation: 'Отдельный production-паттерн не объясняет инцидент: нужны связанные доказательства из данных, планов, блокировок и истории изменений.',
    newMentalModel: 'SQL-расследование — воспроизводимая временная линия гипотез, запросов, опровержений и подтверждённых причин.',
    evidencePrompt: 'Для каждого вывода сохрани запрос, timestamp, источник данных, альтернативную гипотезу и безопасный следующий шаг.'
  }
};

function firstLesson(moduleId: string) {
  return curriculumLessons.find(lesson => lesson.module === moduleId) || null;
}

function lastLesson(moduleId: string) {
  return [...curriculumLessons].reverse().find(lesson => lesson.module === moduleId) || null;
}

function firstPracticeTask(moduleId: string) {
  return tasks.find(task => task.module === moduleId && (task.mode === 'lesson' || task.mode === 'practice')) || null;
}

function phaseCheckpoint(moduleId: string) {
  const phase = phaseForModule(moduleId);
  if (!phase) return null;
  return curriculumCheckpoints.find(checkpoint =>
    checkpoint.moduleIds.some(id => phase.moduleIds.some(module => module === id))
  ) || null;
}

function narrativeKey(fromModuleId: string, toModuleId: string) {
  return `${fromModuleId}->${toModuleId}`;
}

function intraModuleTransition(from: CurriculumLesson, to: CurriculumLesson): LessonTransition {
  const practice = to.practiceTaskIds
    .map(taskId => tasks.find(task => task.id === taskId))
    .find(Boolean) || firstPracticeTask(to.module);
  return {
    id: `${from.id}->${to.id}`,
    kind: 'within-module',
    fromLessonId: from.id,
    toLessonId: to.id,
    fromModuleId: from.module,
    toModuleId: to.module,
    fromTitle: from.title,
    toTitle: to.title,
    carryForward: `Урок «${from.title}» дал базовую модель: ${from.objectives.slice(0, 2).join('; ')}.`,
    limitation: `Этой модели недостаточно для следующего applied-уровня: ${to.subtitle}`,
    newMentalModel: `Теперь фокус — ${to.objectives[0] || to.title}.`,
    evidencePrompt: `Закрепи переход knowledge checks урока «${to.title}» и самостоятельной задачей без подсказки.`,
    practiceTaskId: practice?.id || null,
    checkpointId: null
  };
}

function interModuleTransition(from: CurriculumLesson, to: CurriculumLesson): LessonTransition {
  const narrative = bridgeNarratives[narrativeKey(from.module, to.module)];
  if (!narrative) throw new Error(`Missing lesson bridge narrative: ${from.module} -> ${to.module}`);
  const fromPhase = phaseForModule(from.module);
  const toPhase = phaseForModule(to.module);
  const phaseBoundary = fromPhase?.id !== toPhase?.id;
  return {
    id: `${from.id}->${to.id}`,
    kind: phaseBoundary ? 'phase' : 'module',
    fromLessonId: from.id,
    toLessonId: to.id,
    fromModuleId: from.module,
    toModuleId: to.module,
    fromTitle: moduleTitle.get(from.module) || from.title,
    toTitle: moduleTitle.get(to.module) || to.title,
    ...narrative,
    practiceTaskId: firstPracticeTask(to.module)?.id || null,
    checkpointId: phaseBoundary ? phaseCheckpoint(from.module)?.id || null : null
  };
}

export const moduleBridgePairs = canonicalModuleIds.slice(1).map((toModuleId, index) => ({
  fromModuleId: canonicalModuleIds[index],
  toModuleId
}));

export const lessonTransitions: LessonTransition[] = curriculumLessons.slice(1).map((to, index) => {
  const from = curriculumLessons[index];
  return from.module === to.module
    ? intraModuleTransition(from, to)
    : interModuleTransition(from, to);
});

const transitionInto = new Map(lessonTransitions.map(transition => [transition.toLessonId, transition]));
const transitionOut = new Map(lessonTransitions.map(transition => [transition.fromLessonId, transition]));

export function transitionIntoLesson(lessonId: string) {
  return transitionInto.get(lessonId) || null;
}

export function transitionOutOfLesson(lessonId: string) {
  return transitionOut.get(lessonId) || null;
}

export function firstLessonForModule(moduleId: string) {
  return firstLesson(moduleId);
}

export function lastLessonForModule(moduleId: string) {
  return lastLesson(moduleId);
}
