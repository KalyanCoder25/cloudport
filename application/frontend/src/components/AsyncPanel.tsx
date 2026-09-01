import React from 'react';

export function AsyncPanel<T>({
  loading,
  error,
  data,
  empty,
  render,
}: {
  loading: boolean;
  error: string | null;
  data: T | null;
  empty?: string;
  render: (data: T) => React.ReactNode;
}) {
  if (loading) return <div className="empty-state">Loading...</div>;
  if (error) {
    return (
      <div className="empty-state">
        Could not reach the CloudPort API ({error}). Start the backend (see README) to populate this view.
      </div>
    );
  }
  if (data === null || (Array.isArray(data) && data.length === 0)) {
    return <div className="empty-state">{empty || 'No data recorded yet.'}</div>;
  }
  return <>{render(data)}</>;
}
