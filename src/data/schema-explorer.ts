export type SchemaColumn = {
  name: string;
  type: string;
  nullable: boolean;
  role?: 'pk' | 'fk';
  references?: string;
  meaning: string;
};

export type SchemaIndex = {
  name: string;
  columns: string[];
  purpose: string;
};

export type SchemaTable = {
  id: string;
  purpose: string;
  grain: string;
  cardinality: string;
  columns: SchemaColumn[];
  indexes: SchemaIndex[];
  sampleQuestion: string;
  sampleSql: string;
};

export const schemaTables: SchemaTable[] = [
  {
    id: 'engineers',
    purpose: 'Справочник инженеров поддержки и их текущих команд.',
    grain: 'Одна строка — один инженер.',
    cardinality: 'Маленький справочник: единицы или десятки строк.',
    columns: [
      { name: 'engineer_id', type: 'INTEGER', nullable: false, role: 'pk', meaning: 'Идентификатор инженера.' },
      { name: 'name', type: 'TEXT', nullable: false, meaning: 'Вымышленное отображаемое имя.' },
      { name: 'level', type: 'TEXT', nullable: false, meaning: 'Уровень L1/L2/L3.' },
      { name: 'team', type: 'TEXT', nullable: false, meaning: 'Функциональная команда.' }
    ],
    indexes: [],
    sampleQuestion: 'Сколько инженеров работает в каждой команде?',
    sampleSql: 'SELECT team, COUNT(*) AS engineers_count FROM engineers GROUP BY team ORDER BY engineers_count DESC, team;'
  },
  {
    id: 'customers',
    purpose: 'Справочник клиентов для JOIN, data quality и anti-join сценариев.',
    grain: 'Одна строка — один клиент.',
    cardinality: 'Небольшой dimension в seed; в production может содержать миллионы строк.',
    columns: [
      { name: 'customer_id', type: 'INTEGER', nullable: false, role: 'pk', meaning: 'Идентификатор клиента.' },
      { name: 'region', type: 'TEXT', nullable: false, meaning: 'Регион обслуживания.' },
      { name: 'segment', type: 'TEXT', nullable: false, meaning: 'Business, Education или Retail.' },
      { name: 'email', type: 'TEXT', nullable: true, meaning: 'Контакт; seed содержит NULL и учебный дубль.' },
      { name: 'phone', type: 'TEXT', nullable: true, meaning: 'Синтетический контакт для анализа пропусков.' }
    ],
    indexes: [],
    sampleQuestion: 'Какие клиенты ещё не создавали обращений?',
    sampleSql: 'SELECT c.customer_id, c.region FROM customers c WHERE NOT EXISTS (SELECT 1 FROM tickets t WHERE t.customer_id = c.customer_id) ORDER BY c.customer_id;'
  },
  {
    id: 'tickets',
    purpose: 'Главная fact-таблица обращений: статусы, SLA, назначение и время.',
    grain: 'Одна строка — одно обращение.',
    cardinality: 'Самая быстрорастущая таблица основного домена.',
    columns: [
      { name: 'ticket_id', type: 'INTEGER', nullable: false, role: 'pk', meaning: 'Идентификатор обращения.' },
      { name: 'service', type: 'TEXT', nullable: false, meaning: 'VPN, LMS, VDI, Email или Access.' },
      { name: 'status', type: 'TEXT', nullable: false, meaning: 'Open или Closed.' },
      { name: 'priority', type: 'TEXT', nullable: false, meaning: 'Critical, High, Medium или Low.' },
      { name: 'engineer_id', type: 'INTEGER', nullable: false, role: 'fk', references: 'engineers.engineer_id', meaning: 'Назначенный инженер.' },
      { name: 'customer_id', type: 'INTEGER', nullable: true, role: 'fk', references: 'customers.customer_id', meaning: 'Автор обращения.' },
      { name: 'resolution_minutes', type: 'INTEGER', nullable: true, meaning: 'Фактическое время; NULL у незакрытых.' },
      { name: 'sla_minutes', type: 'INTEGER', nullable: false, meaning: 'Целевое время решения.' },
      { name: 'created_at', type: 'TEXT', nullable: false, meaning: 'ISO timestamp создания.' },
      { name: 'closed_at', type: 'TEXT', nullable: true, meaning: 'Время закрытия; NULL у открытых.' },
      { name: 'subject', type: 'TEXT', nullable: false, meaning: 'Краткое описание инцидента.' }
    ],
    indexes: [
      { name: 'idx_tickets_service', columns: ['service'], purpose: 'Поиск и группировка по сервису.' },
      { name: 'idx_tickets_engineer', columns: ['engineer_id'], purpose: 'JOIN и workload инженера.' },
      { name: 'idx_tickets_priority_status', columns: ['priority', 'status'], purpose: 'Составной фильтр priority → status.' }
    ],
    sampleQuestion: 'Какие сервисы чаще нарушают SLA?',
    sampleSql: "SELECT service, SUM(CASE WHEN resolution_minutes > sla_minutes THEN 1 ELSE 0 END) AS breaches FROM tickets WHERE status = 'Closed' GROUP BY service ORDER BY breaches DESC, service;"
  },
  {
    id: 'service_tree',
    purpose: 'Иерархия сервисов для recursive CTE.',
    grain: 'Одна строка — один узел дерева.',
    cardinality: 'Маленькая и медленно меняющаяся иерархия.',
    columns: [
      { name: 'service_id', type: 'INTEGER', nullable: false, role: 'pk', meaning: 'Идентификатор узла.' },
      { name: 'parent_id', type: 'INTEGER', nullable: true, role: 'fk', references: 'service_tree.service_id', meaning: 'Родитель; NULL означает корень.' },
      { name: 'name', type: 'TEXT', nullable: false, meaning: 'Уникальное имя узла.' }
    ],
    indexes: [{ name: 'idx_service_tree_parent', columns: ['parent_id'], purpose: 'Переход от родителя к детям.' }],
    sampleQuestion: 'Покажи все уровни дерева сервисов.',
    sampleSql: 'WITH RECURSIVE tree(service_id, parent_id, name, depth) AS (SELECT service_id, parent_id, name, 0 FROM service_tree WHERE parent_id IS NULL UNION ALL SELECT child.service_id, child.parent_id, child.name, tree.depth + 1 FROM service_tree child JOIN tree ON child.parent_id = tree.service_id) SELECT name, depth FROM tree ORDER BY depth, name;'
  },
  {
    id: 'ticket_events',
    purpose: 'Append-only журнал событий обращения с JSON payload.',
    grain: 'Одна строка — одно событие одного обращения.',
    cardinality: 'Many-to-one к tickets; событий обычно заметно больше, чем обращений.',
    columns: [
      { name: 'event_id', type: 'INTEGER', nullable: false, role: 'pk', meaning: 'Идентификатор события.' },
      { name: 'ticket_id', type: 'INTEGER', nullable: false, role: 'fk', references: 'tickets.ticket_id', meaning: 'Связанное обращение.' },
      { name: 'event_type', type: 'TEXT', nullable: false, meaning: 'Тип события.' },
      { name: 'event_at', type: 'TEXT', nullable: false, meaning: 'Время события.' },
      { name: 'payload', type: 'TEXT', nullable: false, meaning: 'JSON с channel, actor и latency_ms.' }
    ],
    indexes: [{ name: 'idx_ticket_events_ticket_time', columns: ['ticket_id', 'event_at', 'event_id'], purpose: 'История обращения в стабильном порядке.' }],
    sampleQuestion: 'Какова средняя latency по каналам?',
    sampleSql: "SELECT json_extract(payload, '$.channel') AS channel, ROUND(AVG(CAST(json_extract(payload, '$.latency_ms') AS INTEGER)), 1) AS avg_latency_ms FROM ticket_events WHERE json_valid(payload) GROUP BY channel ORDER BY avg_latency_ms DESC, channel;"
  },
  {
    id: 'request_samples',
    purpose: 'Синтетический ввод для parameterization и injection reasoning.',
    grain: 'Одна строка — один безопасный учебный пример.',
    cardinality: 'Маленький fixture; реальные production-логи сюда не копируются.',
    columns: [
      { name: 'sample_id', type: 'INTEGER', nullable: false, role: 'pk', meaning: 'Идентификатор примера.' },
      { name: 'input_text', type: 'TEXT', nullable: false, meaning: 'Обычная либо похожая на injection строка.' },
      { name: 'risk_level', type: 'INTEGER', nullable: false, meaning: '0 — обычный ввод, 1 — риск-паттерн.' }
    ],
    indexes: [],
    sampleQuestion: 'Какие примеры помечены как рискованные?',
    sampleSql: 'SELECT sample_id, input_text FROM request_samples WHERE risk_level = 1 ORDER BY sample_id;'
  }
];
