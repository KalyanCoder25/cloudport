'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { LocalKubernetesProvider } = require('../../application/backend/src/deployments/deploymentProviders');
const child_process = require('child_process');
const https = require('https');
const EventEmitter = require('events');

const DEPLOYMENT = {
  id: 'test1234-abcd',
  metadata: { appName: 'testApp' },
  source_type: 'GITHUB',
  source_reference: 'https://github.com/test/repo',
};

const EXPECTED_APP = 'cloudport-testapp-test1234';
const EXPECTED_SPACE = 'cloudport-testapp';

/**
 * Builds an execSync stub that answers the cf calls the provider makes.
 * `apps` is the resource list returned for `cf curl /v3/apps?...`.
 */
function cfStub({ commands = [], apps = [], orgs = [{ guid: 'o1' }], spaces = [{ guid: 's1' }] } = {}) {
  return (cmd) => {
    commands.push(cmd);
    if (cmd.includes('/v3/organizations')) return Buffer.from(JSON.stringify({ resources: orgs }));
    if (cmd.includes('/v3/spaces')) return Buffer.from(JSON.stringify({ resources: spaces }));
    if (cmd.includes('/v3/apps')) return Buffer.from(JSON.stringify({ resources: apps }));
    if (cmd.includes('kubectl config get-contexts')) return Buffer.from('kind-korifi\ndocker-desktop');
    return Buffer.from('');
  };
}

function stubHttps(statusCode) {
  https.get = (_url, _opts, cb) => {
    const req = new EventEmitter();
    req.destroy = () => {};
    if (statusCode !== null) {
      setImmediate(() => cb({ statusCode, resume: () => {} }));
    } else {
      setImmediate(() => req.emit('error', new Error('unreachable')));
    }
    return req;
  };
}

