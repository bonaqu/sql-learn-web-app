import type { DialectLabCase } from './types';

const seedSql = `
INSERT INTO ticket_events(event_id, ticket_id, event_type, event_at, payload) VALUES
  (15, 1007, 'commented', '2026-07-04 13:00:00', '{"channel":null,"actor":"user"}'),
  (16, 1010, 'created', '2026-07-05 13:25:00', '{"actor":"monitoring"}');
`;

const output = {
  columns: ['event_id', 'channel', 'channel_missing'],
  rows: [[14, 'chat', 0], [15, null, 0], [16, null, 1]]
};

export const jsonCases: DialectLabCase[] = [
  {
    id: 'dialect-json-extraction:sqlite',
    labId: 'dialect-json-extraction',
    dialect: 'sqlite',
    starterSql: `SELECT event_id, json_extract(payload, '$.channel') AS channel
FROM ticket_events
WHERE event_id >= 14
ORDER BY event_id;`,
    referenceSql: `SELECT event_id,
       json_extract(payload, '$.channel') AS channel,
       CASE WHEN json_type(payload, '$.channel') IS NULL THEN 1 ELSE 0 END AS channel_missing
FROM ticket_events
WHERE event_id >= 14
ORDER BY event_id;`,
    seedSql,
    signals: [
      {
        id: 'json-scalar',
        label: 'Scalar extraction',
        pattern: 'JSON_EXTRACT',
        remediation: 'Извлеки channel через json_extract.'
      },
      {
        id: 'missing-path',
        label: 'Missing path отдельно',
        pattern: 'JSON_TYPE[\\s\\S]*IS\\s+NULL',
        remediation: 'Проверь json_type(...) IS NULL отдельно от JSON null.'
      }
    ],
    canonicalOutput: output,
    runtimeNote: 'json_type возвращает SQL NULL для missing path и строку null для JSON null.'
  },
  {
    id: 'dialect-json-extraction:postgresql',
    labId: 'dialect-json-extraction',
    dialect: 'postgresql',
    starterSql: `SELECT event_id, payload::jsonb ->> 'channel' AS channel
FROM ticket_events
WHERE event_id >= 14
ORDER BY event_id;`,
    referenceSql: `SELECT event_id,
       payload::jsonb ->> 'channel' AS channel,
       CASE WHEN payload::jsonb ? 'channel' THEN 0 ELSE 1 END AS channel_missing
FROM ticket_events
WHERE event_id >= 14
ORDER BY event_id;`,
    seedSql,
    signals: [
      {
        id: 'json-text',
        label: 'Text extraction',
        pattern: '::JSONB\\s*->>',
        remediation: 'Используй ->> для text result.'
      },
      {
        id: 'path-existence',
        label: 'Path existence',
        pattern: '::JSONB\\s*\\?\\s*[\'\"]CHANNEL',
        remediation: 'Проверь наличие ключа оператором ?.'
      }
    ],
    canonicalOutput: output,
    runtimeNote: 'Оператор ? различает отсутствующий key; ->> возвращает SQL NULL для JSON null и missing.'
  },
  {
    id: 'dialect-json-extraction:mysql',
    labId: 'dialect-json-extraction',
    dialect: 'mysql',
    starterSql: `SELECT event_id, JSON_UNQUOTE(JSON_EXTRACT(payload, '$.channel')) AS channel
FROM ticket_events
WHERE event_id >= 14
ORDER BY event_id;`,
    referenceSql: `SELECT event_id,
       JSON_UNQUOTE(JSON_EXTRACT(payload, '$.channel')) AS channel,
       CASE WHEN JSON_CONTAINS_PATH(payload, 'one', '$.channel') = 1 THEN 0 ELSE 1 END AS channel_missing
FROM ticket_events
WHERE event_id >= 14
ORDER BY event_id;`,
    seedSql,
    signals: [
      {
        id: 'json-text',
        label: 'Text extraction',
        pattern: 'JSON_UNQUOTE\\s*\\(\\s*JSON_EXTRACT',
        remediation: 'Преврати JSON scalar в text через JSON_UNQUOTE.'
      },
      {
        id: 'path-existence',
        label: 'Path existence',
        pattern: 'JSON_CONTAINS_PATH',
        remediation: 'Проверь missing path через JSON_CONTAINS_PATH.'
      }
    ],
    canonicalOutput: output,
    runtimeNote: 'JSON_EXTRACT возвращает JSON value; existence path надо проверять отдельно.'
  }
];
