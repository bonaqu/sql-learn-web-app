import type { DialectLabCase } from './types';

const rows: unknown[][] = [
  [1001, '2026-07-01 09:45:00'],
  [1002, null],
  [1007, null],
  [1010, null]
];

export const nullOrderingCases: DialectLabCase[] = [
  {
    id: 'dialect-null-ordering:sqlite',
    labId: 'dialect-null-ordering',
    dialect: 'sqlite',
    starterSql: `SELECT ticket_id, closed_at
FROM tickets
WHERE ticket_id IN (1001, 1002, 1007, 1010)
ORDER BY closed_at, ticket_id;`,
    referenceSql: `SELECT ticket_id, closed_at
FROM tickets
WHERE ticket_id IN (1001, 1002, 1007, 1010)
ORDER BY CASE WHEN closed_at IS NULL THEN 1 ELSE 0 END, closed_at, ticket_id;`,
    signals: [
      {
        id: 'explicit-null-bucket',
        label: 'Явный NULL bucket',
        pattern: 'CASE\\s+WHEN\\s+CLOSED_AT\\s+IS\\s+NULL',
        remediation: 'Добавь отдельный ключ CASE WHEN closed_at IS NULL.'
      },
      {
        id: 'stable-tie-breaker',
        label: 'Стабильный tie-breaker',
        pattern: 'ORDER\\s+BY[\\s\\S]*TICKET_ID',
        remediation: 'Заверши ORDER BY уникальным ticket_id.'
      }
    ],
    canonicalOutput: { columns: ['ticket_id', 'closed_at'], rows },
    runtimeNote: 'SQLite при ASC ставит NULL первыми; CASE делает contract переносимым.'
  },
  {
    id: 'dialect-null-ordering:postgresql',
    labId: 'dialect-null-ordering',
    dialect: 'postgresql',
    starterSql: `SELECT ticket_id, closed_at
FROM tickets
WHERE ticket_id IN (1001, 1002, 1007, 1010)
ORDER BY closed_at, ticket_id;`,
    referenceSql: `SELECT ticket_id, closed_at
FROM tickets
WHERE ticket_id IN (1001, 1002, 1007, 1010)
ORDER BY closed_at NULLS LAST, ticket_id;`,
    signals: [
      {
        id: 'explicit-null-bucket',
        label: 'NULLS LAST',
        pattern: 'NULLS\\s+LAST',
        remediation: 'Зафиксируй NULLS LAST либо используй portable CASE key.'
      },
      {
        id: 'stable-tie-breaker',
        label: 'Стабильный tie-breaker',
        pattern: 'ORDER\\s+BY[\\s\\S]*TICKET_ID',
        remediation: 'Добавь ticket_id последним ключом сортировки.'
      }
    ],
    canonicalOutput: { columns: ['ticket_id', 'closed_at'], rows },
    runtimeNote: 'PostgreSQL при ASC ставит NULL последними; явный NULLS LAST документирует contract.'
  },
  {
    id: 'dialect-null-ordering:mysql',
    labId: 'dialect-null-ordering',
    dialect: 'mysql',
    starterSql: `SELECT ticket_id, closed_at
FROM tickets
WHERE ticket_id IN (1001, 1002, 1007, 1010)
ORDER BY closed_at, ticket_id;`,
    referenceSql: `SELECT ticket_id, closed_at
FROM tickets
WHERE ticket_id IN (1001, 1002, 1007, 1010)
ORDER BY (closed_at IS NULL), closed_at, ticket_id;`,
    signals: [
      {
        id: 'explicit-null-bucket',
        label: 'Boolean NULL key',
        pattern: 'CLOSED_AT\\s+IS\\s+NULL',
        remediation: 'MySQL не поддерживает NULLS LAST: добавь (closed_at IS NULL).'
      },
      {
        id: 'stable-tie-breaker',
        label: 'Стабильный tie-breaker',
        pattern: 'ORDER\\s+BY[\\s\\S]*TICKET_ID',
        remediation: 'Добавь ticket_id последним ключом сортировки.'
      }
    ],
    canonicalOutput: { columns: ['ticket_id', 'closed_at'], rows },
    runtimeNote: 'MySQL сортирует NULL как минимальное значение; boolean key переносит NULL в конец.'
  }
];
