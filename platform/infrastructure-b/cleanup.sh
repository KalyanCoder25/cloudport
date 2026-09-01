#!/usr/bin/env bash
#
# CloudPort Infrastructure B cleanup script.
#
# Deletes ONLY the fixed Infrastructure B resource set:
#   pvc/cloudport-storage-b, deployment/cloudport-app-b,
#   service/cloudport-service-b, storageclass/standard-throttled
#
# NEVER deletes: the 'cloudport' namespace (shared with Infrastructure A),
# Infrastructure A's own resources, the default/standard StorageClass, or any
# Korifi/cf/kpack/cert-manager/kube-system/default/kube-public/
# kube-node-lease/korifi-gateway resource.
#
# Before deleting anything, this script verifies the target resource exists
# and matches the expected kind+name+namespace exactly.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
NAMESPACE="cloudport"
EXPECTED_CONTEXT="kind-korifi"

fail() {
  echo "CLEANUP SAFETY CHECK FAILED: $1" >&2
  echo "STOPPING. No resources were deleted." >&2
  exit 1
}

command -v kubectl >/dev/null 2>&1 || fail "kubectl is not available on PATH."

CURRENT_CONTEXT="$(kubectl config current-context 2>/dev/null)" || fail "No current kubectl context is set."
[ "$CURRENT_CONTEXT" = "$EXPECTED_CONTEXT" ] || fail "Current context is '$CURRENT_CONTEXT', expected '$EXPECTED_CONTEXT'. Refusing to run cleanup against an unexpected cluster."

PROTECTED_NAMES=("kube-system" "kube-public" "kube-node-lease" "default" "cf" "korifi" "korifi-gateway" "kpack" "cert-manager" "cloudport-app-a" "cloudport-storage-a" "cloudport-service-a" "standard" "local-path")

is_protected() {
  local name="$1"
  for p in "${PROTECTED_NAMES[@]}"; do
    if [ "$name" = "$p" ]; then
      return 0
    fi
  done
  return 1
}

delete_if_safe() {
  local kind="$1" name="$2" ns_flag="$3"
  if is_protected "$name"; then
    fail "Refusing to delete $kind/$name -- it is on the protected resource list."
  fi
  if ! kubectl $ns_flag get "$kind" "$name" >/dev/null 2>&1; then
    echo "SKIP: $kind/$name does not exist (already clean)."
    return 0
  fi
  # Verify the resource actually belongs to Infrastructure B via its label
  # before deleting anything, as required by the spec.
  local label
  label="$(kubectl $ns_flag get "$kind" "$name" -o jsonpath='{.metadata.labels.cloudport\.io/infrastructure}' 2>/dev/null || echo '')"
  if [ "$label" != "variant-b" ]; then
    fail "$kind/$name is not labeled cloudport.io/infrastructure=variant-b (found: '$label'). Refusing to delete an unverified resource."
  fi
  echo "Deleting $kind/$name (verified Infrastructure B resource)..."
  kubectl $ns_flag delete "$kind" "$name" --wait=true
}

echo "== CloudPort Infrastructure B cleanup =="
delete_if_safe deployment cloudport-app-b "-n $NAMESPACE"
delete_if_safe service cloudport-service-b "-n $NAMESPACE"
delete_if_safe pvc cloudport-storage-b "-n $NAMESPACE"
delete_if_safe storageclass standard-throttled ""

echo ""
echo "Infrastructure B cleanup complete. Infrastructure A, the shared 'cloudport'"
echo "namespace, and all protected/Korifi resources were left untouched."
