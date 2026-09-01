#!/usr/bin/env bash
# Builds the cloudport:1.0.0 image from the repository root Dockerfile.
set -euo pipefail
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
docker build -t cloudport:1.0.0 "$REPO_ROOT"
docker images cloudport:1.0.0
