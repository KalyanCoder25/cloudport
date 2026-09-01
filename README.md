# CloudPort

Infrastructure-Aware Application Portability, Controlled A/B Experimentation,
Telemetry, Leakage Analysis, Evidence, and Recovery Platform.

CloudPort lets you run the *same* application, workload, configuration, and
PRNG seed against two Kubernetes infrastructure configurations
("Infrastructure A" baseline and "Infrastructure B" variant), and answers,
with evidence, whether the infrastructure difference produced a measurable,
replicated, application-visible effect -- without letting you (or itself)
overclaim causation. See `docs/architecture/safety.md` for the full safety
model.

## Table of contents

- [Prerequisites](#prerequisites)
- [Architecture](#architecture)
- [Installation](#installation)
- [Environment variables](#environment-variables)
- [Database setup](#database-setup)
- [Docker setup](#docker-setup)
- [Kind + Korifi setup](#kind--korifi-setup)
- [Container image build](#container-image-build)
- [Infrastructure A](#infrastructure-a)
- [Infrastructure B: safety checks, dry-run, provisioning, verification](#infrastructure-b)
- [Experiment execution](#experiment-execution)
- [Telemetry, leakage, evidence, reports](#telemetry-leakage-evidence-reports)
- [Recovery](#recovery)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Cleanup](#cleanup)

## Prerequisites

- Node.js 20+ and npm 10+
- PostgreSQL 14+ (local install, or via `docker-compose.yml`)
- Docker Desktop (for building the `cloudport:1.0.0` image and running Kind)
- [Kind](https://kind.sigs.k8s.io/) with a cluster named `korifi`
  (context `kind-korifi`)
- [kubectl](https://kubernetes.io/docs/tasks/tools/)
- A [Korifi](https://github.com/cloudfoundry/korifi) installation on that
  Kind cluster (CloudPort treats Korifi as an external dependency and never
  modifies its internals)
- Git Bash (Windows users running the `.sh` safety scripts) or PowerShell for
  native Windows commands

All commands below are given for **Git Bash**, **PowerShell**, and **CMD**
where they differ. Do not mix syntax between shells.

## Architecture

See `docs/architecture/overview.md` for the full breakdown. Short version:

```
application/   -- the system under test (backend API + workload engine, frontend dashboard, DB schema)
analyzer/      -- pure statistics/evidence/safety logic, no HTTP or DB code
platform/      -- Kubernetes manifests + safety scripts for Infrastructure A and B
experiments/   -- experiment manifests (JSON)
docs/          -- architecture, experiment design, generated reports
scripts/       -- safety-gate scripts, Docker/Kind helpers
tests/         -- unit, safety, and API tests
```

## Installation

**Git Bash / macOS / Linux:**
```bash
git clone <this-repository> cloudport
cd cloudport
npm install
cp .env.example .env
```

**PowerShell:**
```powershell
git clone <this-repository> cloudport
Set-Location cloudport
npm install
Copy-Item .env.example .env
```

**CMD:**
```cmd
git clone <this-repository> cloudport
cd cloudport
npm install
copy .env.example .env
```

Then edit `.env` with real PostgreSQL credentials.

Install frontend dependencies separately (it is its own workspace):
```bash
cd application/frontend
npm install
cd ../..
```

## Environment variables

See `.env.example` for the full list. The essentials:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string used by the migration runner, seed script, and backend |
| `PORT` | Backend HTTP port (default 4000) |
| `APP_VERSION` | Must remain `cloudport:1.0.0` -- reported by `/api/version` and embedded in telemetry |
| `INFRA_IDENTITY` | Free-text label for provenance only; the workload engine must never branch on this value |
| `EXPECTED_KUBE_CONTEXT` | Used by safety scripts; defaults to `kind-korifi` |
| `VITE_API_BASE_URL` | Frontend's API base URL (default `http://localhost:4000/api`) |

## Database setup

**Option A: local PostgreSQL.** Create a database and user matching your
`.env`, then:

```bash
npm run db:migrate
npm run db:seed
npm run db:status
```

**Option B: docker-compose (Postgres only, or Postgres + backend):**

```bash
docker compose up -d postgres
npm run db:migrate
npm run db:seed
```

`db:migrate` is forward-only and idempotent (`SKIP (already applied): ...`
for anything already applied). `db:seed` seeds a `DRAFT`-status experiment
row and one operator user -- it never fabricates telemetry, infrastructure
snapshots, or leakage findings, in line with CloudPort's scientific safety
rules.

## Docker setup

Build the whole local stack (Postgres + backend API):

```bash
docker compose up --build
```

Or build just the application image (needed for Kind, see below):

**Git Bash:**
```bash
./scripts/build-image.sh
```
**PowerShell:**
```powershell
.\scripts\build-image.ps1
```
**CMD:** use Git Bash or PowerShell for this step; a native CMD script is
not provided since Docker CLI syntax is identical across bash/PowerShell/CMD
-- run: `docker build -t cloudport:1.0.0 .` then `docker images cloudport:1.0.0`.

## Kind + Korifi setup

This README assumes you already have a Kind cluster named `korifi` (context
`kind-korifi`) with Korifi installed, per Korifi's own documentation.
CloudPort does not create or configure Korifi itself. Verify:

```bash
kubectl config get-contexts
kubectl config use-context kind-korifi
kubectl get nodes
kubectl get pods -A | grep -i korifi
```

## Container image build

```bash
./scripts/build-image.sh      # Git Bash / Linux / macOS
.\scripts\build-image.ps1     # PowerShell
```

Then load it into Kind so pods can pull it without a registry:

```bash
./scripts/kind-load-image.sh korifi
```
(PowerShell/CMD: run `kind load docker-image cloudport:1.0.0 --name korifi`
directly.)

Verify:
```bash
docker images cloudport:1.0.0
kubectl -n cloudport describe deployment cloudport-app-a   # after Infrastructure A is applied
```

> **NOT VERIFIED — REQUIRES HOST ENVIRONMENT.** This repository was produced
> in a sandbox without a Docker daemon or a live Kubernetes cluster. The
> Dockerfile and Kubernetes manifests have been reviewed for correctness and
> validated for YAML/schema syntax (`scripts/validate-manifests.sh`), but the
> actual `docker build`, `kind load docker-image`, and `kubectl apply`
> commands have not been executed against a real cluster. Do this on your
> workstation before running a real experiment.

## Infrastructure A

Infrastructure A is the protected baseline. Apply it once:

```bash
kubectl apply -f platform/infrastructure-a/00-namespace.yaml
kubectl apply -f platform/infrastructure-a/01-pvc.yaml
kubectl apply -f platform/infrastructure-a/02-deployment.yaml
kubectl apply -f platform/infrastructure-a/03-service.yaml
kubectl -n cloudport rollout status deployment/cloudport-app-a
```

See `platform/infrastructure-a/README.md` for the full resource list and
protection guarantees.

## Infrastructure B

### Safety checks & dry-run

Infrastructure B's provisioning script runs 12 safety gates before touching
the cluster (context, cluster identity, protected namespaces/StorageClasses,
NetworkPolicy absence, exact resource inventory, manifest + server-side
dry-run, image presence). You can run the same checks standalone:

```bash
bash scripts/validate-manifests.sh
node scripts/check-protected-namespaces.js platform/infrastructure-b
node scripts/check-storageclass-safety.js platform/infrastructure-b
node scripts/check-resource-inventory.js platform/infrastructure-b
```

### Provisioning

**Git Bash:**
```bash
./platform/infrastructure-b/provision.sh
```

If any gate fails, the script prints exactly which one and exits without
mutating anything.

### Verification

```bash
kubectl -n cloudport get pvc cloudport-storage-b
kubectl -n cloudport rollout status deployment/cloudport-app-b
kubectl get storageclass standard-throttled
```

## Experiment execution

1. Confirm the experiment manifest checksum matches between A and B configs
   (this happens automatically server-side; see
   `analyzer/evidence/checksum.js`).
2. Create/verify the experiment is `READY_FOR_EXECUTION` (Section 36 gate:
   both infrastructures healthy, both PVCs/pods healthy, versions/workload/
   checksums identical, telemetry/database/evidence pipelines ready).
3. Execute -- this is **never automatic**:
   ```bash
   curl -X POST http://localhost:4000/api/analyzer/experiments/<id>/run \
     -H "Content-Type: application/json" \
     -d '{"confirm": true}'
   ```
   Omitting `"confirm": true` returns HTTP 428 and changes nothing.

## Telemetry, leakage, evidence, reports

```
GET /api/analyzer/experiments/:id            experiment detail
GET /api/analyzer/experiments/:id/differences   persisted infra differences (fast, no live cluster call)
GET /api/analyzer/experiments/:id/behaviour     A/B telemetry comparison
GET /api/analyzer/experiments/:id/leakage       leakage score + rubric breakdown
GET /api/analyzer/experiments/:id/evidence      sanitized evidence artifacts
GET /api/analyzer/experiments/:id/report        the 20-section Markdown report
GET /api/analyzer/experiments/:id/replication   replication classification per metric
GET /api/analyzer/experiments/:id/recovery      recovery events, if any faults were injected
```

The dashboard (`application/frontend`) renders all of the above. Run it with:

```bash
cd application/frontend
npm run dev
```

## Recovery

Fault injection (`analyzer/behaviour/faultInjection.js`) is scoped to the
`cloudport` namespace only and is always reversible/auditable. Recovery
verification (`analyzer/recovery/recoveryVerification.js`) reports what was
actually observed -- it never asserts a recovery guarantee without evidence.

## Testing

```bash
npm test           # full suite (unit + safety + API)
npm run test:unit
npm run test:safety
npm run test:api
npm run lint
npm run build       # builds the frontend
```

See [Test Results](#test-results-and-known-limitations) below (or the final
delivery report) for the actual pass/fail counts from this build.

## Troubleshooting

| Symptom | Likely cause | Diagnosis |
|---|---|---|
| `docker: command not found` | Docker Desktop not running/installed | `docker --version`; start Docker Desktop |
| `kubectl` unavailable | Not installed / not on PATH | `kubectl version --client` |
| Wrong Kubernetes context | Multiple clusters configured | `kubectl config current-context`; `kubectl config use-context kind-korifi` |
| Kind cluster unavailable | Cluster not created / Docker not running | `kind get clusters`; `docker ps` |
| `ErrImagePull` / `ImagePullBackOff` | Image not built or not loaded into Kind | `docker images cloudport:1.0.0`; `kind load docker-image cloudport:1.0.0 --name korifi` |
| PVC stuck `Pending` | local-path-provisioner not running, or a custom `nodePath` was set without matching provisioner config | `kubectl -n local-path-storage get pods`; `kubectl describe pvc cloudport-storage-b -n cloudport` |
| StorageClass configuration mismatch | `standard-throttled` object missing or misconfigured | `kubectl get storageclass standard-throttled -o yaml` |
| PostgreSQL unavailable | Wrong `DATABASE_URL`, or Postgres not running | `npm run db:status`; `docker compose ps postgres` |
| API unavailable | Backend not started, or `DATABASE_URL` misconfigured | `curl http://localhost:4000/health`; check backend logs |

## Cleanup

**Git Bash:**
```bash
./platform/infrastructure-b/cleanup.sh
```

This deletes exactly `deployment/cloudport-app-b`,
`service/cloudport-service-b`, `pvc/cloudport-storage-b`, and
`storageclass/standard-throttled`, after verifying each carries the
`cloudport.io/infrastructure: variant-b` label. It never touches
Infrastructure A, the shared `cloudport` namespace, or any Korifi/system
resource. See `docs/architecture/safety.md` for the full guarantee list.

## Known limitations (see also the final delivery report)

- Live Kubernetes/Docker verification requires a host environment with
  Docker Desktop, Kind, and kubectl -- this was **NOT VERIFIED** in the
  sandbox that produced this repository. All logic that would run against a
  live cluster has been implemented and is unit/safety-tested with injected
  fakes instead.
- The frontend defaults to the most recently created experiment for
  per-experiment views; a full experiment picker/selector is a natural next
  iteration.
- Statistical significance testing (e.g. a formal hypothesis test) is left
  as an optional, injectable `significance` field on behaviour comparisons
  (`analyzer/behaviour/behaviourComparison.js`) rather than a specific
  built-in test, so no particular statistical test is silently assumed.
