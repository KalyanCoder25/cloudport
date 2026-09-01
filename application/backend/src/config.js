/**
 * Backend Configuration Accessor
 *
 * Centralizes environment-driven configuration so infrastructure-specific
 * details (like which filesystem path the workload should operate against)
 * enter the system exactly once, through configuration -- never as
 * hard-coded logic inside the workload engine or as an if/else on
 * infrastructure identity anywhere in the codebase.
 *
 * CLOUDPORT_STORAGE_MOUNT is the directory the deterministic STORAGE
 * workload actually performs its read/write operations against. In
 * Kubernetes, both Infrastructure A and Infrastructure B mount their
 * respective PersistentVolumeClaim at the same in-container path (/data,
 * see platform/infrastructure-a/02-deployment.yaml and
 * platform/infrastructure-b/03-deployment.yaml) and both set
 * CLOUDPORT_STORAGE_MOUNT=/data. The workload engine itself has no idea
 * which infrastructure /data resolves to -- that's the whole point: the
 * *application* is identical, only the underlying storage substrate behind
 * that mount point differs between A and B.
 *
 * If CLOUDPORT_STORAGE_MOUNT is not set (e.g. running the backend directly
 * on a developer workstation with no PVC mounted anywhere), this returns
 * null and callers fall back to workload.js's own OS-temp-directory default.
 * That fallback is a local-development convenience only -- it must never be
 * relied upon for an actual A/B storage-isolation experiment, since a
 * container's ephemeral temp filesystem is not the PVC under test at all.
 */
'use strict';

function getStorageMountPath() {
  const configured = process.env.CLOUDPORT_STORAGE_MOUNT;
  if (typeof configured === 'string' && configured.trim().length > 0) {
    return configured.trim();
  }
  return null;
}

module.exports = { getStorageMountPath };
