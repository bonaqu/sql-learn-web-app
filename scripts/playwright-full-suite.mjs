import { runPlaywright } from './playwright-runner.mjs';

const projects = [
  'desktop-foundation',
  'desktop-learning',
  'mobile-foundation',
  'mobile-learning'
];

for (const project of projects) {
  for (const shard of ['1/2', '2/2']) {
    process.stdout.write(`\n=== Playwright isolated session: ${project} shard ${shard} ===\n`);
    const status = await runPlaywright([
      '--fail-on-flaky-tests',
      `--project=${project}`,
      `--shard=${shard}`
    ]);
    if (status !== 0) {
      process.exitCode = status;
      break;
    }
  }
  if (process.exitCode) break;
}
