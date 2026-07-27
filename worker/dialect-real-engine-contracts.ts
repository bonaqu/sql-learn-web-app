import type { DialectLabKind, SqlDialect } from '../src/data/dialect-lab-manifests';

export type RealEngineDialect = Exclude<SqlDialect, 'sqlite'>;
export type RealEngineScenario = 'query' | 'mutation' | 'plan' | 'transaction';
export type RealEngineTransactionKind = 'optimistic-conflict' | 'skip-locked';

export type RealEngineContract = {
  labId: string;
  dialect: RealEngineDialect;
  kind: DialectLabKind;
  scenario: RealEngineScenario;
  transactionKind?: RealEngineTransactionKind;
  setupSql: string;
  verificationSql: string | null;
};

const ticketRows = `
  (1001, '2026-07-01 08:20:00', '2026-07-01 09:45:00', 'VPN', 'High'),
  (1002, '2026-07-01 10:15:00', NULL, 'LMS', 'Medium'),
  (1003, '2026-07-02 08:55:00', '2026-07-02 09:40:00', 'VPN', 'Low'),
  (1004, '2026-07-02 11:35:00', '2026-07-02 20:05:00', 'VDI', 'Critical'),
  (1005, '2026-07-03 07:50:00', '2026-07-03 11:00:00', 'Email', 'High'),
  (1006, '2026-07-03 14:10:00', '2026-07-03 19:40:00', 'VPN', 'Critical'),
  (1007, '2026-07-04 12:30:00', NULL, 'LMS', 'High'),
  (1008, '2026-07-04 16:45:00', '2026-07-04 17:10:00', 'Access', 'Low'),
  (1009, '2026-07-05 08:05:00', '2026-07-05 10:05:00', 'VPN', 'Medium'),
  (1010, '2026-07-05 13:25:00', NULL, 'Email', 'Critical'),
  (1011, '2026-07-06 09:40:00', '2026-07-06 11:15:00', 'Access', 'High'),
  (1012, '2026-07-06 15:00:00', NULL, 'LMS', 'Medium'),
  (1013, '2026-07-07 08:30:00', '2026-07-07 13:30:00', 'Access', 'Medium'),
  (1014, '2026-07-07 10:10:00', '2026-07-07 10:50:00', 'Email', 'Low')`;

function ticketSetup(dialect: RealEngineDialect) {
  const timestampType = dialect === 'postgresql' ? 'TIMESTAMPTZ' : 'TIMESTAMP';
  return `
CREATE TABLE tickets(
  ticket_id INTEGER PRIMARY KEY,
  created_at ${timestampType} NOT NULL,
  closed_at ${timestampType} NULL,
  service VARCHAR(40) NOT NULL,
  priority VARCHAR(20) NOT NULL
);
INSERT INTO tickets(ticket_id, created_at, closed_at, service, priority) VALUES ${ticketRows};
CREATE INDEX idx_tickets_service ON tickets(service);
CREATE INDEX idx_tickets_created ON tickets(created_at, ticket_id);
`;
}

function jsonSetup(dialect: RealEngineDialect) {
  const jsonType = dialect === 'postgresql' ? 'JSONB' : 'JSON';
  const jsonCast = dialect === 'postgresql' ? '::jsonb' : '';
  return `
CREATE TABLE ticket_events(event_id INTEGER PRIMARY KEY, payload ${jsonType} NOT NULL);
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
INSERT INTO event_ingest(external_event_id,payload,first_seen_at)
VALUES('evt-42','first','2026-07-08 10:00:00');
`;
}

function serviceTreeSetup() {
  return `
CREATE TABLE service_tree(service_id INTEGER PRIMARY KEY, parent_id INTEGER NULL, name VARCHAR(80) NOT NULL);
INSERT INTO service_tree VALUES
  (1,NULL,'Digital Workplace'),(2,1,'Remote Access'),(3,1,'Collaboration'),
  (4,2,'VPN'),(5,2,'VDI'),(6,3,'Email'),(7,3,'LMS'),(8,1,'Identity'),(9,8,'Access');
`;
}

function windowSetup() {
  return `
CREATE TABLE window_samples(sample_id INTEGER PRIMARY KEY, team VARCHAR(20) NOT NULL, minute_no INTEGER NOT NULL, opened INTEGER NOT NULL);
INSERT INTO window_samples VALUES(1,'A',1,2),(2,'A',2,3),(3,'A',2,5),(4,'A',3,7),(5,'B',1,4),(6,'B',2,6);
`;
}

function versionSetup() {
  return `
CREATE TABLE ticket_versions(ticket_id INTEGER PRIMARY KEY, priority VARCHAR(20) NOT NULL, version INTEGER NOT NULL);
INSERT INTO ticket_versions(ticket_id, priority, version) VALUES(1002, 'Medium', 7);
`;
}

function queueSetup() {
  return `
CREATE TABLE work_queue(job_id INTEGER PRIMARY KEY, status VARCHAR(20) NOT NULL, claimed_by VARCHAR(40) NULL);
INSERT INTO work_queue VALUES(1,'ready',NULL),(2,'ready',NULL),(3,'ready',NULL);
`;
}

const contracts: RealEngineContract[] = [];
for (const dialect of ['postgresql', 'mysql'] as const) {
  contracts.push(
    { labId: 'dialect-null-ordering', dialect, kind: 'query', scenario: 'query', setupSql: ticketSetup(dialect), verificationSql: null },
    { labId: 'dialect-date-time-boundaries', dialect, kind: 'query', scenario: 'query', setupSql: ticketSetup(dialect), verificationSql: null },
    { labId: 'dialect-json-extraction', dialect, kind: 'query', scenario: 'query', setupSql: jsonSetup(dialect), verificationSql: null },
    { labId: 'dialect-upsert-idempotency', dialect, kind: 'schema', scenario: 'mutation', setupSql: upsertSetup(dialect), verificationSql: 'SELECT external_event_id,payload,first_seen_at FROM event_ingest ORDER BY external_event_id;' },
    { labId: 'dialect-generated-columns', dialect, kind: 'schema', scenario: 'mutation', setupSql: 'SELECT 1;', verificationSql: null },
    { labId: 'dialect-recursive-service-tree', dialect, kind: 'query', scenario: 'query', setupSql: serviceTreeSetup(), verificationSql: null },
    { labId: 'dialect-window-frame', dialect, kind: 'query', scenario: 'query', setupSql: windowSetup(), verificationSql: null },
    { labId: 'dialect-keyset-pagination', dialect, kind: 'query', scenario: 'query', setupSql: ticketSetup(dialect), verificationSql: null },
    { labId: 'dialect-plan-vocabulary', dialect, kind: 'plan', scenario: 'plan', setupSql: ticketSetup(dialect), verificationSql: null },
    { labId: 'dialect-isolation-lost-update', dialect, kind: 'transaction', scenario: 'transaction', transactionKind: 'optimistic-conflict', setupSql: versionSetup(), verificationSql: null },
    { labId: 'dialect-locking-work-queue', dialect, kind: 'transaction', scenario: 'transaction', transactionKind: 'skip-locked', setupSql: queueSetup(), verificationSql: null }
  );
}

const contractByKey = new Map(contracts.map(contract => [`${contract.labId}:${contract.dialect}`, contract]));
export function realEngineContract(labId: string, dialect: RealEngineDialect) { return contractByKey.get(`${labId}:${dialect}`) || null; }
export const realEngineContracts: readonly RealEngineContract[] = contracts;
