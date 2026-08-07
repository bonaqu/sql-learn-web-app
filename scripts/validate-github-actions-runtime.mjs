import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const workflowsDirectory = join(root, '.github', 'workflows');
const workflowFiles = readdirSync(workflowsDirectory)
  .filter(file => /\.ya?ml$/i.test(file))
  .sort((left, right) => left.localeCompare(right));

assert.ok(workflowFiles.length > 0, 'No GitHub Actions workflows were found');

const supportedActions = new Map([
  ['actions/github-script', 9],
  ['actions/upload-artifact', 7],
  ['actions/upload-pages-artifact', 5]
]);
const counts = new Map([...supportedActions.keys()].map(name => [name, 0]));

for (const file of workflowFiles) {
  const source = readFileSync(join(workflowsDirectory, file), 'utf8');

  assert.ok(
    !source.includes("require('@actions/github')") && !source.includes('require("@actions/github")'),
    `${file} uses the github-script v9-incompatible require('@actions/github') pattern`
  );
  assert.ok(
    !/\b(?:const|let)\s+getOctokit\b/.test(source),
    `${file} redeclares the github-script v9 injected getOctokit parameter`
  );

  for (const [action, expectedMajor] of supportedActions) {
    const escaped = action.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const references = [...source.matchAll(new RegExp(`uses:\\s*${escaped}@([^\\s#]+)`, 'g'))];
    for (const reference of references) {
      const version = reference[1];
      assert.equal(
        version,
        `v${expectedMajor}`,
        `${file} must use ${action}@v${expectedMajor}, found ${action}@${version}`
      );
      counts.set(action, (counts.get(action) || 0) + 1);
    }
  }
}

for (const [action, expectedMajor] of supportedActions) {
  assert.ok(
    (counts.get(action) || 0) > 0,
    `Expected at least one ${action}@v${expectedMajor} reference`
  );
}

const pagesWorkflow = readFileSync(join(workflowsDirectory, 'pages.yml'), 'utf8');
assert.ok(pagesWorkflow.includes('uses: actions/upload-pages-artifact@v5'));
assert.ok(
  pagesWorkflow.includes('PAGES_ARTIFACT_NAME: github-pages-${{ github.run_attempt }}'),
  'Pages artifact names must be unique per workflow attempt so retries cannot create ambiguous duplicates'
);
assert.ok(
  /uses: actions\/upload-pages-artifact@v5[\s\S]*?with:\s*\n\s+name: \$\{\{ env\.PAGES_ARTIFACT_NAME \}\}\s*\n\s+path: dist\b/.test(pagesWorkflow),
  'Pages upload must use the retry-safe artifact name and dist payload'
);
assert.ok(
  /uses: actions\/deploy-pages@v5[\s\S]*?with:\s*\n\s+artifact_name: \$\{\{ env\.PAGES_ARTIFACT_NAME \}\}/.test(pagesWorkflow),
  'Pages deployment must request the exact retry-safe artifact uploaded by this attempt'
);

console.log(
  `GitHub Actions runtime validated across ${workflowFiles.length} workflows: `
    + [...counts.entries()].map(([action, count]) => `${action}=${count}`).join(', ')
    + '; github-script v9 ESM hazards are absent and Pages retries use unique artifacts.'
);