test('LocalKubernetesProvider (Korifi cf push)', async (t) => {
  const originalExecSync = child_process.execSync;
  const originalExecFileSync = child_process.execFileSync;
  const originalSpawn = child_process.spawn;
  const originalHttpsGet = https.get;

  t.beforeEach(() => {
    // Stubbed by default so no test reaches the network to clone a repository.
    child_process.execFileSync = () => Buffer.from('');
  });

  t.afterEach(() => {
    child_process.execSync = originalExecSync;
    child_process.execFileSync = originalExecFileSync;
    child_process.spawn = originalSpawn;
    https.get = originalHttpsGet;
  });

  await t.test('checkPrerequisites reports BLOCKED_CONFIGURATION when the cf CLI is absent', async () => {
    child_process.execSync = (cmd) => {
      if (cmd.includes('cf --version')) throw new Error('cf: not found');
      return Buffer.from('');
    };
    const result = await new LocalKubernetesProvider().checkPrerequisites();
    assert.equal(result.status, 'BLOCKED_CONFIGURATION');
    assert.equal(result.ready, false);
    assert.match(result.reason, /cf\) is not installed/i);
  });

  await t.test('checkPrerequisites reports BLOCKED_CREDENTIALS when cf is not authenticated', async () => {
    child_process.execSync = (cmd) => {
      if (cmd.trim() === 'cf target') throw new Error('Not logged in');
      if (cmd.includes('kubectl config get-contexts')) return Buffer.from('kind-korifi');
      return Buffer.from('');
    };
    const result = await new LocalKubernetesProvider().checkPrerequisites();
    assert.equal(result.status, 'BLOCKED_CREDENTIALS');
    assert.equal(result.ready, false);
  });

  await t.test('deploy pushes through cf and reports DEPLOYING rather than claiming RUNNING', async () => {
    const commands = [];
    child_process.execSync = cfStub({ commands, apps: [] });

    const spawned = [];
    child_process.spawn = (cmd, args) => {
      spawned.push({ cmd, args });
      const child = new EventEmitter();
      child.unref = () => {};
      return child;
    };

    const result = await new LocalKubernetesProvider().deploy(DEPLOYMENT);

    assert.equal(result.status, 'DEPLOYING');
    assert.equal(result.metadata.cfAppName, EXPECTED_APP);
    assert.equal(result.metadata.space, EXPECTED_SPACE);
    assert.equal(result.metadata.platform, 'KORIFI_CLOUD_FOUNDRY');
    assert.ok(commands.some((c) => c.includes(`cf target -o cloudport -s ${EXPECTED_SPACE}`)));

    const push = spawned.find((s) => s.cmd === 'cf' && s.args[0] === 'push');
    assert.ok(push, 'expected a detached cf push');
    assert.equal(push.args[1], EXPECTED_APP);
  });

  await t.test('deploy starts an already-staged app instead of re-pushing it', async () => {
    const commands = [];
    child_process.execSync = cfStub({ commands, apps: [{ guid: 'a1', state: 'STOPPED' }] });
    child_process.spawn = () => assert.fail('should not re-push an app that only needs starting');

    const result = await new LocalKubernetesProvider().deploy(DEPLOYMENT);

    assert.equal(result.status, 'DEPLOYING');
    assert.equal(result.metadata.action, 'cf start');
    assert.ok(commands.some((c) => c.includes(`cf start ${EXPECTED_APP}`)));
  });

  await t.test('getStatus reports RUNNING once the app is STARTED and its route answers', async () => {
    child_process.execSync = cfStub({ apps: [{ guid: 'a1', state: 'STARTED' }] });
    stubHttps(200);

    const result = await new LocalKubernetesProvider().getStatus(DEPLOYMENT);

    assert.equal(result.status, 'RUNNING');
    assert.equal(result.ready, true);
    assert.equal(result.endpointUrl, `https://${EXPECTED_APP}.apps-127-0-0-1.nip.io`);
  });

  await t.test('getStatus refuses to claim RUNNING when the route does not answer', async () => {
    child_process.execSync = cfStub({ apps: [{ guid: 'a1', state: 'STARTED' }] });
    stubHttps(null);

    const result = await new LocalKubernetesProvider().getStatus(DEPLOYMENT);

    assert.equal(result.status, 'DEPLOYING');
    assert.equal(result.ready, false);
    assert.equal(result.endpointUrl, null);
  });

  await t.test('getStatus reports STOPPED for an app the platform has stopped', async () => {
    child_process.execSync = cfStub({ apps: [{ guid: 'a1', state: 'STOPPED' }] });

    const result = await new LocalKubernetesProvider().getStatus(DEPLOYMENT);

    assert.equal(result.status, 'STOPPED');
    assert.equal(result.ready, false);
    assert.equal(result.endpointUrl, null);
  });

  await t.test('stop issues cf stop', async () => {
    const commands = [];
    child_process.execSync = cfStub({ commands });

    const result = await new LocalKubernetesProvider().stop(DEPLOYMENT);

    assert.equal(result.status, 'STOPPED');
    assert.ok(commands.some((c) => c.includes(`cf stop ${EXPECTED_APP}`)));
  });

  await t.test('delete issues cf delete with route removal', async () => {
    const commands = [];
    child_process.execSync = cfStub({ commands });

    const result = await new LocalKubernetesProvider().delete(DEPLOYMENT);

    assert.equal(result.status, 'DELETED');
    assert.ok(commands.some((c) => c.includes(`cf delete ${EXPECTED_APP} -f -r`)));
  });

  await t.test('deploy refuses to clone a source reference that is not a valid GitHub URL', async () => {
    child_process.execSync = cfStub({ apps: [] });
    child_process.spawn = () => assert.fail('should not push an unvalidated source');

    const result = await new LocalKubernetesProvider().deploy({
      ...DEPLOYMENT,
      source_reference: 'https://github.com/x/y; rm -rf /',
    });

    assert.equal(result.status, 'FAILED');
    assert.match(result.errorMessage, /untrusted source reference/i);
  });
});
