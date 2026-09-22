# Kubernetes Context Management — CloudPort Capstone

## Authorized Contexts

CloudPort uses three strictly separated Kubernetes contexts:

| Context Name | Provider | Purpose | Modified By |
|---|---|---|---|
| `kind-korifi` | Local Kind cluster | Existing CloudPort A/B experiments | **NEVER MODIFIED** |
| `aws-eks-cloudport` | AWS EKS | Capstone Infrastructure A | `configure-contexts.sh` |
| `gcp-gke-cloudport` | GCP GKE | Capstone Infrastructure B | `configure-contexts.sh` |

## Safety Guarantee

The `kind-korifi` context is **never overwritten, modified, or set as current context** by any
multi-cloud script. The context configuration script explicitly:

1. Reads the current context before any operation.
2. Adds new contexts using `--alias` (AWS) and `rename-context` (GCP) to give canonical names.
3. Restores the original current context after completion.
4. Verifies `kind-korifi` is still present.

## Setting Up Contexts

```bash
# Prerequisites: EKS and GKE clusters provisioned via Terraform
bash infra/contexts/configure-contexts.sh
```

## Verifying Contexts

```bash
# List all contexts
kubectl config get-contexts

# Verify each context is reachable
kubectl get nodes --context=aws-eks-cloudport
kubectl get nodes --context=gcp-gke-cloudport
kubectl get nodes --context=kind-korifi     # must still work

# Check current context (should be kind-korifi for local work)
kubectl config current-context
```

## Cross-Cloud Safety Rule

CloudPort's multi-cloud experiment runner explicitly validates the Kubernetes context
before every operation. It will refuse to execute if:

- The context is `kind-korifi` (local experiments only, not for cloud comparison)
- The context is `localhost` or any other unauthorized value
- The cloud provider detected from node labels does not match the declared provider

This is enforced in `analyzer/infrastructure/multiCloudK8sClient.js`.

## Context Naming Convention

| Setting | Value |
|---|---|
| `MULTICLOUD_CONTEXT_AWS` | `aws-eks-cloudport` |
| `MULTICLOUD_CONTEXT_GCP` | `gcp-gke-cloudport` |
| `EXPECTED_KUBE_CONTEXT` | `kind-korifi` (existing local experiments) |

Never mix these. The multi-cloud runner and the local runner use different context
variables and refuse to operate on each other's clusters.
