'use strict';

const { Pool } = require('pg');
const crypto = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
  const expId = '87126869-e8f8-4bd8-9c39-aedbfdb2ec27';

  // 1. Mark status as ABORTED
  const updateRes = await pool.query(
    'UPDATE experiments SET status = $1, updated_at = now() WHERE id = $2 RETURNING id, name, status',
    ['ABORTED', expId]
  );
  console.log('Updated experiment:', updateRes.rows[0]);

  // 2. Insert AUDIT_INVALIDATION artifact
  const invalidationArtifact = {
    invalidationTimestamp: new Date().toISOString(),
    experimentId: expId,
    experimentName: 'live-korifi-storage-v1',
    previousStatus: 'COMPLETED',
    newStatus: 'ABORTED',
    findings: [
      'Workloads were executed inside the local Windows backend process instead of the Kubernetes pods (k8sClient.executeWorkloadOnPod was never called by experimentRunner.js).',
      'Storage throttling was not enforced: rancher.io/local-path provisioner does not implement IOPS/bandwidth throttling, so standard and standard-throttled were functionally identical.',
      'Trial count was miscounted: 2 paired trials were misreported as 4 paired trials.',
      'No statistical tests (p-values or confidence intervals) were performed to confirm observed differences.',
      'A single OS jitter spike drove 65/90 points of the reported leakage score.',
    ],
    resolution:
      'Experiment invalidated and aborted. Replaced by cpu-resource-isolation-v1 with genuine Kubernetes pod-exec dispatch, cgroup CPU limit enforcement, and 5 paired trials with paired t-tests.',
  };

  const contentStr = JSON.stringify(invalidationArtifact);
  const checksum = crypto.createHash('sha256').update(contentStr).digest('hex');

  const artRes = await pool.query(
    'INSERT INTO evidence_artifacts (experiment_id, artifact_type, file_name, content, checksum) VALUES ($1, $2, $3, $4, $5) RETURNING id, artifact_type, file_name',
    [expId, 'AUDIT_INVALIDATION', 'audit-invalidation.json', contentStr, checksum]
  );

  console.log('Inserted artifact:', artRes.rows[0]);
  await pool.end();
}

main().catch((err) => {
  console.error('Error invalidating experiment:', err);
  pool.end();
  process.exit(1);
});
