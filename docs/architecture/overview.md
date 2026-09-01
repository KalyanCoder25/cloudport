# CloudPort Architecture Overview

## Purpose

CloudPort is a platform for scientifically comparing the behavior of the
*same* application, under the *same* workload, configuration, and PRNG seed,
across two Kubernetes infrastructure configurations ("Infrastructure A" and
"Infrastructure B"). Only the intended infrastructure variable is allowed to
differ between the two. CloudPort's job is to make it structurally difficult
to draw an unsupported causal conclusion from the results.

## Components

```
cloudport/
├── application/
│   ├── backend/       Express API + deterministic workload engine (the "system under test")
│   ├── frontend/      React/Vite/TypeScript operator dashboard
│   └── database/      PostgreSQL schema + migration runner + seed script
│
├── analyzer/           Pure, dependency-light analysis modules (no HTTP, no DB):
│   ├── infrastructure/  snapshot normalization (lazy) + difference detection
│   ├── behaviour/       repeated-trial statistics, A/B comparison, application-visible
│   │                    difference detection, fault injection
│   ├── telemetry/       shared statistics primitives (percentiles, safe division, etc.)
│   ├── leakage/         transparent leakage scoring rubric
│   ├── evidence/        checksum/parity validation, causal governance classifier,
│   │                    evidence graph builder, artifact generator, report generator
│   └── recovery/        recovery verification from fault-injection observations
│
├── platform/
│   ├── infrastructure-a/  Kubernetes manifests for the protected baseline
│   └── infrastructure-b/  Kubernetes manifests + provisioning/cleanup/validator for the variant
│
├── experiments/        Experiment manifests (JSON) defining invariants, workload, replication count
├── scripts/             Safety-gate scripts (Node) + image build/load helpers (bash + PowerShell)
├── docs/                 This documentation
└── tests/               Unit, safety, and API tests (Node's built-in test runner)
```

## Data flow for one experiment

1. An **experiment manifest** (`experiments/*.json`) declares the application
   version, workload parameters, PRNG seed, resource envelope, controlled
   variable, and excluded dimensions. `analyzer/evidence/checksum.js` computes
   a canonical SHA-256 checksum over the manifest's `invariants` object.
2. Before execution, CloudPort verifies that the Infrastructure A and
   Infrastructure B deployment configs produce the *same* invariant checksum
   -- i.e. everything except the target dimension truly is identical. If the
   checksums differ, the experiment cannot proceed (`FAILED_VALIDATION`).
3. Once parity is validated and both infrastructures are confirmed healthy,
   the experiment is marked `READY_FOR_EXECUTION`. Execution never happens
   automatically -- an operator must call
   `POST /api/analyzer/experiments/:id/run` with `{"confirm": true}`.
4. Each paired trial runs the deterministic workload
   (`application/backend/src/workload.js`) against Infrastructure A and
   Infrastructure B, seeded identically. Telemetry (latencies, throughput,
   errors) is recorded for both.
5. `analyzer/infrastructure/differenceDetector.js` compares normalized
   infrastructure snapshots. `analyzer/behaviour/behaviourComparison.js`
   compares telemetry. `analyzer/behaviour/applicationVisibleDetector.js`
   decides whether any infrastructure difference correlates with a
   *meaningful* (>=10% by default) metric shift.
6. Across all paired trials, `analyzer/behaviour/repeatedTrials.js` assesses
   whether the effect (if any) replicates consistently.
7. `analyzer/leakage/leakageScore.js` computes a transparent, documented 0-100
   score. `analyzer/evidence/causalGovernance.js` is the single choke point
   that turns all of the above into a final classification -- and it is
   structurally incapable of emitting an unqualified causal claim; anything
   beyond "correlation, replicated" is downgraded.
8. `analyzer/evidence/evidenceGraph.js` builds a traceable graph from
   Experiment through Trial, Snapshot, Difference, Telemetry, Comparison,
   Leakage, Replication, to Final Finding. `artifactGenerator.js` emits the
   sanitized JSON artifact set. `reportGenerator.js` renders the 20-section
   Markdown report.

## Why the analyzer layer has no HTTP or DB code

Every module under `analyzer/` is a pure function (or a small class with an
explicit, injectable dependency) operating on plain JavaScript values. This
is deliberate:

- It makes every classification and calculation independently unit-testable
  without a database or a cluster.
- It lets the backend (`application/backend/src/app.js`) inject fakes for
  the database and the Kubernetes client, which is what makes the mandatory
  regression test (`tests/safety/no-live-k8s-on-differences.test.js`) possible.
- It keeps "does this violate our scientific safety rules" reviewable in one
  place (`causalGovernance.js`) instead of scattered across route handlers.

See `docs/architecture/safety.md` for the specific safety guarantees this
architecture is designed to uphold.
