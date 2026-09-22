import React from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../api/useAsync';
import { api, Experiment } from '../api/client';
import { AsyncPanel } from '../components/AsyncPanel';
import { useAuth } from '../context/AuthContext';

// Workflow phases — same data, spatial presentation
const WORKFLOW_PHASES = [
  { step: '1', title: 'Target Application', desc: 'Select or register service', link: '/applications' },
  { step: '2', title: 'Parity Validation', desc: 'Verify invariant checksums', link: '/experiments' },
  { step: '3', title: 'Execute Trials', desc: 'Run deterministic workloads', link: '/telemetry' },
  { step: '4', title: 'Leakage Analysis', desc: 'Quantify infrastructure coupling', link: '/leakage' },
  { step: '5', title: 'Evidence Graph', desc: 'Inspect provenance artifacts', link: '/evidence' },
];

function statusClass(status: string) {
  if (status === 'COMPLETED') return 'badge-good';
  if (status === 'FAILED_VALIDATION' || status === 'ABORTED') return 'badge-bad';
  return 'badge-observed';
}

export default function Dashboard() {
  const { user, activeApp } = useAuth();

  const experiments = useAsync(
    () =>
      api.listExperiments(
        activeApp ? { application_id: activeApp.id } : undefined
      ),
    [activeApp?.id]
  );

  return (
    <>
      {/* Page Header Row */}
      <div className="dashboard-header">
        <div>
          <PageHeader
            title={`Welcome, ${user?.displayName || 'Operator'}`}
            subtitle="CloudPort Infrastructure-Aware Application Portability Platform"
          />
        </div>
        <div className="dashboard-actions">
          <Link
            to={activeApp ? `/deploy?application_id=${activeApp.id}` : '/deploy'}
            className="btn btn-primary btn-sm"
          >
            + Deploy
          </Link>
          <Link to="/applications" className="btn btn-secondary btn-sm">
            Applications
          </Link>
          <Link
            to={activeApp ? `/experiments?create=true&application_id=${activeApp.id}` : '/experiments?create=true'}
            className="btn btn-outline btn-sm"
          >
            + Experiment
          </Link>
        </div>
      </div>

      {/* Active Application Context Banner */}
      <div className="panel context-banner">
        <div className="context-banner-inner">
          <div>
            <div className="context-label">Current Target Application</div>
            <div className="context-title-group">
              <span className="context-title">
                {activeApp ? activeApp.name : 'No Application Selected'}
              </span>
              {activeApp && (
                <span className="badge badge-tech">
                  {activeApp.technology || activeApp.framework || 'CUSTOM'}
                </span>
              )}
            </div>
            <div className="context-desc">
              {activeApp?.description || 'Select or create an application to isolate and observe portability.'}
            </div>
          </div>
          <div>
            <Link to="/applications" className="btn btn-outline btn-sm">
              Switch Application →
            </Link>
          </div>
        </div>
      </div>

      {/* Research Workflow Phases */}
      <div className="workflow-grid">
        {WORKFLOW_PHASES.map((item) => (
          <Link key={item.step} to={item.link} className="workflow-card">
            <div className="workflow-step">Phase {item.step}</div>
            <div className="workflow-title">{item.title}</div>
            <div className="workflow-desc">{item.desc}</div>
          </Link>
        ))}
      </div>

      {/* Scientific rigor callout */}
      <div className="callout">
        <strong>Scientific Rigor Guarantee:</strong> CloudPort never fabricates measurements or
        metrics. If no trials have executed, panels display authentic empty states until real
        evidence is captured.
      </div>

      {/* Experiments Panel */}
      <div className="panel">
        <div className="panel-header">
          <div className="panel-title panel-title-no-border">
            {activeApp ? `${activeApp.name} — Experiments` : 'All Experiments'}
          </div>
          <Link to="/experiments" className="btn btn-secondary btn-sm">
            Experiments Console →
          </Link>
        </div>

        <AsyncPanel
          loading={experiments.loading}
          error={experiments.error}
          data={experiments.data}
          empty={
            <div className="empty-state-centered">
              <p className="empty-state-text">
                No experiments yet.
                <br />
                Create an experiment to begin testing application portability.
              </p>
              <Link to="/experiments" className="btn btn-primary btn-sm">
                Create First Experiment
              </Link>
            </div>
          }
          render={(data: Experiment[]) => (
            <table>
              <thead>
                <tr>
                  <th>Experiment</th>
                  <th>Status</th>
                  <th>Dimension</th>
                  <th>Trials</th>
                  <th>Analysis</th>
                </tr>
              </thead>
              <tbody>
                {data.map((exp: Experiment) => (
                  <tr key={exp.id}>
                    <td>
                      <Link to={`/experiments?id=${exp.id}`} style={{ fontWeight: 500, color: 'var(--text-primary)' }}>
                        {exp.name}
                      </Link>
                    </td>
                    <td>
                      <span className={`badge ${statusClass(exp.status)}`}>
                        <span className="badge-dot" /> {exp.status}
                      </span>
                    </td>
                    <td style={{ color: 'var(--text-secondary)' }}>{exp.target_dimension}</td>
                    <td className="mono" style={{ fontSize: 11 }}>
                      {exp.replication_count} paired
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 10, fontSize: 11 }}>
                        <Link to={`/comparison?id=${exp.id}`}>Comparison</Link>
                        <Link to={`/leakage?id=${exp.id}`}>Leakage</Link>
                        <Link to={`/reports?id=${exp.id}`}>Report</Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />
      </div>

      {/* Infrastructure Reference */}
      <div className="grid-two">
        <div className="panel">
          <div className="panel-title">Infrastructure A — Baseline</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 14px 0', lineHeight: 1.6 }}>
            Baseline environment running cluster-default hostpath storage on Kind.
            Protected baseline — never modified during fault or variant testing.
          </p>
          <Link to="/infrastructure-a" className="btn btn-outline btn-sm">
            View Infrastructure A →
          </Link>
        </div>
        <div className="panel">
          <div className="panel-title">Infrastructure B — Variant Substrate</div>
          <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 14px 0', lineHeight: 1.6 }}>
            Storage substrate and throttling variant (<code>standard-throttled</code>) running
            in dedicated CloudPort namespace.
          </p>
          <Link to="/infrastructure-b" className="btn btn-outline btn-sm">
            View Infrastructure B →
          </Link>
        </div>
      </div>
    </>
  );
}
