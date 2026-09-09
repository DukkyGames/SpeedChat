import { listAgentCliModels, listAgentCliModelsWithConfig, parseCursorListModels } from './server/models/agent-cli-catalog.js';
import { detectAgentCli, verifyAgentCliAuth } from './server/models/agent-cli-detect.js';

const staticRows = listAgentCliModels('cursor-agent-cli');
console.log('static count', staticRows.length, staticRows.map((r) => r.id).join(', '));

const detect = await detectAgentCli('cursor', { fresh: true });
console.log('detect', {
  installed: detect.installed,
  authStatus: detect.authStatus,
  hasCredentialFile: detect.hasCredentialFile,
  resolvedBinPath: detect.resolvedBinPath,
  resolvedCommand: detect.resolvedCommand,
  version: detect.version,
});

const verified = await verifyAgentCliAuth('cursor');
console.log('verify', { authStatus: verified.authStatus, version: verified.version });

const t0 = Date.now();
const live = await listAgentCliModelsWithConfig('cursor-agent-cli');
console.log('live count', live.length, 'ms', Date.now() - t0);
console.log('live sample', live.slice(0, 15).map((r) => r.id).join(', '));
console.log('has composer', live.some((r) => r.id.includes('composer')));
console.log('has auto', live.some((r) => r.id === 'auto'));
