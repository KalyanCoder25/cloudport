import React from 'react';
import { PageHeader } from '../components/PageHeader';
import { EvidenceBadge } from '../components/EvidenceBadge';

export default function InfrastructureB() {
  return (
    <>
      <PageHeader title="Infrastructure B" subtitle="Storage substrate / path allocation variant." />
      <div className="callout">
        Terminology note: this is a storage substrate/path allocation difference, not IOPS throttling, bandwidth
        throttling, or kernel-level block-device throttling. No such mechanism is implemented in CloudPort.
      </div>
      <div className="panel">
        <div className="panel-title">Resources (exact allow-list)</div>
        <table>
          <thead>
            <tr>
              <th>Kind</th>
              <th>Name</th>
              <th>Namespace</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Namespace</td>
              <td className="mono">cloudport</td>
              <td>&mdash;</td>
            </tr>
            <tr>
              <td>StorageClass</td>
              <td className="mono">standard-throttled</td>
              <td>&mdash;</td>
            </tr>
            <tr>
              <td>PersistentVolumeClaim</td>
              <td className="mono">cloudport-storage-b</td>
              <td className="mono">cloudport</td>
            </tr>
            <tr>
              <td>Deployment</td>
              <td className="mono">cloudport-app-b</td>
              <td className="mono">cloudport</td>
            </tr>
            <tr>
              <td>Service</td>
              <td className="mono">cloudport-service-b</td>
              <td className="mono">cloudport</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="panel">
        <div className="panel-title">Provisioning safety gates</div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
          12 checks run before any cluster mutation (context, cluster identity, protected namespaces/StorageClasses,
          NetworkPolicy absence, exact resource inventory, manifest + server-side dry-run, image prerequisite). See{' '}
          <code>platform/infrastructure-b/provision.sh</code>.
        </p>
        <EvidenceBadge kind="insufficient" label="NOT VERIFIED — REQUIRES HOST ENVIRONMENT" />
      </div>
    </>
  );
}
