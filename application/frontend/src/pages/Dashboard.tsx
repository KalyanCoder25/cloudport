import React from 'react';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../api/useAsync';
import { api } from '../api/client';
import { AsyncPanel } from '../components/AsyncPanel';
import { Link } from 'react-router-dom';

export default function Dashboard() {
  const experiments = useAsync(() => api.listExperiments(), []);

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Infrastructure-aware application portability & controlled A/B experimentation."
      />

      <div className="callout">
        CloudPort never fabricates measurements. Every number on this dashboard is read from persisted
        evidence produced by an actual trial run -- panels are empty, not guessed, until an experiment executes.
      </div>

      <div className="panel">
        <div className="panel-title">Experiments</div>
        <AsyncPanel
          loading={experiments.loading}
          error={experiments.error}
          data={experiments.data}
          empty="No experiments recorded yet. Run `npm run db:seed` and create one via the API."
          render={(data) => (
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Status</th>
                  <th>Target Dimension</th>
                  <th>Replication</th>
                </tr>
              </thead>
              <tbody>
                {data.map((exp) => (
                  <tr key={exp.id}>
                    <td>
                      <Link to="/experiments">{exp.name}</Link>
                    </td>
                    <td>{exp.status}</td>
                    <td>{exp.target_dimension}</td>
                    <td>{exp.replication_count} paired trials</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />
      </div>

      <div className="grid-two">
        <div className="panel">
          <div className="panel-title">Infrastructure A</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            Baseline. Cluster-default StorageClass. Protected -- never modified by Infrastructure B tooling.
          </p>
          <Link to="/infrastructure-a">View details &rarr;</Link>
        </div>
        <div className="panel">
          <div className="panel-title">Infrastructure B</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13 }}>
            Storage substrate / path allocation variant (<code>standard-throttled</code>). Not IOPS throttling.
          </p>
          <Link to="/infrastructure-b">View details &rarr;</Link>
        </div>
      </div>
    </>
  );
}
