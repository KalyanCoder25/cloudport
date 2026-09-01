'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { loadManifests } = require('../../scripts/lib/loadManifests');

const INFRA_A_DIR = path.join(__dirname, '..', '..', 'platform', 'infrastructure-a');
const INFRA_B_DIR = path.join(__dirname, '..', '..', 'platform', 'infrastructure-b');

function findDeployment(manifests, name) {
  return manifests.find((m) => m.kind === 'Deployment' && m.metadata?.name === name);
}

function getEnvVar(deployment, name) {
  const container = deployment.spec.template.spec.containers[0];
  const envVar = (container.env || []).find((e) => e.name === name);
  return envVar ? envVar.value : undefined;
}

function getVolumeMountPath(deployment, volumeName) {
  const container = deployment.spec.template.spec.containers[0];
  const mount = (container.volumeMounts || []).find((vm) => vm.name === volumeName);
  return mount ? mount.mountPath : undefined;
}

test('Infrastructure A deployment mounts its PVC at /data and sets CLOUDPORT_STORAGE_MOUNT=/data', () => {
  const manifests = loadManifests(INFRA_A_DIR);
  const deployment = findDeployment(manifests, 'cloudport-app-a');
  assert.ok(deployment, 'expected to find deployment/cloudport-app-a');
  assert.equal(getVolumeMountPath(deployment, 'storage'), '/data');
  assert.equal(getEnvVar(deployment, 'CLOUDPORT_STORAGE_MOUNT'), '/data');
});

test('Infrastructure B deployment mounts its PVC at /data and sets CLOUDPORT_STORAGE_MOUNT=/data', () => {
  const manifests = loadManifests(INFRA_B_DIR);
  const deployment = findDeployment(manifests, 'cloudport-app-b');
  assert.ok(deployment, 'expected to find deployment/cloudport-app-b');
  assert.equal(getVolumeMountPath(deployment, 'storage'), '/data');
  assert.equal(getEnvVar(deployment, 'CLOUDPORT_STORAGE_MOUNT'), '/data');
});

test('Infrastructure A and B agree on the storage mount path (only the underlying PVC/StorageClass differs)', () => {
  const manifestsA = loadManifests(INFRA_A_DIR);
  const manifestsB = loadManifests(INFRA_B_DIR);
  const deploymentA = findDeployment(manifestsA, 'cloudport-app-a');
  const deploymentB = findDeployment(manifestsB, 'cloudport-app-b');

  assert.equal(getEnvVar(deploymentA, 'CLOUDPORT_STORAGE_MOUNT'), getEnvVar(deploymentB, 'CLOUDPORT_STORAGE_MOUNT'));
  assert.equal(getVolumeMountPath(deploymentA, 'storage'), getVolumeMountPath(deploymentB, 'storage'));

  // The claims backing that identical mount path must still be distinct --
  // that's the actual controlled variable under test.
  const claimA = deploymentA.spec.template.spec.volumes.find((v) => v.name === 'storage').persistentVolumeClaim.claimName;
  const claimB = deploymentB.spec.template.spec.volumes.find((v) => v.name === 'storage').persistentVolumeClaim.claimName;
  assert.notEqual(claimA, claimB);
  assert.equal(claimA, 'cloudport-storage-a');
  assert.equal(claimB, 'cloudport-storage-b');
});
