import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { learnerPersonaEvidence, PERSONA_SEED } from '../src/lib/learner-personas';

const committed = JSON.parse(readFileSync(new URL('../docs/evidence/learner-personas.json', import.meta.url), 'utf8')) as {
  contract: string;
  seed: string;
  personas: unknown[];
  boundary: string;
};
const generated = learnerPersonaEvidence();

assert.equal(committed.contract, 'learner-persona-evidence-v1');
assert.equal(committed.seed, PERSONA_SEED);
assert.deepEqual(committed.personas, generated, 'Committed persona evidence drifted from deterministic fixtures');
assert.deepEqual(generated.map(item => item.id), ['zero', 'partial', 'role-focused', 'returning']);
assert.ok(generated.every(item => item.prerequisiteSafe), 'A persona route bypasses catalog prerequisites');
assert.ok(generated.every(item => item.rawSqlStored === false), 'Persona evidence must not store SQL');
assert.match(committed.boundary, /do not prove human learning efficacy/);

const serialized = JSON.stringify(committed).toLowerCase();
for (const forbidden of ['select ', 'insert ', 'password', 'email', 'session token']) {
  assert.ok(!serialized.includes(forbidden), `Persona evidence contains forbidden private/raw field: ${forbidden}`);
}

process.stdout.write('Learner persona validation passed: deterministic zero, partial, role-focused and returning evidence stays prerequisite-safe, SQL-free and explicitly non-human.\n');
