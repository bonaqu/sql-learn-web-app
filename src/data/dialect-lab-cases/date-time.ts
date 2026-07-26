import type { DialectLabCase } from './types';

const output = { columns: ['ticket_id'], rows: [[1003], [1004]] };

export const dateTimeCases: DialectLabCase[] = [
  {
    id: 'dialect-date-time-boundaries:sqlite',
    labId: 'dialect-date-time-boundaries',
    dialect: 'sqlite',
    starterSql: `SELECT ticket_id
FROM tickets
WHERE closed_at BETWEEN '2026-07-02 00:00:00' AND '2026-07-03 00:00:00'
ORDER BY ticket_id;`,
    referenceSql: `SELECT ticket_id
FROM tickets
WHERE closed_at >= '2026-07-02 00:00:00'
  AND closed_at < '2026-07-03 00:00:00'
ORDER BY ticket_id;`,
    signals: [
      {
        id: 'inclusive-start',
        label: 'Начало включительно',
        pattern: 'CLOSED_AT\\s*>=',
        remediation: 'Используй closed_at >= start.'
      },
      {
        id: 'exclusive-end',
        label: 'Конец исключительно',
        pattern: 'CLOSED_AT\\s*<\\s*[\'\"]2026-07-03',
        remediation: 'Используй closed_at < end вместо BETWEEN.'
      }
    ],
    canonicalOutput: output,
    runtimeNote: 'ISO timestamp text сравнивается корректно только при едином формате и timezone contract.'
  },
  {
    id: 'dialect-date-time-boundaries:postgresql',
    labId: 'dialect-date-time-boundaries',
    dialect: 'postgresql',
    starterSql: `SELECT ticket_id
FROM tickets
WHERE closed_at::date = DATE '2026-07-02'
ORDER BY ticket_id;`,
    referenceSql: `SELECT ticket_id
FROM tickets
WHERE closed_at >= TIMESTAMPTZ '2026-07-02 00:00:00+00'
  AND closed_at < TIMESTAMPTZ '2026-07-03 00:00:00+00'
ORDER BY ticket_id;`,
    signals: [
      {
        id: 'timezone-aware-boundary',
        label: 'Timezone-aware boundary',
        pattern: 'TIMESTAMPTZ',
        remediation: 'Зафиксируй абсолютные UTC-границы через TIMESTAMPTZ.'
      },
      {
        id: 'exclusive-end',
        label: 'Half-open interval',
        pattern: 'CLOSED_AT\\s*<[\\s\\S]*TIMESTAMPTZ',
        remediation: 'Используй < end, чтобы полночь не учитывалась дважды.'
      }
    ],
    canonicalOutput: output,
    runtimeNote: 'timestamptz хранит абсолютный момент; session timezone влияет на представление.'
  },
  {
    id: 'dialect-date-time-boundaries:mysql',
    labId: 'dialect-date-time-boundaries',
    dialect: 'mysql',
    starterSql: `SELECT ticket_id
FROM tickets
WHERE DATE(closed_at) = '2026-07-02'
ORDER BY ticket_id;`,
    referenceSql: `SET time_zone = '+00:00';
SELECT ticket_id
FROM tickets
WHERE closed_at >= TIMESTAMP('2026-07-02 00:00:00')
  AND closed_at < TIMESTAMP('2026-07-03 00:00:00')
ORDER BY ticket_id;`,
    signals: [
      {
        id: 'session-timezone',
        label: 'Session timezone',
        pattern: 'SET\\s+TIME_ZONE\\s*=\\s*[\'\"]\\+00:00',
        remediation: 'Зафиксируй session time_zone перед вычислением UTC-границ.'
      },
      {
        id: 'exclusive-end',
        label: 'Half-open interval',
        pattern: 'CLOSED_AT\\s*<[\\s\\S]*TIMESTAMP',
        remediation: 'Используй < end вместо DATE(column) или BETWEEN.'
      }
    ],
    canonicalOutput: output,
    runtimeNote: 'TIMESTAMP преобразуется через session time_zone; timezone должен быть частью operational contract.'
  }
];
