# CloudPort Multi-Cloud Capstone — Master Guide

> **Status**: Infrastructure-as-Code layer complete. Ready for operator-approved cloud provisioning.
> No real AWS/GCP resources have been created. No measurements have been fabricated.

## Table of Contents

1. [Architecture](#1-architecture)
2. [Terraform Structure](#2-terraform-structure)
3. [AWS EKS Setup](#3-aws-eks-setup)
4. [GCP GKE Setup](#4-gcp-gke-setup)
5. [Kubernetes Context Setup](#5-kubernetes-context-setup)
6. [Benchmark Deployment](#6-benchmark-deployment)
7. [Locust Load Generation](#7-locust-load-generation)
8. [CloudPort Integration](#8-cloudport-integration)
9. [Experiment Methodology](#9-experiment-methodology)
10. [Telemetry](#10-telemetry)
11. [Leakage Analysis](#11-leakage-analysis)
12. [Evidence Generation](#12-evidence-generation)
13. [Recovery](#13-recovery)
14. [Cleanup](#14-cleanup)
15. [Security / Credential Handling](#15-security--credential-handling)
16. [Cost Considerations](#16-cost-considerations)

---

## 1. Architecture

See [`docs/multicloud/architecture.md`](architecture.md) for the full architecture diagram.

**Two-track system:**
- **LOCAL**: `kind-korifi` → existing A/B experiments (unchanged)
- **CAPSTONE MULTI-CLOUD**: `aws-eks-cloudport` vs `gcp-gke-cloudport` → new

---

## 2. Terraform Structure

```
infra/terraform/
├── modules/network/     # Naming/tagging convention module
├── modules/eks/         # AWS EKS cluster module
├── modules/gke/         # GCP GKE cluster module
├── aws/                 # AWS provider root
├── gcp/                 # GCP provider root
├── validate-all.sh      # Safe validation (never applies)
├── destroy-aws.sh       # Safe AWS cleanup
└── destroy-gcp.sh       # Safe GCP cleanup
```

See [`infra/terraform/README.md`](../../infra/terraform/README.md) for the full Terraform guide.

---

## 3. AWS EKS Setup

### Prerequisites
- AWS CLI v2 installed: `aws --version`
- Terraform ≥ 1.6.0: `terraform version`
- kubectl installed: `kubectl version --client`
- AWS credentials configured (IAM Identity Center recommended)

### Provision

```bash
# 1. Configure variables
cd infra/terraform/aws
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars (no credentials in file)

# 2. Authenticate (IAM Identity Center)
aws sso login --profile your-profile
export AWS_PROFILE=your-profile

# 3. Validate (safe — no cloud resources created)
bash ../validate-all.sh

# 4. Review plan carefully
terraform plan

# 5. Apply (requires explicit decision)
terraform apply

# 6. Note the kubeconfig command from outputs
terraform output kubeconfig_command
```

### Key Resources Created

| Resource | Name | Purpose |
|---|---|---|
| VPC | `cloudport-capstone-eks-vpc` | Worker node network |
| EKS Cluster | `cloudport-capstone-eks` | Kubernetes control plane |
| Node Group | `cloudport-capstone-eks-ng` | Worker nodes (3× t3.medium) |
| IAM Roles | `cloudport-capstone-eks-*-role` | EKS and node permissions |
| NAT Gateway | `cloudport-capstone-eks-natgw` | Private node internet access |

---

## 4. GCP GKE Setup

### Prerequisites
- gcloud CLI installed: `gcloud version`
- Terraform ≥ 1.6.0: `terraform version`
- GCP project with billing enabled
- GCP credentials configured: `gcloud auth application-default login`

### Provision

```bash
# 1. Configure variables
cd infra/terraform/gcp
cp terraform.tfvars.example terraform.tfvars
# Edit terraform.tfvars — set gcp_project_id

# 2. Authenticate
gcloud auth application-default login
gcloud config set project your-gcp-project-id

# 3. Enable required APIs
gcloud services enable container.googleapis.com compute.googleapis.com

# 4. Validate (safe — no cloud resources created)
bash ../validate-all.sh

# 5. Review plan carefully
terraform plan

# 6. Apply (requires explicit decision)
terraform apply

# 7. Note the kubeconfig command from outputs
terraform output kubeconfig_command
```

### Key Resources Created

| Resource | Name | Purpose |
|---|---|---|
| VPC | `cloudport-capstone-gke-vpc` | Worker node network |
| GKE Cluster | `cloudport-capstone-gke` | Kubernetes control plane |
| Node Pool | `cloudport-capstone-gke-np` | Worker nodes (3× e2-medium) |
| Cloud Router/NAT | `cloudport-capstone-gke-router/nat` | Private node internet access |

---

## 5. Kubernetes Context Setup

```bash
# Configure contexts (never overwrites kind-korifi)
bash infra/contexts/configure-contexts.sh

# Verify all three contexts are available
kubectl config get-contexts

# Verify reachability
kubectl get nodes --context=aws-eks-cloudport
kubectl get nodes --context=gcp-gke-cloudport
kubectl get nodes --context=kind-korifi    # must still work
```

See [`infra/contexts/README.md`](../../infra/contexts/README.md) for the full context guide.

---

## 6. Benchmark Deployment

```bash
# Deploy Online Boutique v0.10.1 to BOTH clusters (same manifests)

# AWS EKS
kubectl apply --context=aws-eks-cloudport -k platform/multicloud/benchmark/

# GCP GKE
kubectl apply --context=gcp-gke-cloudport -k platform/multicloud/benchmark/

# Verify
kubectl get pods -n online-boutique --context=aws-eks-cloudport
kubectl get pods -n online-boutique --context=gcp-gke-cloudport

# Record image digests for evidence
kubectl get pods -n online-boutique --context=aws-eks-cloudport \
  -o jsonpath='{range .items[*]}{.spec.containers[*].image}{"\n"}{end}'
```

**Disable the built-in loadgenerator** in Online Boutique before running controlled Locust tests:
```bash
kubectl scale deployment loadgenerator -n online-boutique --replicas=0 --context=aws-eks-cloudport
kubectl scale deployment loadgenerator -n online-boutique --replicas=0 --context=gcp-gke-cloudport
```

---

## 7. Locust Load Generation

```bash
# Deploy Locust to a cluster (run against one cluster at a time for controlled trials)

# Deploy to AWS EKS
kubectl apply --context=aws-eks-cloudport -f platform/multicloud/locust/kubernetes/

# Set provenance environment variables before each trial
kubectl set env deployment/locust-master -n locust \
  CLOUDPORT_EXPERIMENT_ID=multicloud-portability-v1 \
  CLOUDPORT_TRIAL_ID=trial-001 \
  CLOUDPORT_TARGET_CONTEXT=aws-eks-cloudport \
  CLOUDPORT_CLOUD_PROVIDER=AWS \
  --context=aws-eks-cloudport

# Monitor trial progress
kubectl logs -f deployment/locust-master -n locust --context=aws-eks-cloudport

# Collect results (provenance JSON written to pod /results/)
kubectl exec -n locust deployment/locust-master --context=aws-eks-cloudport \
  -- cat /results/trial-provenance.json
```

Repeat for GCP GKE with `CLOUDPORT_TARGET_CONTEXT=gcp-gke-cloudport` and `CLOUDPORT_CLOUD_PROVIDER=GCP`.

---

## 8. CloudPort Integration

The multi-cloud extension adds:

| Module | Purpose |
|---|---|
| `analyzer/infrastructure/multiCloudK8sClient.js` | Live cluster inspection (AWS + GCP) |
| `analyzer/infrastructure/multiCloudInspector.js` | Lazy inspector (cloud) |
| `application/backend/src/multiCloudExperimentRunner.js` | Multi-cloud orchestrator |
| `experiments/multicloud-portability-v1.json` | Experiment definition |

Existing modules used **unchanged**:
- `statisticalTests.js` — paired t-test, INSUFFICIENT_SAMPLE
- `leakageScore.js` — 0-100 rubric (+ `locust-kubernetes` source)
- `causalGovernance.js` — POTENTIAL_LEAKAGE / CORRELATION_ONLY
- `evidenceGraph.js`, `artifactGenerator.js`, `reportGenerator.js`

---

## 9. Experiment Methodology

1. Deploy Online Boutique (same version) to both clusters
2. Capture infrastructure snapshots from both clusters
3. Run 5 paired Locust trials (same load profile against each cluster)
4. Statistical analysis: paired t-test on latency p95
5. Leakage scoring: existing rubric with `locust-kubernetes` source
6. Causal governance: POTENTIAL_LEAKAGE or CORRELATION_ONLY
7. Evidence generation: full provenance artifacts

See [`experiments/multicloud-portability-v1.json`](../../experiments/multicloud-portability-v1.json) for the full experiment definition.

---

## 10. Telemetry

**Collected per trial:**

| Metric | Source |
|---|---|
| `latency_p50_ms`, `p95`, `p99` | Locust stats |
| `requests_per_second` | Locust stats |
| `error_rate` | Locust stats |
| `request_count`, `success_count`, `failure_count` | Locust stats |
| `duration_seconds` | Locust run time |

**Collected per infrastructure:**

| Metric | Source |
|---|---|
| Kubernetes version | Live API call |
| Node CPU/memory capacity + allocatable | Live API call |
| StorageClass provisioner | Live API call |
| LoadBalancer type + annotations | Live API call |
| Cloud provider (AWS/GCP) | Node labels |

---

## 11. Leakage Analysis

Provider differences (load balancer type, StorageClass, CNI) are classified as `INFRASTRUCTURE_DIFFERENCE` — not automatically as leakage.

Leakage is only classified when the full causal chain is supported:

```
Cloud infrastructure difference
    ↓
Application measurement (Locust latency, error rate)
    ↓
Repeated trials (n ≥ 5)
    ↓
Statistical significance (paired t-test, p < 0.05)
    ↓
Leakage classification (POTENTIAL_LEAKAGE or CORRELATION_ONLY)
```

See [`docs/multicloud/architecture.md`](architecture.md) for the pipeline diagram.

---

## 12. Evidence Generation

Each experiment generates:
- Infrastructure profile A (AWS) + B (GCP)
- Infrastructure differences
- Per-trial telemetry with full provenance
- Statistical analysis results
- Leakage score + rubric breakdown
- Causal governance classification
- Evidence graph (complete causal chain)
- Evidence artifacts (JSON)
- Markdown report

---

## 13. Recovery

The existing `recoveryRunner.js` is **not modified**. It targets only `cloudport-app-b` on `kind-korifi`.

For multi-cloud experiments, recovery testing is **not implemented** in this capstone layer. If implemented in future, it must be scoped to the `online-boutique` namespace only, never the EKS/GKE control plane.

---

## 14. Cleanup

```bash
# Remove benchmark application
kubectl delete -k platform/multicloud/benchmark/ --context=aws-eks-cloudport
kubectl delete -k platform/multicloud/benchmark/ --context=gcp-gke-cloudport

# Remove Locust
kubectl delete -f platform/multicloud/locust/kubernetes/ --context=aws-eks-cloudport
kubectl delete -f platform/multicloud/locust/kubernetes/ --context=gcp-gke-cloudport

# Destroy cloud infrastructure (manual confirmation required)
bash infra/terraform/destroy-aws.sh
bash infra/terraform/destroy-gcp.sh

# Verify
aws eks list-clusters --region ap-south-1
gcloud container clusters list
```

---

## 15. Security / Credential Handling

See [`docs/multicloud/security.md`](security.md) for the full guide.

**Never commit**: credentials, tfstate, tfvars (non-example), kubeconfig files, GCP SA keys.

---

## 16. Cost Considerations

See [`docs/multicloud/cost-considerations.md`](cost-considerations.md) for estimates and controls.

**Estimated capstone cost**: ~$65 for 5 active days across both clusters.
**Always run**: `bash infra/terraform/destroy-*.sh` when done.
