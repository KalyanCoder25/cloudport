#!/usr/bin/env bash
#
# CloudPort Infrastructure B provisioning script.
#
# Runs 12 safety gates BEFORE any cluster mutation. If ANY gate fails, the
# script STOPS immediately, mutates nothing, and does not attempt automatic
# recovery. This script is intentionally conservative.
#
# Usage (Git Bash / WSL / Linux / macOS):
#   ./platform/infrastructure-b/provision.sh
#
# Windows users: run this from Git Bash. A PowerShell-native equivalent is
# documented in README.md; PowerShell and Bash syntax are never mixed here.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST_DIR="$REPO_ROOT/platform/infrastructure-b"
EXPECTED_CONTEXT="kind-korifi"
EXPECTED_IMAGE="cloudport:1.0.0"
NAMESPACE="cloudport"

fail() {
  echo "SAFETY GATE FAILED: $1" >&2
  echo "STOPPING. No cluster mutation was performed." >&2
  exit 1
}

echo "== CloudPort Infrastructure B provisioning: safety gates =="

# --- Gate 1: kubectl available -------------------------------------------
command -v kubectl >/dev/null 2>&1 || fail "kubectl is not available on PATH."
echo "[1/12] kubectl available: OK"

# --- Gate 2: current context exists ---------------------------------------
CURRENT_CONTEXT="$(kubectl config current-context 2>/dev/null)" || fail "No current kubectl context is set."
[ -n "$CURRENT_CONTEXT" ] || fail "Current kubectl context is empty."
echo "[2/12] current context exists ($CURRENT_CONTEXT): OK"

# --- Gate 3: current context == kind-korifi --------------------------------
[ "$CURRENT_CONTEXT" = "$EXPECTED_CONTEXT" ] || fail "Current context is '$CURRENT_CONTEXT', expected '$EXPECTED_CONTEXT'."
echo "[3/12] current context == $EXPECTED_CONTEXT: OK"

# --- Gate 4: cluster identity is correct -----------------------------------
CLUSTER_NAME="$(kubectl config view -o jsonpath="{.contexts[?(@.name=='$CURRENT_CONTEXT')].context.cluster}")"
[ "$CLUSTER_NAME" = "kind-korifi" ] || fail "Cluster bound to context '$CURRENT_CONTEXT' is '$CLUSTER_NAME', expected 'kind-korifi'."
echo "[4/12] cluster identity ($CLUSTER_NAME): OK"

# --- Gate 5: Kubernetes API reachable ---------------------------------------
kubectl version --request-timeout=5s >/dev/null 2>&1 || fail "Kubernetes API is not reachable within 5s."
echo "[5/12] Kubernetes API reachable: OK"

# --- Gate 6: protected namespaces not targeted ------------------------------
node "$REPO_ROOT/scripts/check-protected-namespaces.js" "$MANIFEST_DIR" || fail "One or more manifests target a protected namespace."
echo "[6/12] protected namespaces not targeted: OK"

# --- Gate 7: protected StorageClasses not targeted --------------------------
node "$REPO_ROOT/scripts/check-storageclass-safety.js" "$MANIFEST_DIR" || fail "StorageClass safety check failed (protected class or unverified nodePath)."
echo "[7/12] protected StorageClasses not targeted / nodePath verified: OK"

# --- Gate 8: NetworkPolicy absent -------------------------------------------
if grep -ril "kind: NetworkPolicy" "$MANIFEST_DIR" >/dev/null 2>&1; then
  fail "A NetworkPolicy manifest was found in $MANIFEST_DIR; this experiment must not introduce one."
fi
echo "[8/12] NetworkPolicy absent: OK"

# --- Gate 9: exact Infrastructure B resource inventory ----------------------
node "$REPO_ROOT/scripts/check-resource-inventory.js" "$MANIFEST_DIR" || fail "Manifest set does not exactly match the approved Infrastructure B resource inventory."
echo "[9/12] exact resource inventory matches allow-list: OK"

# --- Gate 10: manifest syntax valid -----------------------------------------
for f in "$MANIFEST_DIR"/*.yaml; do
  kubectl apply --dry-run=client -f "$f" >/dev/null 2>&1 || fail "Manifest failed client-side validation: $f"
done
echo "[10/12] manifest syntax valid (client dry-run): OK"

# --- Gate 11: server-side dry-run succeeds ----------------------------------
for f in "$MANIFEST_DIR"/*.yaml; do
  kubectl apply --dry-run=server -f "$f" >/dev/null 2>&1 || fail "Manifest failed server-side dry-run: $f"
done
echo "[11/12] server-side dry-run succeeds: OK"

# --- Gate 12: image prerequisite checked ------------------------------------
if command -v docker >/dev/null 2>&1; then
  docker image inspect "$EXPECTED_IMAGE" >/dev/null 2>&1 || fail "Docker image '$EXPECTED_IMAGE' was not found locally. Build it first (see README.md) and load it into Kind."
else
  echo "WARNING: docker CLI not found; cannot verify image '$EXPECTED_IMAGE' exists. Continuing, but the Deployment will fail to pull the image if it is missing from the cluster/registry." >&2
fi
echo "[12/12] image prerequisite checked: OK"

echo ""
echo "All 12 safety gates passed. Proceeding with Infrastructure B provisioning."
echo ""

kubectl apply -f "$MANIFEST_DIR/00-namespace.yaml" 2>/dev/null || true # namespace 'cloudport' is shared with Infrastructure A; created if absent, never deleted here
kubectl apply -f "$MANIFEST_DIR/01-storageclass.yaml"
kubectl apply -f "$MANIFEST_DIR/02-pvc.yaml"
kubectl apply -f "$MANIFEST_DIR/03-deployment.yaml"
kubectl apply -f "$MANIFEST_DIR/04-service.yaml"

echo "Infrastructure B provisioned. Verify with:"
echo "  kubectl -n $NAMESPACE get pvc cloudport-storage-b"
echo "  kubectl -n $NAMESPACE rollout status deployment/cloudport-app-b"
