import { readFileSync, writeFileSync } from 'node:fs';

const path = 'src/data/advanced-syllabus.ts';
let source = readFileSync(path, 'utf8');
function patch(before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}: expected 1 match, got ${count}`);
  source = source.replace(before, after);
}

patch(`  'conditional-aggregation': variant => {
    const priority = priorities[variant % priorities.length];
    return {
      title: \`Доля \${priority} по сервисам · \${variant + 1}\`,
      description: \`По каждому сервису посчитай все обращения, обращения \${priority} и их процент с одним знаком.\`,
      starter: \`SELECT\n  service,\n  COUNT(*) AS total_count,\n  SUM(CASE WHEN  THEN 1 ELSE 0 END) AS target_count,\n  ROUND(100.0 *  / COUNT(*), 1) AS target_rate\nFROM tickets\nGROUP BY service\nORDER BY target_rate DESC, service;\`,
      solution: \`SELECT service, COUNT(*) AS total_count, SUM(CASE WHEN priority = '\${priority}' THEN 1 ELSE 0 END) AS target_count, ROUND(100.0 * SUM(CASE WHEN priority = '\${priority}' THEN 1 ELSE 0 END) / COUNT(*), 1) AS target_rate FROM tickets GROUP BY service ORDER BY target_rate DESC, service;\`,
      hints: [\`CASE проверяет priority = '\${priority}'.\`, 'Используй ELSE 0.', '100.0 предотвращает integer division.']
    };
  },`, `  'conditional-aggregation': variant => {
    const priority = priorities[variant % priorities.length];
    const minimumSla = 45 + variant * 15;
    return {
      title: \`Доля \${priority} при SLA ≥ \${minimumSla} · \${variant + 1}\`,
      description: \`По каждому сервису среди обращений с SLA не меньше \${minimumSla} посчитай все строки, обращения \${priority} и их процент с одним знаком.\`,
      starter: \`SELECT\n  service,\n  COUNT(*) AS total_count,\n  SUM(CASE WHEN  THEN 1 ELSE 0 END) AS target_count,\n  ROUND(100.0 *  / COUNT(*), 1) AS target_rate\nFROM tickets\nWHERE sla_minutes >= \${minimumSla}\nGROUP BY service\nORDER BY target_rate DESC, service;\`,
      solution: \`SELECT service, COUNT(*) AS total_count, SUM(CASE WHEN priority = '\${priority}' THEN 1 ELSE 0 END) AS target_count, ROUND(100.0 * SUM(CASE WHEN priority = '\${priority}' THEN 1 ELSE 0 END) / COUNT(*), 1) AS target_rate FROM tickets WHERE sla_minutes >= \${minimumSla} GROUP BY service ORDER BY target_rate DESC, service;\`,
      hints: [\`Сначала ограничь sla_minutes >= \${minimumSla}.\`, \`CASE проверяет priority = '\${priority}'.\`, '100.0 предотвращает integer division.']
    };
  },`, 'conditional aggregation');

patch(`  'advanced-joins': variant => {
    const status = variant % 2 ? 'Open' : 'Closed';
    return {
      title: \`Клиенты без \${status}-обращений · \${variant + 1}\`,
      description: \`Найди клиентов, у которых нет ни одного обращения со status = '\${status}'.\`,
      starter: \`SELECT c.customer_id, c.region\nFROM customers c\nWHERE \nORDER BY c.customer_id;\`,
      solution: \`SELECT c.customer_id, c.region FROM customers c WHERE NOT EXISTS (SELECT 1 FROM tickets t WHERE t.customer_id = c.customer_id AND t.status = '\${status}') ORDER BY c.customer_id;\`,
      hints: ['Используй NOT EXISTS.', 'Свяжи t.customer_id с c.customer_id.', \`Внутренний фильтр status = '\${status}'.\`]
    };
  },`, `  'advanced-joins': variant => {
    const status = variant % 2 ? 'Open' : 'Closed';
    const minimumCustomerId = variant + 1;
    return {
      title: \`Клиенты #\${minimumCustomerId}+ без \${status}-обращений\`,
      description: \`Среди клиентов с customer_id >= \${minimumCustomerId} найди тех, у кого нет ни одного обращения со status = '\${status}'.\`,
      starter: \`SELECT c.customer_id, c.region\nFROM customers c\nWHERE c.customer_id >= \${minimumCustomerId}\n  AND \nORDER BY c.customer_id;\`,
      solution: \`SELECT c.customer_id, c.region FROM customers c WHERE c.customer_id >= \${minimumCustomerId} AND NOT EXISTS (SELECT 1 FROM tickets t WHERE t.customer_id = c.customer_id AND t.status = '\${status}') ORDER BY c.customer_id;\`,
      hints: [\`Внешний фильтр customer_id >= \${minimumCustomerId}.\`, 'Используй NOT EXISTS.', \`Внутренний фильтр status = '\${status}'.\`]
    };
  },`, 'advanced joins');

patch(`  'recursive-cte': variant => {
    const root = (variant % 3) + 1;
    return {
      title: \`Дерево сервисов от узла \${root} · \${variant + 1}\`,
      description: \`Через WITH RECURSIVE верни service_id, name и depth для узла \${root} и всех потомков.\`,
      starter: \`WITH RECURSIVE service_path(service_id, name, depth) AS (\n  SELECT service_id, name, 0\n  FROM service_tree\n  WHERE service_id = \${root}\n  UNION ALL\n  SELECT \n  FROM service_tree child\n  JOIN service_path parent ON \n)\nSELECT * FROM service_path ORDER BY depth, service_id;\`,
      solution: \`WITH RECURSIVE service_path(service_id, name, depth) AS (SELECT service_id, name, 0 FROM service_tree WHERE service_id = \${root} UNION ALL SELECT child.service_id, child.name, parent.depth + 1 FROM service_tree child JOIN service_path parent ON child.parent_id = parent.service_id) SELECT service_id, name, depth FROM service_path ORDER BY depth, service_id;\`,
      hints: ['Recursive step выбирает child.', 'child.parent_id = parent.service_id.', 'depth увеличивается на 1.']
    };
  },`, `  'recursive-cte': variant => {
    const root = (variant % 9) + 1;
    const maxDepth = variant + 1;
    return {
      title: \`Дерево от узла \${root} до depth \${maxDepth}\`,
      description: \`Через WITH RECURSIVE верни service_id, name и depth для узла \${root} и потомков не глубже \${maxDepth}.\`,
      starter: \`WITH RECURSIVE service_path(service_id, name, depth) AS (\n  SELECT service_id, name, 0\n  FROM service_tree\n  WHERE service_id = \${root}\n  UNION ALL\n  SELECT \n  FROM service_tree child\n  JOIN service_path parent ON \n  WHERE parent.depth < \${maxDepth}\n)\nSELECT * FROM service_path ORDER BY depth, service_id;\`,
      solution: \`WITH RECURSIVE service_path(service_id, name, depth) AS (SELECT service_id, name, 0 FROM service_tree WHERE service_id = \${root} UNION ALL SELECT child.service_id, child.name, parent.depth + 1 FROM service_tree child JOIN service_path parent ON child.parent_id = parent.service_id WHERE parent.depth < \${maxDepth}) SELECT service_id, name, depth FROM service_path ORDER BY depth, service_id;\`,
      hints: ['Recursive step выбирает child.', 'child.parent_id = parent.service_id.', \`Guard: parent.depth < \${maxDepth}.\`]
    };
  },`, 'recursive CTE');

patch(`  'window-frames': variant => {
    const width = (variant % 3) + 1;
    return {
      title: \`Moving average \${width + 1} событий · \${variant + 1}\`,
      description: \`Для ticket_events посчитай moving_count по каждому ticket_id в окне текущая строка + \${width} предыдущих.\`,
      starter: \`SELECT\n  ticket_id,\n  event_id,\n  COUNT(*) OVER (\n    PARTITION BY ticket_id\n    ORDER BY event_at, event_id\n    ROWS BETWEEN  PRECEDING AND CURRENT ROW\n  ) AS moving_count\nFROM ticket_events\nORDER BY ticket_id, event_at, event_id;\`,
      solution: \`SELECT ticket_id, event_id, COUNT(*) OVER (PARTITION BY ticket_id ORDER BY event_at, event_id ROWS BETWEEN \${width} PRECEDING AND CURRENT ROW) AS moving_count FROM ticket_events ORDER BY ticket_id, event_at, event_id;\`,
      hints: [\`Frame начинается \${width} PRECEDING.\`, 'Используй ROWS, не RANGE.', 'event_id — tie-breaker.']
    };
  },`, `  'window-frames': variant => {
    const width = (variant % 3) + 1;
    const minimumEventId = variant + 1;
    return {
      title: \`Moving window \${width + 1} с event #\${minimumEventId}+\`,
      description: \`Для ticket_events с event_id >= \${minimumEventId} посчитай moving_count по ticket_id в окне текущая строка + \${width} предыдущих.\`,
      starter: \`SELECT\n  ticket_id,\n  event_id,\n  COUNT(*) OVER (\n    PARTITION BY ticket_id\n    ORDER BY event_at, event_id\n    ROWS BETWEEN  PRECEDING AND CURRENT ROW\n  ) AS moving_count\nFROM ticket_events\nWHERE event_id >= \${minimumEventId}\nORDER BY ticket_id, event_at, event_id;\`,
      solution: \`SELECT ticket_id, event_id, COUNT(*) OVER (PARTITION BY ticket_id ORDER BY event_at, event_id ROWS BETWEEN \${width} PRECEDING AND CURRENT ROW) AS moving_count FROM ticket_events WHERE event_id >= \${minimumEventId} ORDER BY ticket_id, event_at, event_id;\`,
      hints: [\`Сначала event_id >= \${minimumEventId}.\`, \`Frame начинается \${width} PRECEDING.\`, 'event_id — tie-breaker.']
    };
  },`, 'window frames');

patch(`  'json-sql': variant => {
    const channel = ['web', 'email', 'chat'][variant % 3];
    return {
      title: \`JSON channel = \${channel} · \${variant + 1}\`,
      description: \`Верни event_id, ticket_id и channel из JSON payload только для channel '\${channel}'.\`,
      starter: \`SELECT\n  event_id,\n  ticket_id,\n  \nFROM ticket_events\nWHERE \nORDER BY event_id;\`,
      solution: \`SELECT event_id, ticket_id, json_extract(payload, '$.channel') AS channel FROM ticket_events WHERE json_valid(payload) AND json_extract(payload, '$.channel') = '\${channel}' ORDER BY event_id;\`,
      hints: ['Сначала json_valid(payload).', "Path: '$.channel'.", \`Сравни результат с '\${channel}'.\`]
    };
  },`, `  'json-sql': variant => {
    const channel = ['web', 'email', 'chat'][variant % 3];
    const minimumEventId = variant + 1;
    return {
      title: \`JSON \${channel} с event #\${minimumEventId}+\`,
      description: \`Верни event_id, ticket_id и channel из JSON payload для channel '\${channel}' и event_id >= \${minimumEventId}.\`,
      starter: \`SELECT\n  event_id,\n  ticket_id,\n  \nFROM ticket_events\nWHERE json_valid(payload)\n  AND \n  AND event_id >= \${minimumEventId}\nORDER BY event_id;\`,
      solution: \`SELECT event_id, ticket_id, json_extract(payload, '$.channel') AS channel FROM ticket_events WHERE json_valid(payload) AND json_extract(payload, '$.channel') = '\${channel}' AND event_id >= \${minimumEventId} ORDER BY event_id;\`,
      hints: ['Сначала json_valid(payload).', \`Сравни channel с '\${channel}'.\`, \`Добавь event_id >= \${minimumEventId}.\`]
    };
  },`, 'JSON SQL');

patch(`  'sql-security': variant => {
    const risk = variant % 2;
    return {
      title: \`Аудит dynamic SQL риска \${risk} · \${variant + 1}\`,
      description: \`Верни sample_id и input_text для request_samples, где risk_level = \${risk}, а также безопасное SQL-представление через quote().\`,
      starter: \`SELECT\n  sample_id,\n  input_text,\n  \nFROM request_samples\nWHERE \nORDER BY sample_id;\`,
      solution: \`SELECT sample_id, input_text, quote(input_text) AS quoted_value FROM request_samples WHERE risk_level = \${risk} ORDER BY sample_id;\`,
      hints: ['quote(input_text) показывает SQL literal representation.', \`Фильтр risk_level = \${risk}.\`, 'Это демонстрация; production-защита — bind parameters.']
    };
  },`, `  'sql-security': variant => {
    const risk = variant % 2;
    const minimumSampleId = variant + 1;
    return {
      title: \`Аудит риска \${risk} с sample #\${minimumSampleId}+\`,
      description: \`Верни sample_id и input_text для request_samples с risk_level = \${risk} и sample_id >= \${minimumSampleId}, а также quote().\`,
      starter: \`SELECT\n  sample_id,\n  input_text,\n  \nFROM request_samples\nWHERE risk_level = \${risk}\n  AND \nORDER BY sample_id;\`,
      solution: \`SELECT sample_id, input_text, quote(input_text) AS quoted_value FROM request_samples WHERE risk_level = \${risk} AND sample_id >= \${minimumSampleId} ORDER BY sample_id;\`,
      hints: ['quote(input_text) показывает SQL literal representation.', \`Фильтр risk_level = \${risk}.\`, \`Добавь sample_id >= \${minimumSampleId}.\`]
    };
  },`, 'SQL security');

patch(`  'incident-investigation': variant => {
    const service = services[variant % services.length];
    return {
      title: \`Профиль инцидента \${service} · \${variant + 1}\`,
      description: \`Для сервиса \${service} верни total, open_count, closed_count, null_resolution и avg_closed_minutes.\`,
      starter: \`SELECT\n  COUNT(*) AS total,\n  SUM(CASE WHEN  THEN 1 ELSE 0 END) AS open_count,\n  SUM(CASE WHEN  THEN 1 ELSE 0 END) AS closed_count,\n  SUM(CASE WHEN  THEN 1 ELSE 0 END) AS null_resolution,\n  ROUND(AVG(CASE WHEN  THEN resolution_minutes END), 1) AS avg_closed_minutes\nFROM tickets\nWHERE ;\`,
      solution: \`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) AS open_count, SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) AS closed_count, SUM(CASE WHEN resolution_minutes IS NULL THEN 1 ELSE 0 END) AS null_resolution, ROUND(AVG(CASE WHEN status = 'Closed' THEN resolution_minutes END), 1) AS avg_closed_minutes FROM tickets WHERE service = '\${service}';\`,
      hints: [\`Фильтр service = '\${service}'.\`, 'Каждый count — отдельный CASE.', 'AVG получает только Closed значения.']
    };
  }`, `  'incident-investigation': variant => {
    const service = services[variant % services.length];
    const day = String((variant % 6) + 1).padStart(2, '0');
    const since = \`2026-07-\${day}\`;
    return {
      title: \`Профиль \${service} с \${since}\`,
      description: \`Для сервиса \${service} с даты \${since} верни total, open_count, closed_count, null_resolution и avg_closed_minutes.\`,
      starter: \`SELECT\n  COUNT(*) AS total,\n  SUM(CASE WHEN  THEN 1 ELSE 0 END) AS open_count,\n  SUM(CASE WHEN  THEN 1 ELSE 0 END) AS closed_count,\n  SUM(CASE WHEN  THEN 1 ELSE 0 END) AS null_resolution,\n  ROUND(AVG(CASE WHEN  THEN resolution_minutes END), 1) AS avg_closed_minutes\nFROM tickets\nWHERE service = '\${service}'\n  AND date(created_at) >= '\${since}';\`,
      solution: \`SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'Open' THEN 1 ELSE 0 END) AS open_count, SUM(CASE WHEN status = 'Closed' THEN 1 ELSE 0 END) AS closed_count, SUM(CASE WHEN resolution_minutes IS NULL THEN 1 ELSE 0 END) AS null_resolution, ROUND(AVG(CASE WHEN status = 'Closed' THEN resolution_minutes END), 1) AS avg_closed_minutes FROM tickets WHERE service = '\${service}' AND date(created_at) >= '\${since}';\`,
      hints: [\`Фильтр service = '\${service}'.\`, \`Период начинается с \${since}.\`, 'AVG получает только Closed значения.']
    };
  }`, 'incident investigation');

writeFileSync(path, source);
