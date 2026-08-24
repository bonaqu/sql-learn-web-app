import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { tasks } from '../src/data/course-catalog';
import { curriculumLessons } from '../src/data/complete-curriculum';
import { analyticsLessonForTaskId } from '../src/lib/learning-analytics';

type UnknownRecord = Record<string, unknown>;

const evidenceDirectory = resolve('docs/evidence/pilot');
const knownTaskIds = new Set(tasks.map(task => task.id));
const knownLessonIds = new Set(curriculumLessons.map(lesson => lesson.id));
const z90 = 1.6448536269514722;

const TOP_KEYS = [
  'version',
  'status',
  'releaseSha',
  'reportingWindow',
  'consentAttestation',
  'privacyAttestation',
  'cohort',
  'sessionA',
  'sessionB',
  'incidents',
  'journeys'
] as const;
const CONSENT_KEYS = [
  'affirmative',
  'revocable',
  'analyticsOptional',
  'compensationIndependentOfAnalytics'
] as const;
const PRIVACY_KEYS = [
  'noDirectIdentifiers',
  'noContactData',
  'noCredentials',
  'noRawSqlOrResults',
  'noRecordings',
  'noExactTimestamps',
  'receiptsStoredOutsideRepository',
  'temporaryNotesDestroyed'
] as const;
const METRIC_KEYS = ['eligible', 'observed', 'interval90'] as const;
const BAND_IDS = ['zero', 'partial', 'role-focused', 'returning'] as const;

function record(value: unknown, label: string): UnknownRecord {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
  return value as UnknownRecord;
}

