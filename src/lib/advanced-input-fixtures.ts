import type { SqlTask } from '../data/course';
import type { AdvancedEvaluationProbeKind } from '../data/advanced-evaluation-contracts';
import { trainingSeedSql } from '../data/training-dataset';
import type { TaskSqlEngine } from './task-evaluation-types';
import { initialLabSetup, splitSqlStatements } from './sql-statements';

type Database = InstanceType<TaskSqlEngine['Database']>;
export type AdvancedInputFixture = { id: string; initialState: string; mutationSql: string };

export function quoteSqlIdentifier(value: string) { return `"${value.replace(/"/g, '""')}"`; }
export function sqlFixtureLiteral(value: unknown) {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Invalid numeric fixture value');
    return String(value);
  }
  if (value instanceof Uint8Array) return `X'${Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('')}'`;
  return `'${String(value).replace(/'/g, "''")}'`;
}

export function temporaryLabState(database: Database) {
  const objects = database.exec("SELECT type, name FROM sqlite_temp_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY type,name;")[0]?.values || [];
  return JSON.stringify(objects.map(([type, rawName]) => {
    const name = String(rawName);
    const info = database.exec(`PRAGMA temp.table_info(${quoteSqlIdentifier(name)});`)[0]?.values || [];
    const rows = (database.exec(`SELECT * FROM temp.${quoteSqlIdentifier(name)};`)[0]?.values || [])
      .map(row => [...row]).sort((a,b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    return { type, name: name.toLowerCase(), columns: info.map(column => [column[1],column[2],column[3],column[4],column[5]]), rows };
  }));
}

export function executeScriptOnInput(database: Database, source: string, fixture?: AdvancedInputFixture) {
  const output: ReturnType<Database['exec']> = [];
  let installed = !fixture;
  for (const statement of splitSqlStatements(source)) {
    output.push(...database.exec(statement));
    if (!installed && temporaryLabState(database) === fixture!.initialState) {
      database.run(fixture!.mutationSql);
      installed = true;
    }
  }
  if (!installed) throw new Error('Воссоздай исходные таблицы и данные лаборатории перед обработкой.');
  return { output, tempState: temporaryLabState(database) };
}

const authoredDmlInputs: Readonly<Record<string, readonly [string,string]>> = {
  'task-121': ["INSERT INTO incident_queue VALUES (105,'VPN','Open','Low'),(106,'VPN','Open','Critical');", "INSERT INTO incident_queue VALUES (107,'Email','Open','Low'),(108,'VPN','Closed','Medium'); DELETE FROM incident_queue WHERE ticket_id=101;"],
  'task-122': ["INSERT INTO closed_source VALUES (205,'VPN','Closed','2026-07-04'),(206,'VPN','Closed',NULL);", "INSERT INTO closed_source VALUES (207,'LMS','Closed','2026-07-05'); INSERT INTO ticket_archive VALUES (207,'LMS','2026-07-05'); DELETE FROM closed_source WHERE ticket_id=201;"],
  'task-123': ["INSERT INTO browser_sessions VALUES (305,13,'expired','2026-06-20'),(306,14,'active','2026-06-01');", "UPDATE browser_sessions SET last_seen='2026-07-01' WHERE session_id=302; INSERT INTO browser_sessions VALUES (307,15,'expired','2026-06-30');"],
  'task-124': ["INSERT INTO credit_adjustments VALUES ('req-other',88,200,'unrelated');", "INSERT INTO credit_adjustments VALUES ('req-2026-001',77,250,'already processed');"],
  'task-125': ["UPDATE service_quota SET used_units=5 WHERE service='VPN';", "INSERT INTO service_quota VALUES ('Email',1,10); UPDATE service_quota SET used_units=4 WHERE service='LMS';"],
  'task-126': ["UPDATE service_config SET config_version=4,timeout_minutes=80 WHERE service='VPN';", "INSERT INTO service_config VALUES ('Email',60,5);"],
  'task-127': ["INSERT INTO engineer_load VALUES (4,9); INSERT INTO recalculated_load VALUES (4,2);", "DELETE FROM recalculated_load WHERE engineer_id=1; UPDATE recalculated_load SET open_tickets=7 WHERE engineer_id=2;"],
  'task-128': ["INSERT INTO customer_contacts VALUES (5,10,'USER@example.com','2026-07-01'),(6,12,'new@example.com','2026-07-03');", "INSERT INTO customer_contacts VALUES (7,11,'OTHER@example.com','2026-07-04');"],
  'task-129': ["INSERT INTO user_sessions VALUES (904,50,'active','2026-06-20'),(905,50,'revoked','2026-06-01');", "UPDATE user_sessions SET last_seen='2026-07-01' WHERE session_id=902; INSERT INTO user_sessions VALUES (906,51,'active','2026-06-01');"],
  'task-130': ["INSERT INTO access_grants VALUES (4,13,'legacy-admin','active');", "DELETE FROM access_grants WHERE grant_id=2; INSERT INTO access_grants VALUES (5,14,'legacy-admin','revoked');"],
  'task-137': ["INSERT INTO schema_migrations VALUES ('other','2026-08-01T00:00:00Z','sha256:other');", "INSERT INTO schema_migrations VALUES ('2026_08_add_contact_state','2026-08-01T00:00:00Z','sha256:existing');"],
  'task-140': ["INSERT INTO contact_points VALUES (1,'email','digest-one','active'),(2,'sms','digest-two','revoked');", "INSERT INTO contact_points VALUES (3,'sms','digest-three','active'),(4,'email','digest-four','revoked');"]
};

function candidateMutations(database: Database, taskId: string, kind: AdvancedEvaluationProbeKind) {
  const names = database.exec("SELECT name FROM sqlite_temp_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name;")[0]?.values || [];
  const candidates: string[] = [];
  for (const [rawName] of names) {
    const name = String(rawName);
    const target = `temp.${quoteSqlIdentifier(name)}`;
    const columns = database.exec(`PRAGMA temp.table_info(${quoteSqlIdentifier(name)});`)[0]?.values || [];
    const rows = database.exec(`SELECT * FROM ${target} LIMIT 8;`)[0]?.values || [];
    for (const row of rows) {
      const predicate = columns.map((column,index) => `${quoteSqlIdentifier(String(column[1]))} IS ${sqlFixtureLiteral(row[index])}`).join(' AND ');
      const selectedRow = `rowid=(SELECT rowid FROM ${target} WHERE ${predicate} LIMIT 1)`;
      if (kind === 'adversarial-reduction') { candidates.push(`DELETE FROM ${target} WHERE ${selectedRow};`); continue; }
      for (const [index,column] of columns.entries()) {
        if (Number(column[5]) > 0) continue;
        const value = row[index];
        const shifted = typeof value === 'number' ? value + 17 : value === null ? 'hidden' : `${String(value)}_hidden`;
        candidates.push(`UPDATE ${target} SET ${quoteSqlIdentifier(String(column[1]))}=${sqlFixtureLiteral(shifted)} WHERE ${selectedRow};`);
        if (!Number(column[3])) candidates.push(`UPDATE ${target} SET ${quoteSqlIdentifier(String(column[1]))}=NULL WHERE ${selectedRow};`);
      }
      const newRow = row.map((value,index) => Number(columns[index][5]) > 0
        ? typeof value === 'number' ? value + Number(taskId.slice(5)) * 100 : `${String(value)}_hidden`
        : value);
      candidates.push(`INSERT INTO ${target} (${columns.map(c=>quoteSqlIdentifier(String(c[1]))).join(',')}) VALUES (${newRow.map(sqlFixtureLiteral).join(',')});`);
    }
  }
  return candidates;
}

const planCache = new Map<string, AdvancedInputFixture>();
export function advancedInputFixture(engine: TaskSqlEngine, task: SqlTask, id: string, kind: AdvancedEvaluationProbeKind) {
  const key = `${id}\u0000${task.solution}`;
  const cached = planCache.get(key);
  if (cached) return cached;
  const setup = initialLabSetup(task.solution);
  if (!setup.count) throw new Error(`${task.id}: variable-input contract has no initial dataset`);
  const database = new engine.Database();
  try {
    database.run(trainingSeedSql);
    database.run(setup.setupSql);
    const initialState = temporaryLabState(database);
    const authored = authoredDmlInputs[task.id];
    if (authored) {
      const plan = { id, initialState, mutationSql: authored[kind === 'state-variation' ? 0 : 1] };
      planCache.set(key,plan);
      return plan;
    }
    const baselineDatabase = new engine.Database();
    let baseline: ReturnType<typeof executeScriptOnInput>;
    try { baselineDatabase.run(trainingSeedSql); baseline = executeScriptOnInput(baselineDatabase,task.solution); }
    finally { baselineDatabase.close(); }
    let stateOnlyPlan: AdvancedInputFixture | undefined;
    for (const mutationSql of candidateMutations(database,task.id,kind)) {
      const candidateDatabase = new engine.Database();
      try {
        candidateDatabase.run(trainingSeedSql);
        const plan = { id, initialState, mutationSql };
        const changed = executeScriptOnInput(candidateDatabase,task.solution,plan);
        if (JSON.stringify(changed.output) !== JSON.stringify(baseline.output)) {
          planCache.set(key,plan);
          return plan;
        }
        if (!stateOnlyPlan && changed.tempState !== baseline.tempState) stateOnlyPlan = plan;
      } catch {
        // Invalid domain values or FK violations are not eligible hidden inputs.
      } finally { candidateDatabase.close(); }
    }
    if (stateOnlyPlan) { planCache.set(key,stateOnlyPlan); return stateOnlyPlan; }
    throw new Error(`${task.id}: no valid discriminating input variation found`);
  } finally { database.close(); }
}
