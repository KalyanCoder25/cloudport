/**
 * OpenTelemetry instrumentation bootstrap.
 *
 * Initializes the Node SDK with HTTP + Express auto-instrumentation and an
 * OTel Prometheus exporter, which serves metrics in Prometheus exposition
 * format directly (no separate OTel Collector needed for this deployment
 * size). docker-compose's `prometheus` service scrapes that endpoint, and
 * `grafana` reads from Prometheus.
 *
 * This module is intentionally separate from app.js / analyzer: OTel SDK
 * initialization is global, side-effecting process state (it patches
 * `http`/`express` on require), which is exactly what the rest of the
 * backend deliberately avoids so it stays unit-testable with fakes. It must
 * be required before `express` anywhere else in the process for the
 * auto-instrumentation to attach -- see server.js, which requires this
 * first, and app.js/test files, which never require it at all.
 *
 * CUSTOM METRICS: alongside HTTP/runtime metrics, this exposes CloudPort
 * domain gauges (experiment counts by status, deployment counts by
 * provider/status, most recent leakage scores) via observable callbacks that
 * query the database at scrape time. A stale read here shows up as a stale
 * Grafana panel -- it never fabricates a value when the query fails.
 */
'use strict';

const { NodeSDK } = require('@opentelemetry/sdk-node');
const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus');
const { HttpInstrumentation } = require('@opentelemetry/instrumentation-http');
const { ExpressInstrumentation } = require('@opentelemetry/instrumentation-express');
const { resourceFromAttributes } = require('@opentelemetry/resources');
const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = require('@opentelemetry/semantic-conventions');
const { metrics } = require('@opentelemetry/api');

const METRICS_PORT = parseInt(process.env.OTEL_METRICS_PORT || '9464', 10);
const METER_NAME = 'cloudport-backend';

let sdk = null;

function startOtel() {
  if (sdk) return sdk;

  const prometheusExporter = new PrometheusExporter({ port: METRICS_PORT, host: '0.0.0.0' });

  sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'cloudport-backend',
      [ATTR_SERVICE_VERSION]: process.env.APP_VERSION || 'cloudport:1.0.0',
    }),
    metricReader: prometheusExporter,
    instrumentations: [new HttpInstrumentation(), new ExpressInstrumentation()],
  });

  sdk.start();
  console.log(`OpenTelemetry Prometheus exporter listening on :${METRICS_PORT}/metrics`);
  return sdk;
}

/**
 * Registers CloudPort domain gauges against a database query function.
 * Call once, after startOtel(), with the same `query` the rest of the
 * backend uses.
 */
function registerDomainMetrics(query) {
  const meter = metrics.getMeter(METER_NAME);

  const experimentsGauge = meter.createObservableGauge('cloudport_experiments_total', {
    description: 'Number of experiments by status',
  });
  experimentsGauge.addCallback(async (result) => {
    try {
      const res = await query('SELECT status, COUNT(*)::int AS count FROM experiments GROUP BY status');
      for (const row of res.rows) {
        result.observe(row.count, { status: row.status });
      }
    } catch (_err) {
      // Scrape reflects "unknown right now", never a fabricated count.
    }
  });

  const deploymentsGauge = meter.createObservableGauge('cloudport_deployments_total', {
    description: 'Number of deployments by target provider and status',
  });
  deploymentsGauge.addCallback(async (result) => {
    try {
      const res = await query(
        "SELECT target_provider, status, COUNT(*)::int AS count FROM deployments WHERE deleted_at IS NULL GROUP BY target_provider, status"
      );
      for (const row of res.rows) {
        result.observe(row.count, { provider: row.target_provider, status: row.status });
      }
    } catch (_err) {
      // no-op
    }
  });

  const leakageGauge = meter.createObservableGauge('cloudport_leakage_score_latest', {
    description: 'Most recent leakage score per experiment (local kind-korifi experiments)',
  });
  leakageGauge.addCallback(async (result) => {
    try {
      const res = await query(
        `SELECT DISTINCT ON (experiment_id) experiment_id, score
         FROM leakage_findings ORDER BY experiment_id, created_at DESC`
      );
      for (const row of res.rows) {
        result.observe(row.score, { experiment_id: row.experiment_id });
      }
    } catch (_err) {
      // no-op
    }
  });

  const multicloudLeakageGauge = meter.createObservableGauge('cloudport_multicloud_leakage_score_latest', {
    description: 'Most recent leakage score per multi-cloud experiment',
  });
  multicloudLeakageGauge.addCallback(async (result) => {
    try {
      const res = await query(
        `SELECT DISTINCT ON (experiment_id) experiment_id, leakage_score
         FROM multicloud_experiment_results
         WHERE leakage_score IS NOT NULL
         ORDER BY experiment_id, created_at DESC`
      );
      for (const row of res.rows) {
        result.observe(row.leakage_score, { experiment_id: row.experiment_id });
      }
    } catch (_err) {
      // no-op
    }
  });
}

module.exports = { startOtel, registerDomainMetrics };
