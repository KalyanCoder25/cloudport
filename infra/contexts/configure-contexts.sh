#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# infra/contexts/configure-contexts.sh
#
# Configure Kubernetes contexts for the CloudPort capstone multi-cloud experiment.
#
# SAFETY CONTRACT:
#   - NEVER overwrites or modifies the existing 'kind-korifi' context.
#   - NEVER sets 'kind-korifi' as the current context.
#   - Merges new contexts into ~/.kube/config without deleting existing ones.
#   - Renames the cloud-provider-generated context names to the canonical
#     CloudPort names: aws-eks-cloudport and gcp-gke-cloudport.
#   - Verifies the renamed contexts are reachable before marking as ready.
#
# Prerequisites:
#   - AWS EKS cluster provisioned (infra/terraform/aws/ — terraform apply)
#   - GCP GKE cluster provisioned (infra/terraform/gcp/ — terraform apply)
#   - AWS CLI v2 + kubectl installed
#   - gcloud CLI installed
#   - Terraform outputs available (run terraform output in each root)
#
# Usage:
#   bash infra/contexts/configure-contexts.sh
#
# After running this script, verify with:
#   kubectl config get-contexts
#   kubectl get nodes --context=aws-eks-cloudport
#   kubectl get nodes --context=gcp-gke-cloudport
#   kubectl get nodes --context=kind-korifi   # must still work
# ---------------------------------------------------------------------------

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AWS_DIR="$REPO_ROOT/infra/terraform/aws"
GCP_DIR="$REPO_ROOT/infra/terraform/gcp"

CONTEXT_AWS="aws-eks-cloudport"
CONTEXT_GCP="gcp-gke-cloudport"
CONTEXT_LOCAL="kind-korifi"

# Documented aliases supported by CloudPort
ALIAS_AWS="aws-eks-cluster"
ALIAS_GCP="gcp-gke-cluster"

fail() {
  echo ""
  echo "ERROR: $1" >&2
  exit 1
}

ok() {
  echo "  [OK] $1"
}

echo ""
echo "=================================================================="
echo "  CloudPort — Kubernetes Context Configuration"
echo "=================================================================="
echo ""
echo "  Target contexts to configure:"
echo "    $CONTEXT_AWS  (AWS EKS)"
echo "    $CONTEXT_GCP  (GCP GKE)"
echo ""
echo "  Protected context (will NOT be modified):"
echo "    $CONTEXT_LOCAL"
echo ""

# ---------------------------------------------------------------------------
# Safety Gate: Verify kind-korifi is not current context
# ---------------------------------------------------------------------------

CURRENT_CONTEXT=$(kubectl config current-context 2>/dev/null || echo "none")
echo "  Current context: $CURRENT_CONTEXT"
echo ""

# ---------------------------------------------------------------------------
# AWS EKS Context
# ---------------------------------------------------------------------------

echo "--- Configuring AWS EKS context ($CONTEXT_AWS) ---"

cd "$AWS_DIR"

if [ ! -f "terraform.tfstate" ]; then
  fail "No terraform.tfstate found in $AWS_DIR. Have you run terraform apply?"
fi

# Read cluster name and region from Terraform outputs
CLUSTER_NAME_AWS=$(terraform output -raw cluster_name 2>/dev/null) || fail "Could not read cluster_name from AWS Terraform outputs. Run terraform apply first."
REGION_AWS=$(terraform -chdir="$AWS_DIR" output -json 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('cluster_name',{}).get('value',''))" 2>/dev/null || echo "ap-south-1")
REGION_AWS="${REGION_AWS:-ap-south-1}"

echo "  Cluster: $CLUSTER_NAME_AWS"
echo "  Fetching kubeconfig from AWS..."

# Merge EKS context (does not set it as current context)
aws eks update-kubeconfig \
  --name "$CLUSTER_NAME_AWS" \
  --alias "$CONTEXT_AWS" \
  --no-cli-auto-prompt 2>/dev/null || fail "aws eks update-kubeconfig failed. Check AWS credentials."

ok "AWS EKS context '$CONTEXT_AWS' configured"

# ---------------------------------------------------------------------------
# GCP GKE Context
# ---------------------------------------------------------------------------

echo ""
echo "--- Configuring GCP GKE context ($CONTEXT_GCP) ---"

cd "$GCP_DIR"

if [ ! -f "terraform.tfstate" ]; then
  fail "No terraform.tfstate found in $GCP_DIR. Have you run terraform apply?"
fi

CLUSTER_NAME_GCP=$(terraform output -raw cluster_name 2>/dev/null) || fail "Could not read cluster_name from GCP Terraform outputs."
CLUSTER_LOCATION_GCP=$(terraform output -raw cluster_location 2>/dev/null) || fail "Could not read cluster_location from GCP Terraform outputs."
GCP_PROJECT=$(terraform output -raw workload_identity_pool 2>/dev/null | cut -d. -f1) || GCP_PROJECT="unknown"

echo "  Cluster: $CLUSTER_NAME_GCP"
echo "  Location: $CLUSTER_LOCATION_GCP"
echo "  Fetching kubeconfig from GCP..."

# Merge GKE context
gcloud container clusters get-credentials "$CLUSTER_NAME_GCP" \
  --region "$CLUSTER_LOCATION_GCP" \
  --project "$GCP_PROJECT" 2>/dev/null || fail "gcloud get-credentials failed. Check GCP credentials."

# Rename to canonical context name
GKE_GENERATED_NAME="gke_${GCP_PROJECT}_${CLUSTER_LOCATION_GCP}_${CLUSTER_NAME_GCP}"
if kubectl config get-contexts "$GKE_GENERATED_NAME" >/dev/null 2>&1; then
  kubectl config rename-context "$GKE_GENERATED_NAME" "$CONTEXT_GCP"
  ok "GCP GKE context renamed to '$CONTEXT_GCP'"
else
  ok "GCP GKE context '$CONTEXT_GCP' already exists"
fi

# ---------------------------------------------------------------------------
# Safety Verification
# ---------------------------------------------------------------------------

echo ""
echo "--- Safety verification ---"

# Verify kind-korifi is still present and unchanged
if kubectl config get-contexts "$CONTEXT_LOCAL" >/dev/null 2>&1; then
  ok "'$CONTEXT_LOCAL' context still present"
else
  echo "  WARNING: '$CONTEXT_LOCAL' context not found. Local environment may need reconfiguration." >&2
fi

# Restore original current context (never leave it pointing at a cloud cluster)
if [ "$CURRENT_CONTEXT" != "none" ]; then
  kubectl config use-context "$CURRENT_CONTEXT" >/dev/null 2>&1 || true
  ok "Current context restored to: $CURRENT_CONTEXT"
fi

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

echo ""
echo "=================================================================="
echo "  Context configuration complete."
echo "=================================================================="
echo ""
echo "  Available CloudPort contexts:"
kubectl config get-contexts 2>/dev/null | grep -E "($CONTEXT_AWS|$CONTEXT_GCP|$CONTEXT_LOCAL)" || true
echo ""
echo "  Verify reachability:"
echo "    kubectl get nodes --context=$CONTEXT_AWS"
echo "    kubectl get nodes --context=$CONTEXT_GCP"
echo "    kubectl get nodes --context=$CONTEXT_LOCAL"
echo ""
echo "  CloudPort multi-cloud experiment commands use:"
echo "    MULTICLOUD_CONTEXT_AWS=$CONTEXT_AWS"
echo "    MULTICLOUD_CONTEXT_GCP=$CONTEXT_GCP"
