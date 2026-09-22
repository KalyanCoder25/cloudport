#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# infra/terraform/destroy-gcp.sh
#
# Safe cleanup of GCP GKE resources created by this capstone.
#
# SAFETY GATES:
#   1. Confirms the target cluster name before destroying
#   2. Requires explicit user confirmation (type 'yes')
#   3. ONLY destroys resources managed by infra/terraform/gcp/
#   4. Does NOT touch: kind-korifi, Korifi installation, AWS resources,
#      CloudPort local environment, Supabase, or unrelated GCP resources
#
# Usage:
#   bash infra/terraform/destroy-gcp.sh
#
# Run this ONLY when you are done with the capstone experiment.
# ---------------------------------------------------------------------------

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GCP_DIR="$REPO_ROOT/infra/terraform/gcp"
EXPECTED_CLUSTER="cloudport-capstone-gke"

echo ""
echo "=================================================================="
echo "  CloudPort Capstone — GCP GKE Cleanup"
echo "=================================================================="
echo ""
echo "  This will destroy the following resources:"
echo "    - GKE cluster: ${EXPECTED_CLUSTER}"
echo "    - Node pool"
echo "    - VPC network, subnetwork, Cloud Router, Cloud NAT"
echo ""
echo "  This will NOT destroy:"
echo "    - kind-korifi environment"
echo "    - Korifi installation"
echo "    - AWS/EKS resources"
echo "    - CloudPort local environment"
echo "    - Supabase PostgreSQL"
echo "    - Any other GCP projects or unrelated GCP resources"
echo ""
echo "  Terraform state: $GCP_DIR/terraform.tfstate"
echo ""

read -r -p "Type the cluster name to confirm destruction [${EXPECTED_CLUSTER}]: " confirm_name
if [ "$confirm_name" != "$EXPECTED_CLUSTER" ]; then
  echo "Cluster name mismatch. Aborting — no resources destroyed." >&2
  exit 1
fi

read -r -p "Are you sure? Type 'yes' to proceed: " confirm_yes
if [ "$confirm_yes" != "yes" ]; then
  echo "Destruction cancelled — no resources destroyed."
  exit 0
fi

cd "$GCP_DIR"
echo ""
echo "Running terraform destroy..."
terraform destroy -auto-approve

echo ""
echo "GCP GKE resources destroyed."
echo "Verify with: gcloud container clusters list"
