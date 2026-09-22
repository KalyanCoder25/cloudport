#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# infra/terraform/destroy-aws.sh
#
# Safe cleanup of AWS EKS resources created by this capstone.
#
# SAFETY GATES:
#   1. Confirms the target cluster name before destroying
#   2. Requires explicit user confirmation (type 'yes')
#   3. ONLY destroys resources managed by infra/terraform/aws/
#   4. Does NOT touch: kind-korifi, Korifi installation, GCP resources,
#      CloudPort local environment, Supabase, or unrelated AWS resources
#
# Usage:
#   bash infra/terraform/destroy-aws.sh
#
# Run this ONLY when you are done with the capstone experiment.
# ---------------------------------------------------------------------------

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AWS_DIR="$REPO_ROOT/infra/terraform/aws"
EXPECTED_CLUSTER="cloudport-capstone-eks"

echo ""
echo "=================================================================="
echo "  CloudPort Capstone — AWS EKS Cleanup"
echo "=================================================================="
echo ""
echo "  This will destroy the following resources:"
echo "    - EKS cluster: ${EXPECTED_CLUSTER}"
echo "    - Managed node group"
echo "    - VPC, subnets, NAT gateway, internet gateway"
echo "    - IAM roles (EKS cluster and node group)"
echo "    - Security groups"
echo ""
echo "  This will NOT destroy:"
echo "    - kind-korifi environment"
echo "    - Korifi installation"
echo "    - GCP/GKE resources"
echo "    - CloudPort local environment"
echo "    - Supabase PostgreSQL"
echo "    - Any unrelated AWS resources"
echo ""
echo "  Terraform state: $AWS_DIR/terraform.tfstate"
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

cd "$AWS_DIR"
echo ""
echo "Running terraform destroy..."
terraform destroy -auto-approve

echo ""
echo "AWS EKS resources destroyed."
echo "Verify with: aws eks list-clusters --region ap-south-1"
