# Observability: OpenTelemetry, Prometheus, Grafana, and the statistics service

Two independent additions, both opt-in and both optional for CloudPort's core
experiment logic to function:

## Metrics: OpenTelemetry -> Prometheus -> Grafana

`application/backend/src/telemetry/otel.js` initializes the OpenTelemetry Node
SDK with HTTP + Express auto-instrumentation and an OTel **Prometheus**
exporter -- the backend serves metrics in Prometheus exposition format
directly on `:9464/metrics`, so there is no separate OTel Collector in this
deployment size.

It is required first thing in `server.js` (before `./app`, so it can patch
`http`/`express` on require) and is **not** loaded by `app.js` or any test --
OTel SDK init is global, side-effecting process state, which is exactly what
the rest of the backend deliberately avoids so it stays unit-testable with
fakes. Set `CLOUDPORT_DISABLE_OTEL=1` to skip it entirely.

Beyond HTTP/runtime metrics, `registerDomainMetrics()` exposes CloudPort
domain gauges via observable callbacks that query the database at scrape
time: `cloudport_experiments_total{status}`, `cloudport_deployments_total{provider,status}`,
`cloudport_leakage_score_latest{experiment_id}`, and
`cloudport_multicloud_leakage_score_latest{experiment_id}`. A failed query
during a scrape is swallowed, never fabricated -- a stale read shows up as a
stale Grafana panel, not a wrong number.

`docker-compose.yml` adds `prometheus` (scrapes `backend:9464` and
`statistics:8090`) and `grafana` (anonymous viewer access, admin password
`changeme` for local dev only). Grafana auto-provisions the Prometheus
datasource and a "CloudPort Overview" dashboard from
`platform/observability/grafana/`.

```bash
docker compose up -d backend statistics prometheus grafana
# Prometheus: http://localhost:9090
# Grafana:    http://localhost:3001  (anonymous viewer, or admin/changeme)
```

## Statistics: SciPy-backed paired t-test

`services/statistics/` is a small Flask service (`scipy.stats`) exposing:

- `POST /paired-ttest` -- same response shape as
  `analyzer/telemetry/statisticalTests.js`'s `pairedTTest()`, plus an
  `engine: "scipy"` field so callers and evidence artifacts can always tell
  which engine produced a given number.
- `POST /normality` -- Shapiro-Wilk test on the paired differences. There is
  no JS equivalent; the pure-JS implementation can only *note* that normality
  is assumed, this can actually test it.
- `GET /metrics` -- its own Prometheus metrics (request count + latency by
  endpoint), scraped by the `prometheus` service above.

`analyzer/telemetry/scipyStatsClient.js` is the Node-side client. When
`STATS_SERVICE_URL` is unset, or the service is unreachable, it transparently
falls back to the pure-JS implementation and records why
(`serviceFallbackReason`) -- it never blocks an experiment on the Python
service being up. `MultiCloudExperimentRunner` uses this client (injectable
via `deps.pairedTTest` for tests, which pin the deterministic JS engine).

```bash
docker compose up -d statistics
curl -X POST http://localhost:8090/paired-ttest \
  -H "Content-Type: application/json" \
  -d '{"valuesA":[100,102,98,101,99,103],"valuesB":[110,111,108,112,109,113]}'
```
