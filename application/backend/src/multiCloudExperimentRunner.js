/**
 * Multi-Cloud Experiment Runner
 *
 * Orchestrates the execution of multicloud-portability-v1 experiments.
 * This runner is SEPARATE from experimentRunner.js (which handles the
 * kind-korifi storage/CPU isolation experiments). They share the same
 * analysis modules but have completely different execution paths.
 *
 * EXECUTION MODEL:
 *   1. Load experiment definition (experiments/multicloud-portability-v1.json)
 *   2. Validate Kubernetes contexts (aws-eks-cloudport, gcp-gke-cloudport)
 *   3. Capture infrastructure snapshots from both clusters (live)
 *   4. Deploy Locust load generator to each cluster (sequentially, not simultaneously)
 *   5. Execute paired trials: same load profile against AWS, then GCP
 *   6. Collect Locust results (CSV + provenance JSON) from each trial
 *   7. Run statistical analysis using existing statisticalTests.js
 *   8. Compute leakage score using existing leakageScore.js
 *   9. Generate evidence artifacts using existing evidence pipeline
 *
 * SAFETY CONTRACTS:
 *   - NEVER uses kind-korifi context (rejected at module level)
 *   - NEVER accepts localhost or empty context
 *   - NEVER fabricates measurements
 *   - NEVER runs on local host filesystem
 *   - ALWAYS includes full provenance on every measurement
 *   - Reports INSUFFICIENT_SAMPLE when n < 5 (from statisticalTests.js)
 *   - Does not auto-apply terraform or auto-deploy benchmark application
 *
 * PREREQUISITE STATE (this runner checks, does not set up):
 *   - AWS EKS cluster running + aws-eks-cloudport context configured
 *   - GCP GKE cluster running + gcp-gke-cloudport context configured
 *   - Online Boutique deployed on both clusters (kubectl apply -k platform/multicloud/benchmark/)
 *   - Locust namespace exists on both clusters
 */
'use strict';

const { createMultiCloudInspector, notVerifiedMultiCloudProfile } = require('../../../analyzer/infrastructure/multiCloudInspector');
const { AUTHORIZED_MULTICLOUD_CONTEXTS } = require('../../../analyzer/infrastructure/multiCloudK8sClient');
const { detectDifferences } = require('../../../analyzer/infrastructure/differenceDetector');
const { computeLeakageScore } = require('../../../analyzer/leakage/leakageScore');
const { classifyCausalGovernance } = require('../../../analyzer/evidence/causalGovernance');
const { buildEvidenceGraph } = require('../../../analyzer/evidence/evidenceGraph');
const { pairedTTest: pairedTTestScipy } = require('../../../analyzer/telemetry/scipyStatsClient');
const { analyzeRepeatedTrials } = require('../../../analyzer/behaviour/repeatedTrials');
const { detectApplicationVisibleDifferences } = require('../../../analyzer/behaviour/applicationVisibleDetector');

// Valid measurement source for multi-cloud experiments
const MULTICLOUD_MEASUREMENT_SOURCE = 'locust-kubernetes';
const MULTICLOUD_EXECUTION_MODE = 'MULTICLOUD_KUBERNETES';

// Authorized cloud providers matched to contexts (canonical names + documented aliases)
const CONTEXT_TO_PROVIDER = {
  'aws-eks-cloudport': 'AWS',
  'gcp-gke-cloudport': 'GCP',
  'aws-eks-cluster': 'AWS',
  'gcp-gke-cluster': 'GCP',
};

class MultiCloudExperimentRunner {
  /**
   * @param {object} deps
   * @param {(sql: string, params?: any[]) => Promise<{rows: any[], rowCount: number}>} deps.query
   * @param {object} [deps.inspectorA] - MultiCloudInspector for context A
   * @param {object} [deps.inspectorB] - MultiCloudInspector for context B
   * @param {object} [deps.experimentDef] - Experiment definition JSON (loaded externally)
   */
  constructor(deps = {}) {
    if (!deps.query) {
      throw new Error('MultiCloudExperimentRunner requires a database query function');
    }
    this.query = deps.query;

    // Experiment definition (loaded by the orchestrator)
    this.experimentDef = deps.experimentDef || null;

    // Infrastructure inspectors (lazy — not connected until captureProfile() is called)
    this.inspectorA = deps.inspectorA || null;
    this.inspectorB = deps.inspectorB || null;

    // Statistical engine: SciPy service when STATS_SERVICE_URL is configured
    // and reachable, transparently falling back to the pure-JS implementation
    // otherwise. Injectable so tests can pin a deterministic engine.
    this.pairedTTest = deps.pairedTTest || pairedTTestScipy;
  }

