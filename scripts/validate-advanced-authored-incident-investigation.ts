import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import initSqlJs from 'sql.js';
import {
  advancedIncidentInvestigationTaskOverride,
  incidentInvestigationAuthoredTaskEvidence
} from '../src/data/advanced-authored-incident-investigation';
import { advancedLessonTaskModePattern } from '../src/data/advanced-task-progression';
import { tasks } from '../src/data/course-catalog';

function taskNumber(taskId: string) { return Number(taskId.replace(/^task-/, '')); }
function baseTransferTitle(title: string) { return title.replace(/^(?:Interview|Puzzle)\s*[·:]\s*/i, '').trim(); }
function normalizedSolutionFingerprint(solution: string) {
  return solution.toLowerCase().replace(/'(?:''|[^'])*'/g, '?').replace(/\b\d+(?:\.\d+)?\b/g, '#').replace(/\s+/g, ' ').trim();
}

const expectedIds = Array.from({ length: 10 }, (_, index) => `task-${231 + index}`);
assert.deepEqual(
  Object.keys(incidentInvestigationAuthoredTaskEvidence).sort((a, b) => taskNumber(a) - taskNumber(b)),
  expectedIds,
  'Every Incident Investigation task needs evidence tags'
);
const moduleTasks = tasks
  .filter(task => task.module === 'incident-investigation')
  .sort((a, b) => taskNumber(a.id) - taskNumber(b.id));
