# CloudPort Safety Model

CloudPort makes two kinds of safety promises: **scientific safety** (never
claim more than the evidence supports) and **infrastructure safety** (never
mutate or delete something you shouldn't). Both are enforced in code, not
just in documentation, and both are covered by the automated test suite.

## Scientific safety

### The core rule

> APPLICATION + APPLICATION VERSION + WORKLOAD + CONFIGURATION + SEED must
> remain identical between Infrastructure A and Infrastructure B. Only the
> intended infrastructure variable may differ. The platform must never
> assert a causal claim beyond what the evidence chain actually supports.

### How it's enforced

| Rule | Enforced by |
|---|---|
| Never fabricate telemetry | `application/backend/src/workload.js` produces real, measured latencies from real file operations; nothing in the analyzer layer invents numbers. `seed.js` deliberately does not seed telemetry/snapshots/leakage findings. |
| Never claim replication from one trial | `analyzer/behaviour/repeatedTrials.js` hardcodes `MIN_TRIALS_FOR_CLASSIFICATION = 2`; below that, the only possible classification is `INSUFFICIENT_REPLICATION`. |
| Never mark every infra difference as application-visible | `analyzer/behaviour/applicationVisibleDetector.js` requires a documented minimum percent-change threshold (default 10%) before a metric shift counts as "meaningful". |
| Never hide the leakage scoring logic | `analyzer/leakage/leakageScore.js`'s rubric weights are named constants that sum to 100 (tested in `tests/unit/leakageScore.test.js`), and the per-item breakdown is always returned alongside the total score. |
| Never assert causation | `analyzer/evidence/causalGovernance.js` is the only place a "final classification" is produced. Every branch that could otherwise imply causation instead sets `causalLanguage: 'CORRELATION_ONLY'` and lists `prohibitedClaims`. |
| Never call something "IOPS throttling" without implementing/measuring it | Infrastructure B's StorageClass (`platform/infrastructure-b/01-storageclass.yaml`) is documented and named as a "storage substrate / path allocation difference" throughout the codebase; no throttling mechanism exists in this repository. |
| Never run with missing telemetry / failed parity | `causalGovernance.js` returns `INSUFFICIENT_DATA` immediately if `parityValidated` or `telemetryComplete` is false, before considering any other evidence. |
| Never fabricate live Kubernetes results when no cluster is available | `analyzer/infrastructure/inspector.js`'s `notVerifiedProfile()` helper and the `NOT VERIFIED — REQUIRES HOST ENVIRONMENT` label used throughout the frontend and docs. |

### Possible causal-governance classifications

```
NO_EVIDENCE                     -- no infrastructure difference detected
INFRASTRUCTURE_DIFFERENCE_ONLY  -- infra differs, no meaningful app-visible shift
INSUFFICIENT_DATA               -- parity/telemetry missing
INSUFFICIENT_REPLICATION        -- correlation seen, but <2 paired trials
POTENTIAL_LEAKAGE               -- correlation replicated, but variable, or leakage score moderate/high
CONFIRMED_REPLICATED            -- correlation replicated consistently, low leakage
```

Every non-`NO_EVIDENCE` classification that involves an application-visible
shift is paired with `causalLanguage: 'CORRELATION_ONLY'` -- CloudPort never
emits language like "storage caused the latency increase" from this
classifier, and the report generator only ever surfaces the classifier's own
output, never a hand-written causal sentence.

## Infrastructure safety

### The 12 provisioning safety gates (`platform/infrastructure-b/provision.sh`)

1. `kubectl` is on PATH
2. A current kubectl context exists
3. The current context is exactly `kind-korifi`
4. The cluster bound to that context is named `kind-korifi`
5. The Kubernetes API responds within 5 seconds
6. No manifest targets a protected namespace (see list below)
7. No manifest targets a protected StorageClass, and no StorageClass sets an
   unregistered `nodePath` parameter
8. No `NetworkPolicy` manifest is present
9. The manifest set is *exactly* the approved Infrastructure B resource list
   -- no more, no less
10. Every manifest passes `kubectl apply --dry-run=client`
11. Every manifest passes `kubectl apply --dry-run=server`
12. The `cloudport:1.0.0` Docker image is present locally (best-effort check)

If **any** gate fails, the script prints which gate failed and exits
immediately without mutating the cluster. It never attempts automatic
recovery or partial rollback -- there is nothing to roll back, because
nothing was applied.

### Protected resources (never touched by Infrastructure B tooling)

- Namespaces: `kube-system`, `kube-public`, `kube-node-lease`, `default`,
  `cf`, `korifi`, `korifi-gateway`, `kpack`, `cert-manager`
- StorageClasses: `standard`, `local-path`
- All of Infrastructure A's own resources: `cloudport-app-a`,
  `cloudport-storage-a`, `cloudport-service-a`

### Cleanup safety (`platform/infrastructure-b/cleanup.sh`)

Cleanup deletes exactly four resources: `deployment/cloudport-app-b`,
`service/cloudport-service-b`, `pvc/cloudport-storage-b`, and
`storageclass/standard-throttled`. Before deleting anything, the script:

- Refuses to run unless the current context is `kind-korifi`
- Confirms the resource is on an explicit protected-name denylist check
  (fails closed if the target name is protected)
- Reads back the resource's `cloudport.io/infrastructure` label and refuses
  to delete anything not labeled `variant-b`
- Never issues a `delete namespace` command at all -- the `cloudport`
  namespace is shared with Infrastructure A and is never a deletion target

This is covered by `tests/safety/cleanup-safety.test.js`, which parses the
actual script source and asserts these properties hold.

### The execution gate (Section 36 of the original spec)

An experiment can reach `READY_FOR_EXECUTION` only after (conceptually):
Infrastructure A healthy, Infrastructure B healthy, both PVCs healthy, both
pods healthy, application versions identical, workload identical, checksums
identical, excluded dimensions invariant, telemetry pipeline ready, database
ready, evidence pipeline ready. Execution itself still requires an explicit
`POST .../run` with `{"confirm": true}` -- see
`application/backend/src/app.js`. `tests/api/routes.test.js` verifies that a
request without `confirm: true` is rejected with HTTP 428 and never mutates
experiment status.