  /**
   * Validate that a context is authorized for multi-cloud experiments.
   * Rejects kind-korifi, localhost, and any other unauthorized context.
   *
   * @param {string} context
   * @throws {Error} if context is not authorized
   */
  validateCloudContext(context) {
    if (!context) {
      throw new Error('Cloud context must be specified. Cannot run multi-cloud experiment without a context.');
    }
    if (context === 'kind-korifi') {
      throw new Error(
        'Safety violation: kind-korifi is the local CloudPort context. ' +
          'Multi-cloud experiments must use aws-eks-cloudport or gcp-gke-cloudport. ' +
          'The local and cloud execution paths must never be mixed.'
      );
    }
    if (context === 'localhost' || context === '' || context.includes('local')) {
      throw new Error(
        `Safety violation: context "${context}" appears to be a local context. ` +
          'Multi-cloud experiments reject local execution. ' +
          'Measurements must originate from real cloud infrastructure.'
      );
    }
    if (!AUTHORIZED_MULTICLOUD_CONTEXTS.includes(context)) {
      throw new Error(
        `Safety violation: context "${context}" is not authorized for multi-cloud experiments. ` +
          `Authorized contexts: ${AUTHORIZED_MULTICLOUD_CONTEXTS.join(', ')}`
      );
    }
  }

  /**
   * Get the cloud provider for a given context.
   *
   * @param {string} context
   * @returns {'AWS'|'GCP'}
   */
  getProviderForContext(context) {
    const provider = CONTEXT_TO_PROVIDER[context];
    if (!provider) {
      throw new Error(`Cannot determine cloud provider for context "${context}".`);
    }
    return provider;
  }

  /**
   * Capture infrastructure snapshot safely.
   * Falls back to notVerifiedMultiCloudProfile if the cluster is not reachable.
   * Never fabricates data.
   *
   * @param {string} context - Kubernetes context name
   * @param {object} [inspector] - MultiCloudInspector instance (optional override)
   * @returns {Promise<object>} normalized profile
   */
  async captureProfile(context, inspector) {
    this.validateCloudContext(context);
    const activeInspector = inspector || createMultiCloudInspector({ context });
    try {
      return await activeInspector.captureSnapshot();
    } catch (err) {
      const provider = this.getProviderForContext(context);
      const profile = notVerifiedMultiCloudProfile(context, provider);
      profile.captureError = err.message;
      return profile;
    }
  }