assert.deepEqual(moduleTasks.map(task => task.id), expectedIds, 'Incident Investigation persisted task identity drifted');
assert.deepEqual(moduleTasks.map(task => task.mode), [...advancedLessonTaskModePattern, ...advancedLessonTaskModePattern], 'Incident Investigation mode pattern drifted');
assert.equal(new Set(moduleTasks.map(task => baseTransferTitle(task.title))).size, 10, 'Incident Investigation needs ten distinct titles');
assert.ok(moduleTasks.every(task => !/[·#]\s*\d+$/u.test(baseTransferTitle(task.title))), 'Incident titles cannot rely on numeric suffixes');
assert.equal(new Set(moduleTasks.map(task => normalizedSolutionFingerprint(task.solution))).size, 10, 'Incident tasks collapsed to repeated SQL skeletons');

const evidence = new Set(Object.values(incidentInvestigationAuthoredTaskEvidence).flat());
for (const required of [
  'incident-window', 'baseline-comparison', 'rate-delta', 'volume-hypothesis', 'latency-hypothesis',
  'data-quality-falsification', 'duplicate-audit', 'missingness-audit', 'segment-localization',
  'excess-error-estimate', 'competing-hypotheses', 'threshold-evidence', 'temporal-correlation',
  'deployment-correlation', 'user-impact', 'cohort-grain', 'evidence-matrix', 'contradiction-weight',
  'root-cause-ranking', 'blast-radius', 'affected-population', 'evidence-report', 'recovery-proof',
  'investigation-reconciliation'
]) assert.ok(evidence.has(required as never), `Incident ladder lost evidence: ${required}`);

for (const task of moduleTasks) {
  const authored = advancedIncidentInvestigationTaskOverride(task.id);
  assert.ok(authored, `${task.id}: authored source missing`);
  assert.equal(task.solution, authored?.solution, `${task.id}: canonical solution changed`);
  assert.ok((incidentInvestigationAuthoredTaskEvidence[task.id]?.length || 0) >= 2, `${task.id}: insufficient evidence dimensions`);
  assert.ok(task.description.length >= 145, `${task.id}: reasoning contract too thin`);
}

const markers: Readonly<Record<string, readonly string[]>> = {
  'task-231': ['rate_delta_pp', "period='baseline'", "period='incident'"],
  'task-232': ['request_change_pct', 'p95_change_pct', 'latency-spike-without-volume-spike'],
  'task-233': ['COUNT(DISTINCT event_id)', 'duplicate_rows', 'quality-risk-present'],
  'task-234': ['excess_errors_estimate', 'incident_requests', 'ORDER BY excess_errors_estimate DESC'],
  'task-235': ['evidence_state', 'observed_value-threshold', 'not-supported'],
  'task-236': ['minutes_from_deploy', 'errors_first_hour', 'strong-temporal-correlation'],
  'task-237': ['impacted_user_pct', 'request_failure_pct', 'GROUP BY plan,region'],
  'task-238': ["WHEN 'contradicts' THEN -weight", 'evidence_score', 'hypothesis_rank'],
  'task-239': ["version='2.4.0'", 'affected_users', 'affected_user_ids'],
  'task-240': ['evidence_gap', 'recovery', 'report-ready']
};
for (const task of moduleTasks) for (const marker of markers[task.id] || []) assert.ok(task.solution.includes(marker), `${task.id}: missing marker ${marker}`);
const transfers = moduleTasks.filter(task => task.mode === 'interview' || task.mode === 'puzzle');
assert.equal(transfers.length, 4, 'Incident Investigation must retain four transfers');
for (const task of transfers) assert.ok(task.starter.includes('--'), `${task.id}: transfer lost blank-editor framing`);

type ExpectedResult = { columns: readonly string[]; values: readonly (readonly (string | number | null)[])[] };
const expectedResults: Readonly<Record<string, ExpectedResult>> = {
  'task-231': {
    columns: ['service','baseline_rate','incident_rate','rate_delta_pp'],
    values: [['VPN',5,20,15],['LMS',5,5.63,0.63]]
  },
  'task-232': {
    columns: ['baseline_requests','incident_requests','request_change_pct','baseline_p95','incident_p95','p95_change_pct','finding'],
    values: [[1010,1023.3,1.32,220,680,209.09,'latency-spike-without-volume-spike']]
  },
  'task-233': {
    columns: ['total_rows','distinct_event_ids','duplicate_rows','null_service_rows','impossible_duration_rows','null_time_rows','quality_state'],
    values: [[6,5,1,1,1,1,'quality-risk-present']]
  },
  'task-234': {
    columns: ['service','region','baseline_rate','incident_rate','delta_pp','incident_requests','excess_errors_estimate'],
    values: [['VPN','eu',2,20,18,1100,198],['VPN','us',2,2.17,0.17,920,1.6],['LMS','eu',2,2.17,0.17,830,1.4],['LMS','us',2,2.11,0.11,710,0.8]]
  },
  'task-235': {
    columns: ['hypothesis','expected_signal','observed_value','threshold','evidence_state','margin'],
    values: [['dependency-latency','dependency_p95_ms',820,500,'supported',320],['bad-release','new_version_error_rate',18,10,'supported',8],['traffic-surge','request_change_pct',3,20,'not-supported',-17],['database-saturation','db_cpu_pct',42,85,'not-supported',-43]]
  },
  'task-236': {
    columns: ['deploy_id','service','version','errors_prior_hour','errors_first_hour','error_increase','correlation_state'],
    values: [[1,'VPN','2.4.0',8,205,197,'strong-temporal-correlation'],[2,'LMS','5.1.0',0,0,0,'weak-correlation']]
  },
  'task-237': {
    columns: ['plan','region','users','impacted_users','impacted_user_pct','failed_requests','total_requests','request_failure_pct'],
    values: [['enterprise','eu',2,2,100,14,20,70],['standard','eu',2,2,100,3,40,7.5],['enterprise','us',1,0,0,0,20,0],['standard','us',1,0,0,0,20,0]]
  },
  'task-238': {
    columns: ['hypothesis','evidence_score','supporting_items','contradicting_items','neutral_items','hypothesis_rank'],
    values: [['bad-release',10,3,0,0,1],['dependency-outage',-1,1,1,0,2],['traffic-surge',-2,0,1,1,3]]
  },
  'task-239': {
    columns: ['region','affected_users','failed_requests','affected_user_ids'],
    values: [['eu',2,3,'10,11']]
  },
  'task-240': {
    columns: ['total_facts','confirmed_facts','supported_hypotheses','rejected_hypotheses','open_actions','evidence_gap','report_state'],
    values: [[7,4,1,1,1,0,'report-ready']]
  }
};

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, '..');
const SQL = await initSqlJs({ locateFile: file => path.join(projectRoot, 'node_modules', 'sql.js', 'dist', file) });
for (const task of moduleTasks) {
  const database = new SQL.Database();
  try {
    const result = database.exec(task.solution);
    assert.equal(result.length, 1, `${task.id}: expected one result set`);
    const expectation = expectedResults[task.id];
    assert.deepEqual(result[0].columns, [...expectation.columns], `${task.id}: columns drifted`);
    assert.deepEqual(result[0].values, expectation.values.map(row => [...row]), `${task.id}: incident semantics drifted`);
  } finally { database.close(); }
}

console.log('Authored incident investigation validated: exact baseline, falsification, localization, hypothesis, timing, blast-radius and evidence-report outputs.');
