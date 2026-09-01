import React from 'react';
import { PageHeader } from '../components/PageHeader';
import { useAsync } from '../api/useAsync';
import { api } from '../api/client';
import { AsyncPanel } from '../components/AsyncPanel';
import { useDefaultExperimentId } from '../api/useDefaultExperimentId';

export default function Reports() {
  const { id } = useDefaultExperimentId();
  const report = useAsync(() => (id ? api.getReport(id) : Promise.reject(new Error('no experiment'))), [id]);

  return (
    <>
      <PageHeader title="Reports" subtitle="Structured scientific report, generated from persisted evidence only." />
      <div className="panel">
        <AsyncPanel
          loading={report.loading}
          error={report.error}
          data={report.data}
          render={(markdown) => (
            <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'var(--font-mono)', fontSize: 12.5, color: 'var(--text-primary)' }}>
              {markdown}
            </pre>
          )}
        />
      </div>
    </>
  );
}
