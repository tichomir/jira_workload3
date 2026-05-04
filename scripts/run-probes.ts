import { runPermissionProbes } from '../src/probes/permissionProbes.js';

const connectionId = process.argv[2];
if (!connectionId) {
  console.error('Usage: run-probes.ts <connectionId>');
  process.exit(1);
}

console.log(`[probe-runner] running probes for connectionId=${connectionId}`);

try {
  const results = await runPermissionProbes(connectionId);
  console.log('[probe-runner] done. results:');
  console.log(JSON.stringify(results, null, 2));
} catch (e) {
  console.error('[probe-runner] error:', e);
  process.exit(1);
}