  /**
   * Execute a paired multi-cloud experiment.
   *
   * @param {string} experimentId - Database experiment ID
   * @param {object} experimentDef - Loaded experiment definition JSON
   * @param {object} [options]
   * @param {string} [options.contextA] - Override context for Infrastructure A
   * @param {string} [options.contextB] - Override context for Infrastructure B
   * @returns {Promise<object>} experiment result
   */
  async runPairedExperiment(experimentId, experimentDef, options = {}) {
    const contextA = options.contextA || experimentDef.infrastructureA?.kubernetesContext;
    const contextB = options.contextB || experimentDef.infrastructureB?.kubernetesContext;

    // Validate both contexts before any network calls
    this.validateCloudContext(contextA);
    this.validateCloudContext(contextB);

    const providerA = this.getProviderForContext(contextA);
    const providerB = this.getProviderForContext(contextB);

    const experimentStartedAt = new Date().toISOString();

    // Step 1: Capture infrastructure snapshots
    const [profileA, profileB] = await Promise.all([
      this.captureProfile(contextA, this.inspectorA),
      this.captureProfile(contextB, this.inspectorB),
    ]);

    // Step 2: Detect infrastructure differences
    const infraDifferences = detectDifferences(profileA, profileB);

    // Step 3: Collect Locust trial results from database
    // (In a live experiment, these are loaded from the PostgreSQL
    //  multicloud_trial_results table after Locust runs complete.)
    const trialResults = await this._loadTrialResults(experimentId);

    if (trialResults.length === 0) {
      return this._buildIncompleteResult({
        experimentId,
        experimentDef,
        contextA,
        contextB,
        providerA,
        providerB,
        profileA,
        profileB,
        infraDifferences,
        reason: 'NO_TRIAL_RESULTS — run Locust trials first, then collect results',
        experimentStartedAt,
      });
    }

    // Step 4: Extract paired latency arrays for statistical analysis
    const trialsA = trialResults.filter((t) => t.cloud_provider === providerA);
    const trialsB = trialResults.filter((t) => t.cloud_provider === providerB);

    const latenciesA = trialsA.map((t) => t.latency_p95_ms).filter((v) => v != null);
    const latenciesB = trialsB.map((t) => t.latency_p95_ms).filter((v) => v != null);

    // Step 5: Statistical analysis. Prefers the SciPy service; falls back to
    // the pure-JS implementation (statisticalTests.js) if it's unreachable.
    const statisticalResult = await this.pairedTTest(latenciesA, latenciesB);

    // Step 6: Repeated trials analysis (reuses existing repeatedTrials.js)
    const replicationResult = analyzeRepeatedTrials(
      trialsA.map((t) => ({ p95: t.latency_p95_ms })),
      trialsB.map((t) => ({ p95: t.latency_p95_ms }))
    );

    // Step 7: Application-visible difference detection
    const appVisibleResult = detectApplicationVisibleDifferences(
      { p95: statisticalResult.meanDelta || 0, statResult: statisticalResult },
      infraDifferences
    );

    // Step 8: Leakage score (reuses existing leakageScore.js)
    // measurementSource MUST be 'locust-kubernetes' for a valid score
    const leakageResult = computeLeakageScore({
      infrastructureDifferenceDetected: infraDifferences.length > 0,
      applicationVisibleCorrelation: appVisibleResult.correlationDetected || false,
      largestMeaningfulPercentChange: appVisibleResult.largestPercentChange || 0,
      replicationClassification: replicationResult.classification || 'INSUFFICIENT_REPLICATION',
      measurementSource: MULTICLOUD_MEASUREMENT_SOURCE,
    });

    // Step 9: Causal governance (reuses existing causalGovernance.js)
    const causalResult = classifyCausalGovernance({
      infrastructureDifferences: infraDifferences,
      applicationVisibleCorrelation: appVisibleResult.correlationDetected || false,
      replicationClassification: replicationResult.classification || 'INSUFFICIENT_REPLICATION',
      statisticalSignificance: statisticalResult.significance || 'INSUFFICIENT_SAMPLE',
      leakageScore: leakageResult.score,
    });

    // Step 10: Evidence graph and artifacts (reuses existing evidence pipeline)
    const evidenceGraph = buildEvidenceGraph({
      experimentId,
      experimentDef,
      profileA,
      profileB,
      infraDifferences,
      statisticalResult,
      replicationResult,
      appVisibleResult,
      leakageResult,
      causalResult,
    });

    const experimentCompletedAt = new Date().toISOString();

    const result = {
      experimentId,
      executionMode: MULTICLOUD_EXECUTION_MODE,
      measurementSource: MULTICLOUD_MEASUREMENT_SOURCE,
      contextA,
      contextB,
      providerA,
      providerB,
      profileA,
      profileB,
      infraDifferences,
      trialsA: trialsA.length,
      trialsB: trialsB.length,
      statisticalResult,
      replicationResult,
      appVisibleResult,
      leakageResult,
      causalResult,
      evidenceGraph,
      experimentStartedAt,
      experimentCompletedAt,
      provenance: this._buildProvenance({
        experimentId,
        contextA,
        contextB,
        providerA,
        providerB,
        experimentDef,
        experimentStartedAt,
        experimentCompletedAt,
      }),
    };

    // Persist result to database
    await this._persistResult(result);

    return result;
  }

