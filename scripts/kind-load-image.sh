#!/usr/bin/env bash
# Loads the locally built cloudport:1.0.0 image into a Kind cluster named
# "korifi" (context kind-korifi), so pods can use imagePullPolicy: IfNotPresent
# without needing a registry.
set -euo pipefail
CLUSTER_NAME="${1:-korifi}"

command -v kind >/dev/null 2>&1 || { echo "kind is not on PATH." >&2; exit 1; }
docker image inspect cloudport:1.0.0 >/dev/null 2>&1 || { echo "cloudport:1.0.0 image not found locally. Run scripts/build-image.sh first." >&2; exit 1; }

kind load docker-image cloudport:1.0.0 --name "$CLUSTER_NAME"
echo "Loaded cloudport:1.0.0 into Kind cluster '$CLUSTER_NAME'."
