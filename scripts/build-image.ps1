# Builds the cloudport:1.0.0 image from the repository root Dockerfile.
# Run from PowerShell: .\scripts\build-image.ps1
$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
docker build -t cloudport:1.0.0 $RepoRoot
docker images cloudport:1.0.0