function exactKeys(value: UnknownRecord, expected: readonly string[], label: string) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} must use the exact allowlisted keys`);
}

function integer(value: unknown, label: string, minimum = 0) {
  assert.ok(Number.isInteger(value) && Number(value) >= minimum, `${label} must be an integer >= ${minimum}`);
  return Number(value);
}

function isoDate(value: unknown, label: string) {
  assert.ok(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), `${label} must be YYYY-MM-DD`);
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  assert.ok(Number.isFinite(timestamp), `${label} must be a real calendar date`);
  assert.equal(new Date(timestamp).toISOString().slice(0, 10), value, `${label} must be a real calendar date`);
  return timestamp;
}

function rounded(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function interval90(observed: number, eligible: number): [number, number] {
  if (eligible === 0) return [0, 1];
  const rate = observed / eligible;
  const denominator = 1 + z90 ** 2 / eligible;
  const centre = (rate + z90 ** 2 / (2 * eligible)) / denominator;
  const margin = z90 * Math.sqrt((rate * (1 - rate) + z90 ** 2 / (4 * eligible)) / eligible) / denominator;
  return [rounded(Math.max(0, centre - margin)), rounded(Math.min(1, centre + margin))];
}

function validateMetric(value: unknown, label: string, maximum: number) {
  const item = record(value, label);
  exactKeys(item, METRIC_KEYS, label);
  const eligible = integer(item.eligible, `${label}.eligible`);
  const observed = integer(item.observed, `${label}.observed`);
  assert.ok(eligible <= maximum, `${label}.eligible cannot exceed ${maximum}`);
  assert.ok(observed <= eligible, `${label}.observed cannot exceed eligible`);
  assert.ok(eligible === 0 || eligible >= 5, `${label} must be suppressed at zero or published with n >= 5`);
  assert.ok(Array.isArray(item.interval90) && item.interval90.length === 2, `${label}.interval90 must contain [low, high]`);
  const received = item.interval90.map(Number);
  assert.deepEqual(received, interval90(observed, eligible), `${label}.interval90 must be the computed 90% Wilson interval`);
}

function validateEvidence(input: unknown, source: string) {
  const root = record(input, source);
  exactKeys(root, TOP_KEYS, source);
  assert.equal(root.version, 1, `${source}.version must be 1`);
  assert.ok(root.status === 'session-a-only' || root.status === 'complete', `${source}.status is invalid`);
  assert.ok(typeof root.releaseSha === 'string' && /^[0-9a-f]{40}$/.test(root.releaseSha), `${source}.releaseSha must be a full lowercase Git SHA`);

  const window = record(root.reportingWindow, `${source}.reportingWindow`);
  exactKeys(window, ['sessionAStart', 'sessionAEnd', 'sessionBStart', 'sessionBEnd'], `${source}.reportingWindow`);
  const sessionAStart = isoDate(window.sessionAStart, `${source}.reportingWindow.sessionAStart`);
  const sessionAEnd = isoDate(window.sessionAEnd, `${source}.reportingWindow.sessionAEnd`);
  assert.ok(sessionAEnd >= sessionAStart, `${source} Session A window is reversed`);

  const consent = record(root.consentAttestation, `${source}.consentAttestation`);
  exactKeys(consent, CONSENT_KEYS, `${source}.consentAttestation`);
  for (const key of CONSENT_KEYS) assert.equal(consent[key], true, `${source}.consentAttestation.${key} must be true`);

  const privacy = record(root.privacyAttestation, `${source}.privacyAttestation`);
  exactKeys(privacy, PRIVACY_KEYS, `${source}.privacyAttestation`);
  for (const key of PRIVACY_KEYS) assert.equal(privacy[key], true, `${source}.privacyAttestation.${key} must be true`);

  const cohort = record(root.cohort, `${source}.cohort`);
  exactKeys(cohort, ['totalConsented', 'publishedBands', 'suppressedParticipants'], `${source}.cohort`);
  const totalConsented = integer(cohort.totalConsented, `${source}.cohort.totalConsented`, 12);
  assert.ok(totalConsented <= 20, `${source}.cohort.totalConsented must stay within the formative 12-20 target`);
  assert.ok(Array.isArray(cohort.publishedBands), `${source}.cohort.publishedBands must be an array`);
  const seenBands = new Set<string>();
  let publishedParticipants = 0;
  for (const [index, rawBand] of cohort.publishedBands.entries()) {
    const band = record(rawBand, `${source}.cohort.publishedBands[${index}]`);
    exactKeys(band, ['band', 'participants'], `${source}.cohort.publishedBands[${index}]`);
    assert.ok(typeof band.band === 'string' && BAND_IDS.includes(band.band as typeof BAND_IDS[number]), `${source} has an unknown participant band`);
    assert.ok(!seenBands.has(String(band.band)), `${source} repeats participant band ${String(band.band)}`);
    seenBands.add(String(band.band));
    publishedParticipants += integer(band.participants, `${source}.cohort.publishedBands[${index}].participants`, 5);
  }
  const suppressedParticipants = integer(cohort.suppressedParticipants, `${source}.cohort.suppressedParticipants`);
  assert.equal(publishedParticipants + suppressedParticipants, totalConsented, `${source} published and suppressed cohort totals must reconcile`);

  const sessionA = record(root.sessionA, `${source}.sessionA`);
  exactKeys(sessionA, [
    'completed',
    'independentSuccess',
    'transfer',
    'nextStepClarity',
    'productFrictionAbandonment',
    'assistance'
  ], `${source}.sessionA`);
  const sessionACompleted = integer(sessionA.completed, `${source}.sessionA.completed`);
  assert.ok(sessionACompleted <= totalConsented, `${source}.sessionA.completed cannot exceed consented participants`);
  validateMetric(sessionA.independentSuccess, `${source}.sessionA.independentSuccess`, sessionACompleted);
  validateMetric(sessionA.transfer, `${source}.sessionA.transfer`, sessionACompleted);
  validateMetric(sessionA.nextStepClarity, `${source}.sessionA.nextStepClarity`, sessionACompleted);
  validateMetric(sessionA.productFrictionAbandonment, `${source}.sessionA.productFrictionAbandonment`, sessionACompleted);
  const assistance = record(sessionA.assistance, `${source}.sessionA.assistance`);
  exactKeys(assistance, ['hinted', 'solutionViewed', 'observerInterventions'], `${source}.sessionA.assistance`);
  for (const key of ['hinted', 'solutionViewed', 'observerInterventions'] as const) {
    assert.ok(integer(assistance[key], `${source}.sessionA.assistance.${key}`) <= sessionACompleted, `${source}.sessionA.assistance.${key} cannot exceed completed`);
  }

  let sessionBReturned = 0;
  if (root.status === 'session-a-only') {
    assert.equal(root.sessionB, null, `${source}.sessionB must be null until delayed evidence exists`);
    assert.equal(window.sessionBStart, null, `${source}.reportingWindow.sessionBStart must be null`);
    assert.equal(window.sessionBEnd, null, `${source}.reportingWindow.sessionBEnd must be null`);
  } else {
    assert.ok(sessionACompleted >= 5, `${source} complete evidence needs at least five Session A completions`);
    const sessionBStart = isoDate(window.sessionBStart, `${source}.reportingWindow.sessionBStart`);
    const sessionBEnd = isoDate(window.sessionBEnd, `${source}.reportingWindow.sessionBEnd`);
    assert.ok(sessionBEnd >= sessionBStart, `${source} Session B window is reversed`);
    const delayDays = Math.round((sessionBStart - sessionAEnd) / 86_400_000);
    assert.ok(delayDays >= 7 && delayDays <= 14, `${source} Session B must start 7-14 days after Session A`);
    const sessionB = record(root.sessionB, `${source}.sessionB`);
    exactKeys(sessionB, ['eligible', 'returned', 'missingFollowUp', 'delayedRetention', 'transfer'], `${source}.sessionB`);
    const eligible = integer(sessionB.eligible, `${source}.sessionB.eligible`);
    const returned = integer(sessionB.returned, `${source}.sessionB.returned`);
    sessionBReturned = returned;
    const missingFollowUp = integer(sessionB.missingFollowUp, `${source}.sessionB.missingFollowUp`);
    assert.ok(eligible <= sessionACompleted, `${source}.sessionB.eligible cannot exceed Session A completions`);
    assert.equal(returned + missingFollowUp, eligible, `${source} Session B returned and missing follow-up must reconcile`);
    assert.ok(returned >= 5, `${source} complete delayed evidence requires at least five returning participants`);
    validateMetric(sessionB.delayedRetention, `${source}.sessionB.delayedRetention`, returned);
    validateMetric(sessionB.transfer, `${source}.sessionB.transfer`, returned);
  }

  const incidents = record(root.incidents, `${source}.incidents`);
  exactKeys(incidents, ['p0', 'p1', 'p2', 'issueNumbers'], `${source}.incidents`);
  const incidentTotal = ['p0', 'p1', 'p2'].reduce((sum, key) => sum + integer(incidents[key], `${source}.incidents.${key}`), 0);
  assert.ok(Array.isArray(incidents.issueNumbers), `${source}.incidents.issueNumbers must be an array`);
  const issueNumbers = incidents.issueNumbers.map((value, index) => integer(value, `${source}.incidents.issueNumbers[${index}]`, 1));
  assert.equal(new Set(issueNumbers).size, issueNumbers.length, `${source}.incidents.issueNumbers must be unique`);
  assert.ok(incidentTotal === 0 || issueNumbers.length > 0, `${source} incidents require linked GitHub issue numbers`);

  assert.ok(Array.isArray(root.journeys), `${source}.journeys must be an array`);
  const seenJourneys = new Set<string>();
  for (const [index, rawJourney] of root.journeys.entries()) {
    const journey = record(rawJourney, `${source}.journeys[${index}]`);
    exactKeys(journey, [
      'session',
      'taskId',
      'lessonId',
      'contributors',
      'independentSuccesses',
      'transferSuccesses',
      'hintUses',
      'solutionViews',
      'observerInterventions'
    ], `${source}.journeys[${index}]`);
    assert.ok(journey.session === 'A' || journey.session === 'B', `${source} journey session must be A or B`);
    assert.ok(root.status === 'complete' || journey.session === 'A', `${source} cannot publish a Session B journey before delayed evidence exists`);
    assert.ok(typeof journey.taskId === 'string' && knownTaskIds.has(journey.taskId), `${source} journey has an unknown taskId`);
    assert.ok(typeof journey.lessonId === 'string' && knownLessonIds.has(journey.lessonId), `${source} journey has an unknown lessonId`);
    assert.equal(analyticsLessonForTaskId(String(journey.taskId)), journey.lessonId, `${source} journey taskId/lessonId mapping is invalid`);
    const key = `${String(journey.session)}:${String(journey.taskId)}:${String(journey.lessonId)}`;
    assert.ok(!seenJourneys.has(key), `${source} repeats journey ${key}`);
    seenJourneys.add(key);
    const contributors = integer(journey.contributors, `${source}.journeys[${index}].contributors`, 5);
    const sessionMaximum = journey.session === 'A' ? sessionACompleted : sessionBReturned;
    assert.ok(contributors <= sessionMaximum, `${source} journey contributors cannot exceed the corresponding session`);
    for (const countKey of ['independentSuccesses', 'transferSuccesses', 'hintUses', 'solutionViews', 'observerInterventions'] as const) {
      assert.ok(integer(journey[countKey], `${source}.journeys[${index}].${countKey}`) <= contributors, `${source} journey ${countKey} cannot exceed contributors`);
    }
  }
}

function metric(eligible: number, observed: number) {
  return { eligible, observed, interval90: interval90(observed, eligible) };
}

const validFixture = {
  version: 1,
  status: 'complete',
  releaseSha: 'a'.repeat(40),
  reportingWindow: {
    sessionAStart: '2026-08-01',
    sessionAEnd: '2026-08-03',
    sessionBStart: '2026-08-10',
    sessionBEnd: '2026-08-12'
  },
  consentAttestation: {
    affirmative: true,
    revocable: true,
    analyticsOptional: true,
    compensationIndependentOfAnalytics: true
  },
  privacyAttestation: {
    noDirectIdentifiers: true,
    noContactData: true,
    noCredentials: true,
    noRawSqlOrResults: true,
    noRecordings: true,
    noExactTimestamps: true,
    receiptsStoredOutsideRepository: true,
    temporaryNotesDestroyed: true
  },
  cohort: {
    totalConsented: 12,
    publishedBands: [
      { band: 'zero', participants: 6 },
      { band: 'partial', participants: 6 }
    ],
    suppressedParticipants: 0
  },
  sessionA: {
    completed: 12,
    independentSuccess: metric(10, 8),
    transfer: metric(10, 7),
    nextStepClarity: metric(12, 10),
    productFrictionAbandonment: metric(12, 1),
    assistance: { hinted: 2, solutionViewed: 1, observerInterventions: 1 }
  },
  sessionB: {
    eligible: 12,
    returned: 10,
    missingFollowUp: 2,
    delayedRetention: metric(10, 7),
    transfer: metric(9, 6)
  },
  incidents: { p0: 0, p1: 0, p2: 0, issueNumbers: [] },
  journeys: [
    {
      session: 'A',
      taskId: 'task-001',
      lessonId: 'lesson-sql-thinking',
      contributors: 6,
      independentSuccesses: 5,
      transferSuccesses: 4,
      hintUses: 1,
      solutionViews: 0,
      observerInterventions: 0
    },
    {
      session: 'B',
      taskId: 'task-002',
      lessonId: 'lesson-sql-thinking',
      contributors: 5,
      independentSuccesses: 4,
      transferSuccesses: 3,
      hintUses: 0,
      solutionViews: 0,
      observerInterventions: 0
    }
  ]
};

function clonedFixture() {
  return structuredClone(validFixture) as UnknownRecord;
}

function expectRejected(mutate: (fixture: UnknownRecord) => void, label: string) {
  const fixture = clonedFixture();
  mutate(fixture);
  assert.throws(() => validateEvidence(fixture, label), undefined, `${label} must be rejected`);
}

validateEvidence(validFixture, 'synthetic-valid-fixture');
expectRejected(fixture => { fixture.email = 'learner@example.com'; }, 'direct-identifier-field');
expectRejected(fixture => {
  const cohort = record(fixture.cohort, 'fixture.cohort');
  cohort.publishedBands = {};
}, 'non-array-published-bands');
expectRejected(fixture => {
  const cohort = record(fixture.cohort, 'fixture.cohort');
  cohort.publishedBands = [{ band: 'zero', participants: 4 }, { band: 'partial', participants: 8 }];
}, 'small-published-subgroup');
expectRejected(fixture => {
  const sessionA = record(fixture.sessionA, 'fixture.sessionA');
  const transfer = record(sessionA.transfer, 'fixture.sessionA.transfer');
  transfer.interval90 = [0, 1];
}, 'invented-interval');
expectRejected(fixture => {
  const window = record(fixture.reportingWindow, 'fixture.reportingWindow');
  window.sessionBStart = '2026-08-05';
}, 'early-session-b');
expectRejected(fixture => {
  const journeys = fixture.journeys as UnknownRecord[];
  journeys[0].lessonId = curriculumLessons.find(lesson => lesson.id !== 'lesson-sql-thinking')?.id;
}, 'mismatched-task-lesson');

const requestedFiles = process.argv.slice(2).filter(argument => argument !== '--').map(path => resolve(path));
const evidenceFiles = requestedFiles.length
  ? requestedFiles
  : readdirSync(evidenceDirectory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
    .map(entry => resolve(evidenceDirectory, entry.name));

for (const path of evidenceFiles) {
  validateEvidence(JSON.parse(readFileSync(path, 'utf8')) as unknown, path);
}

if (evidenceFiles.length === 0) {
  process.stdout.write('Human-pilot evidence kit passed: strict allowlist, consent/privacy attestations, k>=5 publication, Wilson intervals, delayed-window and catalog-ID negative fixtures; external participant gate remains unresolved.\n');
} else {
  process.stdout.write(`Human-pilot evidence validation passed for ${evidenceFiles.length} aggregate file(s). Structural validation does not authenticate consent or prove efficacy; owner review and issue #82 evidence remain required.\n`);
}
