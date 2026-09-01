import React from 'react';
import { PageHeader } from '../components/PageHeader';
import { EvidenceBadge } from '../components/EvidenceBadge';

export default function InfrastructureA() {
  return (
    <>
      <PageHeader title="Infrastructure A" subtitle="Baseline. Protected once deployed." />
      <div className="panel">
        <div className="panel-title">Resources</div>
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
              <td>PersistentVolumeClaim</td>
              <td className="mono">cloudport-storage-a</td>
              <td className="mono">cloudport</td>
            </tr>
            <tr>
              <td>Deployment</td>
              <td className="mono">cloudport-app-a</td>
              <td className="mono">cloudport</td>
            </tr>
            <tr>
              <td>Service</td>
              <td className="mono">cloudport-service-a</td>
              <td className="mono">cloudport</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="panel">
        <div className="panel-title">Live verification status</div>
        <EvidenceBadge kind="insufficient" label="NOT VERIFIED — REQUIRES HOST ENVIRONMENT" />
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, marginTop: 12 }}>
          This dashboard reads infrastructure snapshots from persisted evidence only. Connect a real Kind/Korifi
          cluster and run an experiment to populate live values here.
        </p>
      </div>
    </>
  );
}
