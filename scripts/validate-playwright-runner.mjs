import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { selectWorkerPort } from './playwright-runner.mjs';

const occupied = createServer();
await new Promise((resolve, reject) => {
  occupied.once('error', reject);
  occupied.listen({ host: '127.0.0.1', port: 8792, exclusive: true }, resolve);
});

try {
  await assert.rejects(selectWorkerPort('8792'), /already in use/);
  const selected = await selectWorkerPort();
  assert.ok(selected >= 8793 && selected <= 8891, `auto-isolation escaped the project range: ${selected}`);
  process.stdout.write(`Playwright runner port fallback validated: occupied 8792 rejected; auto-selected free project port ${selected}.\n`);
} finally {
  await new Promise(resolve => occupied.close(resolve));
}
