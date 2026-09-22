#!/usr/bin/env node
'use strict';

// Must be required before express (via ./app) so HTTP/Express
// auto-instrumentation can patch them. Disabled by default in tests and any
// process that sets CLOUDPORT_DISABLE_OTEL, since the SDK binds a port and
// patches globals as a side effect of being loaded.
if (!process.env.CLOUDPORT_DISABLE_OTEL) {
  const { startOtel, registerDomainMetrics } = require('./telemetry/otel');
  startOtel();
  registerDomainMetrics(require('./db').query);
}

const { createApp } = require('./app');
const db = require('./db');
const { createLiveInspector } = require('../../../analyzer/infrastructure/inspector');
const { createLiveWorkloadRunner } = require('./liveWorkloadExecutor');
const { createRecoveryRunner } = require('./recoveryRunner');

const PORT = process.env.PORT || 4000;

const inspector = createLiveInspector();
const runWorkload = createLiveWorkloadRunner();
const recoveryRunner = createRecoveryRunner({ query: db.query });

const app = createApp({
  query: db.query,
  inspector,
  runWorkload,
  recoveryRunner,
});

app.listen(PORT, () => {
  console.log(`CloudPort backend listening on port ${PORT}`);
  console.log(`Application version: ${process.env.APP_VERSION || 'cloudport:1.0.0'}`);
  console.log(`Live Kubernetes inspector: kind-korifi enabled`);
});
