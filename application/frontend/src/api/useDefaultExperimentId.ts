import { useAsync } from '../api/useAsync';
import { api } from '../api/client';

/**
 * Most CloudPort analyzer views are scoped to a single experiment. For a
 * simple, useful default, this hook resolves to the most recently created
 * experiment. A production build would let the user pick from /experiments;
 * this keeps every analyzer page immediately useful without extra clicks.
 */
export function useDefaultExperimentId() {
  const experiments = useAsync(() => api.listExperiments(), []);
  const id = experiments.data && experiments.data.length > 0 ? experiments.data[0].id : null;
  return { id, loading: experiments.loading, error: experiments.error };
}