  /**
   * Build full provenance record for a multi-cloud experiment.
   * Includes all fields required by the capstone evidence spec.
   */
  _buildProvenance({ experimentId, contextA, contextB, providerA, providerB, experimentDef, experimentStartedAt, experimentCompletedAt }) {
    return {
      experimentId,
      experimentName: experimentDef?.name || 'multicloud-portability-v1',
      executionMode: MULTICLOUD_EXECUTION_MODE,
      measurementSource: MULTICLOUD_MEASUREMENT_SOURCE,
      infrastructureA: {
        cloudProvider: providerA,
        kubernetesContext: contextA,
        namespace: experimentDef?.benchmark?.namespace || 'online-boutique',
        clusterName: experimentDef?.infrastructureA?.clusterName || null,
        region: experimentDef?.infrastructureA?.region || null,
      },
      infrastructureB: {
        cloudProvider: providerB,
        kubernetesContext: contextB,
        namespace: experimentDef?.benchmark?.namespace || 'online-boutique',
        clusterName: experimentDef?.infrastructureB?.clusterName || null,
        region: experimentDef?.infrastructureB?.region || null,
      },
      benchmark: {
        application: experimentDef?.benchmark?.application || 'online-boutique',
        version: experimentDef?.benchmark?.version || 'v0.10.1',
        deploymentMethod: experimentDef?.benchmark?.deploymentMethod || 'kustomize',
      },
      loadProfile: {
        tool: experimentDef?.loadProfile?.tool || 'locust',
        locustfileVersion: experimentDef?.loadProfile?.locustfileVersion || 'multicloud-portability-v1',
        users: experimentDef?.loadProfile?.users || 50,
        spawnRate: experimentDef?.loadProfile?.spawnRate || 5,
        durationSeconds: experimentDef?.loadProfile?.durationSeconds || 300,
      },
      startTimestamp: experimentStartedAt,
      endTimestamp: experimentCompletedAt,
    };
  }

  /**
   * Build an incomplete result when trials are not yet available.
   * Never fabricates measurements.
   */
  _buildIncompleteResult({ experimentId, reason, experimentStartedAt, ...rest }) {
    return {
      experimentId,
      status: 'AWAITING_TRIALS',
      reason,
      measurementSource: MULTICLOUD_MEASUREMENT_SOURCE,
      experimentStartedAt,
      ...rest,
      note: 'No trial results available yet. Deploy Locust and run trials, then call runPairedExperiment() again.',
    };
  }

  /**
   * Load trial results from the database.
   * Returns empty array if no results exist — never throws.
   */
  async _loadTrialResults(experimentId) {
    try {
      const res = await this.query(
        'SELECT * FROM multicloud_trial_results WHERE experiment_id = $1 ORDER BY trial_index ASC',
        [experimentId]
      );
      return res.rows || [];
    } catch {
      return [];
    }
  }

  /**
   * Persist experiment result to database.
   */
  async _persistResult(result) {
    try {
      await this.query(
        `INSERT INTO multicloud_experiment_results
           (experiment_id, execution_mode, measurement_source,
            context_a, context_b, provider_a, provider_b,
            leakage_score, leakage_band, causal_classification,
            statistical_significance, trials_a, trials_b,
            experiment_started_at, experiment_completed_at, provenance)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         ON CONFLICT (experiment_id) DO UPDATE SET
           leakage_score = EXCLUDED.leakage_score,
           leakage_band = EXCLUDED.leakage_band,
           causal_classification = EXCLUDED.causal_classification,
           statistical_significance = EXCLUDED.statistical_significance,
           experiment_completed_at = EXCLUDED.experiment_completed_at,
           provenance = EXCLUDED.provenance`,
        [
          result.experimentId,
          result.executionMode,
          result.measurementSource,
          result.contextA,
          result.contextB,
          result.providerA,
          result.providerB,
          result.leakageResult?.score ?? null,
          result.leakageResult?.band ?? null,
          result.causalResult?.classification ?? null,
          result.statisticalResult?.significance ?? null,
          result.trialsA ?? 0,
          result.trialsB ?? 0,
          result.experimentStartedAt,
          result.experimentCompletedAt,
          JSON.stringify(result.provenance),
        ]
      );
    } catch (dbErr) {
      // Log but don't throw — result is returned even if persistence fails
      console.error('[MultiCloudExperimentRunner] Failed to persist result:', dbErr.message);
    }
  }
}

module.exports = {
  MultiCloudExperimentRunner,
  MULTICLOUD_MEASUREMENT_SOURCE,
  MULTICLOUD_EXECUTION_MODE,
  CONTEXT_TO_PROVIDER,
};
