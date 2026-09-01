# Experiment: storage-isolation-replicated-v1

Manifest: `experiments/storage-isolation-replicated-v1.json`

## Design summary

| Parameter | Value |
|---|---|
| Application version | `cloudport:1.0.0` |
| Workload | `STORAGE` |
| Concurrency | 5 |
| Operation count | 200 |
| PRNG seed | 987654 |
| CPU envelope | 2.0 |
| Memory envelope | 4Gi |
| Controlled variable | `STORAGE` |
| Target dimension | `STORAGE` |
| Excluded dimensions | `NETWORK`, `CPU`, `MEMORY`, `APPLICATION`, `WORKLOAD` |
| Replication | 3 paired trials |

## What "paired trial" means here

One paired trial = one execution of the deterministic workload against
Infrastructure A, and one execution of the *exact same* workload
(same seed, same concurrency, same operation count) against Infrastructure
B. Three paired trials means six total workload executions (3 x A, 3 x B).

## Why a checksum, not just "we configured it the same way"

Configuration drift is the most common way this kind of experiment quietly
becomes invalid. `analyzer/evidence/checksum.js` computes a canonical SHA-256
hash over the exact set of values listed under `invariants` in the manifest.
Before an experiment is allowed into `READY_FOR_EXECUTION`, CloudPort
recomputes this checksum from whatever configuration Infrastructure A and
Infrastructure B are actually running and requires them to match exactly. If
someone changes the concurrency for "just this one Infrastructure B run" and
forgets to change it back for A, the checksums will differ and the run is
blocked.

## What this experiment can and cannot tell you

It **can** tell you, with replication evidence, whether switching from the
cluster's default local-path StorageClass to a distinctly-provisioned
`standard-throttled` StorageClass (same provisioner, different binding
object) is associated with a measurable, repeatable shift in the
application's own latency/throughput/error telemetry.

It **cannot**, by itself, tell you *why* -- CloudPort's causal governance
classifier will report at most `CONFIRMED_REPLICATED` with
`causalLanguage: CORRELATION_ONLY`, not a proven causal mechanism. See
`docs/architecture/safety.md`.

## Status of this document

This describes the experiment's *design*. For its *results*, see
`docs/reports/storage-isolation-replication-v1.md`, which is generated code
(`analyzer/evidence/reportGenerator.js`) and will read
`PRE-EXECUTION / READY FOR REPLICATED EXPERIMENT` until real trials run.
