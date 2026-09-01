'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getStorageMountPath } = require('../../application/backend/src/config');

test('getStorageMountPath returns null when CLOUDPORT_STORAGE_MOUNT is unset', () => {
  delete process.env.CLOUDPORT_STORAGE_MOUNT;
  assert.equal(getStorageMountPath(), null);
});

test('getStorageMountPath returns null for an empty/whitespace-only value', () => {
  process.env.CLOUDPORT_STORAGE_MOUNT = '   ';
  assert.equal(getStorageMountPath(), null);
  delete process.env.CLOUDPORT_STORAGE_MOUNT;
});

test('getStorageMountPath returns the configured, trimmed path when set', () => {
  process.env.CLOUDPORT_STORAGE_MOUNT = ' /data ';
  assert.equal(getStorageMountPath(), '/data');
  delete process.env.CLOUDPORT_STORAGE_MOUNT;
});
