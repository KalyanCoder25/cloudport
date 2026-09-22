# CloudPort Multi-Cloud Capstone — Architecture

## System Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        CloudPort Platform                               │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │                LOCAL VALIDATION (existing)                      │    │
│  │                                                                  │    │
│  │   kind-korifi (local Kubernetes)                                 │    │
│  │     ├── cloudport-app-a (standard StorageClass, 2000m CPU)       │    │
│  │     └── cloudport-app-b (throttled StorageClass, 200m CPU)       │    │
│  │                                                                  │    │
│  │   Experiments: storage-isolation, cpu-resource-isolation         │    │
│  │   Measurement: kubectl exec (kubernetes-pod-exec)                │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │        CAPSTONE MULTI-CLOUD VALIDATION (new, additive)          │    │
│  │                                                                  │    │
│  │   Infrastructure A: AWS EKS (aws-eks-cloudport)                  │    │
│  │     ├── Online Boutique v0.10.1 (namespace: online-boutique)     │    │
│  │     ├── Locust load generator (namespace: locust)                │    │
│  │     └── CloudPort multi-cloud inspector                          │    │
│  │                                                                  │    │
│  │   Infrastructure B: GCP GKE (gcp-gke-cloudport)                  │    │
│  │     ├── Online Boutique v0.10.1 (same manifests)                  │    │
│  │     ├── Locust load generator (same locustfile)                   │    │
│  │     └── CloudPort multi-cloud inspector                          │    │
│  │                                                                  │    │
│  │   Experiment: multicloud-portability-v1                          │    │
│  │   Measurement: Locust (locust-kubernetes)                        │    │
│  └────────────────────────────────────────────────────────────────┘    │
│                                                                         │
│  ┌────────────────────────────────────────────────────────────────┐    │
│  │              Shared Analysis Pipeline (unchanged)               │    │
│  │                                                                  │    │
│  │   statisticalTests.js → paired t-test, INSUFFICIENT_SAMPLE      │    │
│  │   leakageScore.js     → 0-100 rubric (+ locust-kubernetes)       │    │
│  │   causalGovernance.js → POTENTIAL_LEAKAGE / CORRELATION_ONLY     │    │
│  │   evidenceGraph.js    → full causal chain tracing                │    │
│  │   reportGenerator.js  → 20-section evidence report               │    │
│  └────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
```

## Context Separation

| Context | Cluster Type | Purpose | Code Path |
|---|---|---|---|
| `kind-korifi` | Local Kind | Existing A/B experiments | `k8sClient.js` + `experimentRunner.js` |
| `aws-eks-cloudport` (alias: `aws-eks-cluster`) | AWS EKS | Capstone Infra A (ap-south-1) | `multiCloudK8sClient.js` + `multiCloudExperimentRunner.js` |
| `gcp-gke-cloudport` (alias: `gcp-gke-cluster`) | GCP GKE | Capstone Infra B (asia-south1) | `multiCloudK8sClient.js` + `multiCloudExperimentRunner.js` |

These code paths are **structurally separate** and cannot be mixed. The multi-cloud
runner explicitly rejects `kind-korifi`, and the local runner's `EXPECTED_KUBERNETES_CONTEXT`
constant is `kind-korifi` only. Both canonical context names (`aws-eks-cloudport`, `gcp-gke-cloudport`)
and aliases (`aws-eks-cluster`, `gcp-gke-cluster`) are supported.

## Infrastructure Provisioning Flow

```
Operator                    Terraform                   Cloud Provider
   │                            │                            │
   ├── review plan ──────────►  │                            │
   │   (no apply yet)           │                            │
   │                            │                            │
   ├── terraform apply ───────► │ ──── provision ──────────► EKS / GKE
   │   (explicit approval)      │                            │
   │                            │ ◄──── cluster ready ───────│
   │                            │                            │
   ├── configure-contexts.sh ─► │ (merges kubeconfig)        │
   │                            │                            │
   ├── deploy benchmark ──────────────────────────────────► kubectl apply -k
   │                            │                            │
   ├── run experiment ────────► MultiCloudExperimentRunner   │
   │                            │                            │
   │                     ┌──── Analysis Pipeline ────────┐  │
   │                     │ inspector → leakage → evidence │  │
   │                     └────────────────────────────────┘  │
```

## What Was NOT Changed

- `k8sClient.js` — unchanged (kind-korifi only)
- `inspector.js` — unchanged (kind-korifi only)
- `experimentRunner.js` — unchanged (kind-korifi only)
- `recoveryRunner.js` — unchanged (cloudport-app-b, kind-korifi only)
- All existing tests — unchanged and passing
- `leakageScore.js` — one backward-compatible extension (added `locust-kubernetes` to valid sources)
- PostgreSQL schema — additive only (new tables for multicloud results)
