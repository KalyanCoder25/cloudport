#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# infra/terraform/validate-all.sh
#
# Safe validation workflow for the CloudPort capstone Terraform configuration.
# Runs: fmt -check, validate, plan (dry-run) for BOTH aws/ and gcp/ roots.
#
# This script NEVER runs terraform apply.
# Explicit operator approval is required before any cloud resource creation.
#
# Usage (Git Bash / WSL / Linux / macOS):
#   bash infra/terraform/validate-all.sh
#
# Prerequisites:
#   - terraform >= 1.6.0 on PATH
#   - AWS credentials configured (AWS_PROFILE or IAM Identity Center)
#   - GCP credentials configured (gcloud auth application-default login)
#   - terraform.tfvars present in aws/ and gcp/ (copy from .example)
# ---------------------------------------------------------------------------

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AWS_DIR="$REPO_ROOT/infra/terraform/aws"
GCP_DIR="$REPO_ROOT/infra/terraform/gcp"

fail() {
  echo ""
  echo "VALIDATION FAILED: $1" >&2
  echo "No cloud resources were created or modified." >&2
  exit 1
}

ok() {
  echo "  [OK] $1"
}

separator() {
  echo ""
  echo "=================================================================="
  echo "  $1"
  echo "=================================================================="
}

echo ""
echo "CloudPort Capstone — Terraform Validation (no apply)"
echo "Timestamp: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# ---------------------------------------------------------------------------
# AWS / EKS
# ---------------------------------------------------------------------------

separator "AWS EKS — infra/terraform/aws"

cd "$AWS_DIR"

[ -f "terraform.tfvars" ] || fail "terraform.tfvars not found in $AWS_DIR. Copy terraform.tfvars.example and fill in values."

echo "  [1/4] terraform init (no-backend)"
terraform init -backend=false -input=false -no-color > /dev/null 2>&1 || fail "terraform init failed for AWS root"
ok "terraform init"

echo "  [2/4] terraform fmt -check"
terraform fmt -check -recursive -no-color || fail "terraform fmt check failed for AWS root. Run: terraform fmt -recursive"
ok "terraform fmt -check"

echo "  [3/4] terraform validate"
terraform validate -no-color || fail "terraform validate failed for AWS root"
ok "terraform validate"

echo "  [4/4] terraform plan (review output carefully — do NOT apply without approval)"
terraform plan -detailed-exitcode -no-color -out=/dev/null 2>&1 || {
  exit_code=$?
  if [ $exit_code -eq 2 ]; then
    ok "terraform plan: changes detected (review above — this is expected for first apply)"
  else
    fail "terraform plan failed for AWS root (exit code $exit_code)"
  fi
}

# ---------------------------------------------------------------------------
# GCP / GKE
# ---------------------------------------------------------------------------

separator "GCP GKE — infra/terraform/gcp"

cd "$GCP_DIR"

[ -f "terraform.tfvars" ] || fail "terraform.tfvars not found in $GCP_DIR. Copy terraform.tfvars.example and fill in values."

echo "  [1/4] terraform init (no-backend)"
terraform init -backend=false -input=false -no-color > /dev/null 2>&1 || fail "terraform init failed for GCP root"
ok "terraform init"

echo "  [2/4] terraform fmt -check"
terraform fmt -check -recursive -no-color || fail "terraform fmt check failed for GCP root. Run: terraform fmt -recursive"
ok "terraform fmt -check"

echo "  [3/4] terraform validate"
terraform validate -no-color || fail "terraform validate failed for GCP root"
ok "terraform validate"

echo "  [4/4] terraform plan (review output carefully — do NOT apply without approval)"
terraform plan -detailed-exitcode -no-color -out=/dev/null 2>&1 || {
  exit_code=$?
  if [ $exit_code -eq 2 ]; then
    ok "terraform plan: changes detected (review above — this is expected for first apply)"
  else
    fail "terraform plan failed for GCP root (exit code $exit_code)"
  fi
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------

separator "Validation Complete"
echo ""
echo "  Both AWS (EKS) and GCP (GKE) Terraform configurations are valid."
echo ""
echo "  NEXT STEPS (require explicit operator approval):"
echo "    AWS:  cd infra/terraform/aws && terraform apply"
echo "    GCP:  cd infra/terraform/gcp && terraform apply"
echo ""
echo "  CLEANUP (after experiments):"
echo "    bash infra/terraform/destroy-aws.sh"
echo "    bash infra/terraform/destroy-gcp.sh"
echo ""
echo "  NO CLOUD RESOURCES WERE CREATED OR MODIFIED."
