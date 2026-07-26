import type { DialectLabKind, SqlDialect } from '../src/data/dialect-lab-manifests';

export type RealEngineDialect = Exclude<SqlDialect, 'sqlite'>;
export type RealEngineScenario = 'query' | 'mutation' | 'plan' | 'transaction';

export type RealEngineContract = {
  labId: string;
  dialect: RealEngineDialect;
  kind: DialectLabKind;
  scenario: RealEngineScenario;
  setupSql: string;
  verificationSql: string | null;
};

const ticketRows = `
  (1001, '2026-07-01 09:45:00', 'VPN', 'High'),
  (1002, NULL, 'LMS', 'Medium'),
  (1003, '2026-07-02 09:40:00', 'VPN', 'Low'),
  (1004, '2026-07-02 20:05:00', 'VDI', 'Critical'),
  (1005, '2026-07-03 11:00:00', 'Email', 'High'),
  (1006, '2026-07-03 19:40:00', 'VPN', 'Critical'),
  (1007, NULL, 'LMS', 'High'),
  (1008, '2026-07-04 17:10:00', 'Access', 'Low'),
  (1009, '2026-07-05 10:05:00', 'VPN', 'Medium'),
  (1010, NULL, 'Email', 'Critical'),
  (1011, '2026-07-06 11:15:00', 'Access', 'High'),
  (1012, NULL, 'LMS', 'Medium'),
  (1013, '2026-07-07 13:30:00', 'Access', 'Medium'),
  (1014, '2026-07-07 10:50:00', 'Email', 'Low')`;

function ticketSetup(dialect: RealEngineDialect) {
  const timestampType = dialect === 'postgresql' ? 'TIMESTAMPTZ' : 'TIMESTAMP';
  return `
CREATE TABLE tickets(
  ticket_id INTEGER PRIMARY KEY,
  closed_at ${timestampType} NULL,
  service VARCHAR(40) NOT NULL,
  priority VARCHAR(20) NOT NULL
);
INSERT INTO tickets(ticket_id, closed_at, service, priority) VALUES ${ticketRows};
CREATE INDEX idx_tickets_service ON tickets(service);
`;
}

function jsonSetup(dialect: RealEngineDialect) {
  const jsonType = dialect === 'postgresql' ? 'JSONB' : 'JSON';
  const jsonCast = dialect === 'postgresql' ? '::jsonb' : '';
  return `
CREATE TABLE ticket_events(
  event_id INTEGER PRIMARY KEY,
  payload ${jsonType} NOT NULL
);
INSERT INTO ticket_events(event_id, payload) VALUES
  (101, '{"channel":null,"actor":"system"}'${jsonCast}),
  (102, '{"actor":"system"}'${jsonCast});
`;
}

function upsertSetup(dialect: RealEngineDialect) {
  const timestampType = dialect === 'postgresql' ? 'TIMESTAMPTZ' : 'TIMESTAMP';
  return `
CREATE TABLE event_ingest(
  external_event_id VARCHAR(80) PRIMARY KEY,
  payload VARCHAR(200) NOT NULL,
  first_seen_at ${timestampType} NOT NULL
);
`;
}

function versionSetup() {
  return `
CREATE TABLE ticket_versions(
  ticket_id INTEGER PRIMARY KEY,
  priority VARCHAR(20) NOT NULL,
  version INTEGER NOT NULL
);
INSERT INTO ticket_versions(ticket_id, priority, version) VALUES(1002, 'Medium', 7);
`;
}

const contracts: RealEngineContract[] = [];
for (const dialect of ['postgresql', 'mysql'] as const) {
  contracts.push(
    {
      labId: 'dialect-null-ordering',
      dialect,
      kind: 'query',
      scenario: 'query',
      setupSql: ticketSetup(dialect),
      verificationSql: null
    },
    {
      labId: 'dialect-date-time-boundaries',
      dialect,
      kind: 'query',
      scenario: 'query',
      setupSql: ticketSetup(dialect),
      verificationSql: null
    },
    {
      labId: 'dialect-json-extraction',
      dialect,
      kind: 'query',
      scenario: 'query',
      setupSql: jsonSetup(dialect),
      verificationSql: null
    },
    {
      labId: 'dialect-upsert-idempotency',
      dialect,
      kind: 'schema',
      scenario: 'mutation',
      setupSql: upsertSetup(dialect),
      verificationSql: 'SELECT external_event_id, payload, first_seen_at FROM event_ingest ORDER BY external_event_id;'
    },
    {
      labId: 'dialect-plan-vocabulary',
      dialect,
      kind: 'plan',
      scenario: 'plan',
      setupSql: ticketSetup(dialect),
      verificationSql: null
    },
    {
      labId: 'dialect-isolation-lost-update',
      dialect,
      kind: 'transaction',
      scenario: 'transaction',
      setupSql: versionSetup(),
      verificationSql: null
    }
  );
}

const contractByKey = new Map(contracts.map(contract => [`${contract.labId}:${contract.dialect}`, contract]));

export function realEngineContract(labId: string, dialect: RealEngineDialect) {
  return contractByKey.get(`${labId}:${dialect}`) || null;
}

export const realEngineContracts: readonly RealEngineContract[] = contracts;
