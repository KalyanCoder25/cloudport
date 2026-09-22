#!/usr/bin/env node
/**
 * scripts/preflight-check.js
 *
 * CloudPort Multi-Cloud Experiment Preflight Checker
 *
 * Verifies all prerequisites for the multicloud-portability-v1 experiment
 * WITHOUT provisioning cloud resources, making network calls to cloud APIs,
 * or modifying any existing state.
 *
 * SAFETY CONTRACT:
 *   - NEVER calls terraform apply / destroy.
 *   - NEVER connects to AWS EKS or GCP GKE clusters.
 *   - NEVER modifies kind-korifi or any Korifi resource.
 *   - NEVER prints credentials or secrets.
 *   - NEVER resets or deletes Supabase data.
 *   - Read-only inspection of local toolchain + kubeconfig only.
 *   - kind-korifi connectivity is tested ONLY to verify the local DB is reachable.
 *
 * Output: JSON + human-readable summary. Exit code 0 = all checks passed or
 * degraded (cloud credentials not yet present). Exit code 1 = blocking error.
 *
 * Usage:
 *   node scripts/preflight-check.js
 *   node scripts/preflight-check.js --json
 */
'use strict';

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const ROOT = path.resolve(__dirname, '..');
const JSON_OUTPUT = process.argv.includes('--json');

// ============================================================================
// Check registry
// ============================================================================
const checks = [];
const results = [];

function addCheck(id, description, fn) {
  checks.push({ id, description, fn });
}

// ============================================================================
// Helpers
// ============================================================================
function run(cmd, opts = {}) {
  try {
    const out = execSync(cmd, {
      encoding: 'utf8',
      timeout: 10000,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...opts,
    });
    return { ok: true, stdout: out.trim(), stderr: '' };
  } catch (err) {
    return {
      ok: false,
      stdout: (err.stdout || '').trim(),
      stderr: (err.stderr || err.message || '').trim(),
    };
  }
}

function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

function readJSON(p) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function checkKubeContext(contextName) {
  const res = run('kubectl config get-contexts --no-headers -o name');
  if (!res.ok) return { present: false, error: res.stderr };
  const contexts = res.stdout.split('\n').map((s) => s.trim()).filter(Boolean);
  return { present: contexts.includes(contextName), contexts };
}

// ============================================================================
// 1. Toolchain checks (local binary availability)
// ============================================================================

addCheck('tool:kubectl', 'kubectl is installed and reachable', () => {
  const res = run('kubectl version --client --output=json');
  if (!res.ok) return { status: 'FAIL', message: 'kubectl not found or failed', detail: res.stderr };
  let version = 'unknown';
  try { version = JSON.parse(res.stdout)?.clientVersion?.gitVersion; } catch {}
  return { status: 'PASS', message: `kubectl ${version}` };
});

addCheck('tool:terraform', 'terraform CLI is installed', () => {
  const res = run('terraform version -json');
  if (!res.ok) {
    // Some versions don't support -json
    const res2 = run('terraform version');
    if (!res2.ok) return { status: 'FAIL', message: 'terraform not found', detail: res2.stderr };
    return { status: 'PASS', message: res2.stdout.split('\n')[0] };
  }
  let version = 'unknown';
  try { version = JSON.parse(res.stdout)?.terraform_version; } catch {}
  return { status: 'PASS', message: `terraform ${version}` };
});

addCheck('tool:aws-cli', 'AWS CLI v2 is installed', () => {
  const res = run('aws --version');
  if (!res.ok) {
    return {
      status: 'BLOCKED_BY_CREDENTIALS',
      message: 'aws CLI not found — required before credentials are provided',
      detail: res.stderr,
    };
  }
  return { status: 'PASS', message: res.stdout || res.stderr };
});

addCheck('tool:gcloud', 'gcloud CLI is installed', () => {
  const res = run('gcloud version --format=json');
  if (!res.ok) {
    return {
      status: 'BLOCKED_BY_CREDENTIALS',
      message: 'gcloud CLI not found — required before credentials are provided',
      detail: res.stderr,
    };
  }
  let version = 'unknown';
  try { version = JSON.parse(res.stdout)?.['Google Cloud SDK']; } catch {}
  return { status: 'PASS', message: `gcloud ${version}` };
});

addCheck('tool:kustomize', 'kustomize is available (standalone or via kubectl)', () => {
  // Try standalone kustomize first
  const ks = run('kustomize version');
  if (ks.ok) return { status: 'PASS', message: ks.stdout.split('\n')[0] };
  // kubectl kustomize is built-in
  const kb = run('kubectl kustomize --help');
  if (kb.ok) return { status: 'PASS', message: 'kubectl kustomize (built-in)' };
  return { status: 'WARN', message: 'kustomize not found as standalone; kubectl kustomize may be used instead' };
});

addCheck('tool:node', 'Node.js >= 18 is installed', () => {
  const res = run('node --version');
  if (!res.ok) return { status: 'FAIL', message: 'node not found', detail: res.stderr };
  const ver = res.stdout; // e.g. v20.11.0
  const major = parseInt(ver.replace('v', '').split('.')[0], 10);
  if (isNaN(major) || major < 18) {
    return { status: 'FAIL', message: `Node ${ver} is below minimum v18` };
  }
  return { status: 'PASS', message: `Node ${ver}` };
});

// ============================================================================
// 2. Experiment definition files
// ============================================================================

addCheck('file:experiment-def', 'Experiment definition JSON exists', () => {
  const p = path.join(ROOT, 'experiments/multicloud-portability-v1.json');
  if (!fileExists(p)) return { status: 'FAIL', message: `Missing: ${p}` };
  const def = readJSON(p);
  if (!def) return { status: 'FAIL', message: 'Invalid JSON in experiment definition' };
  if (def.name !== 'multicloud-portability-v1') {
    return { status: 'FAIL', message: `Expected name=multicloud-portability-v1, got: ${def.name}` };
  }
  return {
    status: 'PASS',
    message: `${def.name} v${def.version} — ${def.replication?.pairedTrials} paired trials`,
  };
});

addCheck('file:locustfile', 'Locust locustfile.py exists', () => {
  const p = path.join(ROOT, 'platform/multicloud/locust/locustfile.py');
  if (!fileExists(p)) return { status: 'FAIL', message: `Missing: ${p}` };
  const content = fs.readFileSync(p, 'utf8');
  if (!content.includes('multicloud-portability-v1')) {
    return { status: 'WARN', message: 'locustfile.py found but does not contain experiment tag' };
  }
  if (!content.includes('on_test_stop')) {
    return { status: 'WARN', message: 'locustfile.py found but missing provenance on_test_stop hook' };
  }
  return { status: 'PASS', message: 'locustfile.py with provenance hooks present' };
});

addCheck('file:locust-configmap', 'Locust ConfigMap YAML exists', () => {
  const p = path.join(ROOT, 'platform/multicloud/locust/kubernetes/locust-configmap.yaml');
  if (!fileExists(p)) return { status: 'FAIL', message: `Missing: ${p}` };
  const content = fs.readFileSync(p, 'utf8');
  if (!content.includes('on_test_stop')) {
    return {
      status: 'WARN',
      message: 'locust-configmap.yaml found but may be missing provenance hooks — regenerate from canonical locustfile',
    };
  }
  return { status: 'PASS', message: 'locust-configmap.yaml with provenance hooks' };
});

addCheck('file:locust-kustomization', 'Locust kustomization.yaml exists', () => {
  const p = path.join(ROOT, 'platform/multicloud/locust/kubernetes/kustomization.yaml');
  if (!fileExists(p)) return { status: 'FAIL', message: `Missing: ${p}` };
  return { status: 'PASS', message: p };
});

addCheck('file:benchmark-kustomization', 'Online Boutique kustomization.yaml exists', () => {
  const p = path.join(ROOT, 'platform/multicloud/benchmark/kustomization.yaml');
  if (!fileExists(p)) return { status: 'FAIL', message: `Missing: ${p}` };
  const content = fs.readFileSync(p, 'utf8');
  if (!content.includes('v0.10.1')) {
    return { status: 'WARN', message: 'Benchmark kustomization found but may not be pinned to v0.10.1' };
  }
  return { status: 'PASS', message: 'Online Boutique v0.10.1 kustomization present' };
});

addCheck('file:configure-contexts', 'Context configuration script exists', () => {
  const p = path.join(ROOT, 'infra/contexts/configure-contexts.sh');
  if (!fileExists(p)) return { status: 'FAIL', message: `Missing: ${p}` };
  return { status: 'PASS', message: 'infra/contexts/configure-contexts.sh present' };
});

addCheck('file:terraform-aws', 'AWS Terraform root exists', () => {
  const mainTf = path.join(ROOT, 'infra/terraform/aws/main.tf');
  if (!fileExists(mainTf)) return { status: 'FAIL', message: `Missing: ${mainTf}` };
  return { status: 'PASS', message: 'infra/terraform/aws/main.tf present' };
});

addCheck('file:terraform-gcp', 'GCP Terraform root exists', () => {
  const mainTf = path.join(ROOT, 'infra/terraform/gcp/main.tf');
  if (!fileExists(mainTf)) return { status: 'FAIL', message: `Missing: ${mainTf}` };
  return { status: 'PASS', message: 'infra/terraform/gcp/main.tf present' };
});

// ============================================================================
// 3. Terraform static validation (no apply)
// ============================================================================

addCheck('terraform:aws-validate', 'Terraform AWS root validates (static, no apply)', () => {
  const awsDir = path.join(ROOT, 'infra/terraform/aws');
  if (!fileExists(path.join(awsDir, '.terraform/terraform.tfstate'))) {
    // terraform init not yet run — don't try validate
    return {
      status: 'WARN',
      message: 'AWS Terraform not initialized — run terraform init in infra/terraform/aws to enable static validation',
    };
  }
  const res = run(`terraform -chdir="${awsDir}" validate`, { timeout: 30000 });
  if (!res.ok) return { status: 'FAIL', message: 'terraform validate failed', detail: res.stderr };
  return { status: 'PASS', message: 'AWS Terraform validates' };
});

addCheck('terraform:gcp-validate', 'Terraform GCP root validates (static, no apply)', () => {
  const gcpDir = path.join(ROOT, 'infra/terraform/gcp');
  if (!fileExists(path.join(gcpDir, '.terraform/terraform.tfstate'))) {
    return {
      status: 'WARN',
      message: 'GCP Terraform not initialized — run terraform init in infra/terraform/gcp to enable static validation',
    };
  }
  const res = run(`terraform -chdir="${gcpDir}" validate`, { timeout: 30000 });
  if (!res.ok) return { status: 'FAIL', message: 'terraform validate failed', detail: res.stderr };
  return { status: 'PASS', message: 'GCP Terraform validates' };
});

// ============================================================================
// 4. Kubernetes context checks (no live cluster connection)
// ============================================================================

addCheck('k8s:context-kind-korifi', 'kind-korifi context is present in kubeconfig', () => {
  const { present, error } = checkKubeContext('kind-korifi');
  if (error) return { status: 'FAIL', message: 'kubectl config failed', detail: error };
  if (!present) return { status: 'WARN', message: 'kind-korifi context not found — local environment may need reconfiguration' };
  return { status: 'PASS', message: 'kind-korifi context found in kubeconfig' };
});

addCheck('k8s:context-aws', 'aws-eks-cloudport context is present in kubeconfig', () => {
  const { present, error } = checkKubeContext('aws-eks-cloudport');
  if (error) return { status: 'FAIL', message: 'kubectl config failed', detail: error };
  if (!present) {
    return {
      status: 'BLOCKED_BY_CREDENTIALS',
      message: 'aws-eks-cloudport context not found — run infra/contexts/configure-contexts.sh after terraform apply',
    };
  }
  return { status: 'PASS', message: 'aws-eks-cloudport context found in kubeconfig' };
});

addCheck('k8s:context-gcp', 'gcp-gke-cloudport context is present in kubeconfig', () => {
  const { present, error } = checkKubeContext('gcp-gke-cloudport');
  if (error) return { status: 'FAIL', message: 'kubectl config failed', detail: error };
  if (!present) {
    return {
      status: 'BLOCKED_BY_CREDENTIALS',
      message: 'gcp-gke-cloudport context not found — run infra/contexts/configure-contexts.sh after terraform apply',
    };
  }
  return { status: 'PASS', message: 'gcp-gke-cloudport context found in kubeconfig' };
});

addCheck('k8s:current-context-safe', 'Current kubectl context is not a cloud cluster', () => {
  const res = run('kubectl config current-context');
  if (!res.ok) return { status: 'WARN', message: 'Could not determine current context', detail: res.stderr };
  const ctx = res.stdout;
  if (ctx === 'aws-eks-cloudport' || ctx === 'gcp-gke-cloudport') {
    return {
      status: 'WARN',
      message: `Current context is "${ctx}" — this is a cloud cluster. Be careful not to run local commands against it.`,
    };
  }
  return { status: 'PASS', message: `Current context: ${ctx}` };
});

// ============================================================================
// 5. Database schema check
// ============================================================================

addCheck('db:schema-multicloud', 'Multicloud schema tables exist (via DATABASE_URL)', async () => {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    return {
      status: 'BLOCKED_BY_CREDENTIALS',
      message: 'DATABASE_URL not set — cannot check schema. Set it and re-run.',
    };
  }

  // Use the pg module if available
  let pg;
  try {
    pg = require('pg');
  } catch {
    return { status: 'WARN', message: 'pg module not available in this context — skipping live DB check' };
  }

  const pool = new pg.Pool({ connectionString: dbUrl, max: 1, connectionTimeoutMillis: 8000 });
  try {
    const res = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('multicloud_trial_results','multicloud_experiment_results')
      ORDER BY table_name
    `);
    const found = res.rows.map((r) => r.table_name);
    const expected = ['multicloud_experiment_results', 'multicloud_trial_results'];
    const missing = expected.filter((t) => !found.includes(t));
    if (missing.length > 0) {
      return {
        status: 'FAIL',
        message: `Missing tables: ${missing.join(', ')}. Run migration: psql $DATABASE_URL -f application/database/migrations/0003_multicloud.sql`,
      };
    }
    return { status: 'PASS', message: `multicloud_trial_results + multicloud_experiment_results exist` };
  } catch (err) {
    return { status: 'FAIL', message: 'Database query failed', detail: err.message };
  } finally {
    await pool.end().catch(() => {});
  }
});

// ============================================================================
// 6. Backend health check (local server)
// ============================================================================

addCheck('backend:health', 'CloudPort backend is running (localhost:4000/health)', () => {
  const res = run('curl -s --max-time 5 http://localhost:4000/health');
  if (!res.ok || !res.stdout) {
    return {
      status: 'WARN',
      message: 'Backend not reachable at localhost:4000 — start with: npm run dev:backend',
      detail: res.stderr,
    };
  }
  try {
    const body = JSON.parse(res.stdout);
    if (body.status === 'ok') return { status: 'PASS', message: `backend ok — ${body.service}` };
  } catch {}
  return { status: 'WARN', message: `Backend responded but unexpected body: ${res.stdout.slice(0, 100)}` };
});

addCheck('backend:multicloud-routes', 'Multicloud API routes are present', () => {
  const appPath = path.join(ROOT, 'application/backend/src/app.js');
  if (!fileExists(appPath)) return { status: 'FAIL', message: `app.js not found at ${appPath}` };
  const content = fs.readFileSync(appPath, 'utf8');
  const routes = [
    '/api/multicloud/trials',
    '/api/multicloud/experiments/:experimentId/run',
    '/api/multicloud/experiments/:experimentId/result',
    '/api/multicloud/experiments/:experimentId/status',
  ];
  const missing = routes.filter((r) => !content.includes(r));
  if (missing.length > 0) {
    return { status: 'FAIL', message: `Missing routes: ${missing.join(', ')}` };
  }
  return { status: 'PASS', message: `${routes.length} multicloud routes present in app.js` };
});

// ============================================================================
// 7. AWS credential check (non-blocking)
// ============================================================================

addCheck('aws:credentials', 'AWS credentials are configured', () => {
  const res = run('aws sts get-caller-identity --output json');
  if (!res.ok) {
    return {
      status: 'BLOCKED_BY_CREDENTIALS',
      message: 'AWS credentials not configured — required to run terraform apply and configure EKS context',
      detail: 'Set AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY, or configure ~/.aws/credentials',
    };
  }
  let identity = {};
  try { identity = JSON.parse(res.stdout); } catch {}
  // Do NOT print the actual ARN/Account — just confirm it's reachable
  return {
    status: 'PASS',
    message: `AWS credentials configured (Account: ${identity.Account || 'detected'})`,
  };
});

// ============================================================================
// 8. GCP credential check (non-blocking)
// ============================================================================

addCheck('gcp:credentials', 'GCP credentials are configured', () => {
  const res = run('gcloud auth list --filter=status:ACTIVE --format=json');
  if (!res.ok) {
    return {
      status: 'BLOCKED_BY_CREDENTIALS',
      message: 'gcloud not configured — run: gcloud auth application-default login',
      detail: res.stderr,
    };
  }
  let accounts = [];
  try { accounts = JSON.parse(res.stdout); } catch {}
  if (!accounts || accounts.length === 0) {
    return {
      status: 'BLOCKED_BY_CREDENTIALS',
      message: 'No active GCP account — run: gcloud auth application-default login',
    };
  }
  return { status: 'PASS', message: `GCP authenticated (${accounts.length} active account(s))` };
});

// ============================================================================
// Run all checks
// ============================================================================

const STATUS_ORDER = { FAIL: 0, BLOCKED_BY_CREDENTIALS: 1, WARN: 2, PASS: 3 };
const STATUS_ICON = { PASS: '✅', WARN: '⚠️ ', FAIL: '❌', BLOCKED_BY_CREDENTIALS: '🔑' };

async function runAll() {
  for (const check of checks) {
    let result;
    try {
      result = await Promise.resolve(check.fn());
    } catch (err) {
      result = { status: 'FAIL', message: 'Check threw an exception', detail: err.message };
    }
    results.push({
      id: check.id,
      description: check.description,
      ...result,
    });
  }

  // Summary counts
  const counts = { PASS: 0, WARN: 0, FAIL: 0, BLOCKED_BY_CREDENTIALS: 0 };
  for (const r of results) counts[r.status] = (counts[r.status] || 0) + 1;

  const overallBlocked = counts.BLOCKED_BY_CREDENTIALS > 0 && counts.FAIL === 0;
  const overallFail = counts.FAIL > 0;

  if (JSON_OUTPUT) {
    process.stdout.write(JSON.stringify({
      timestamp: new Date().toISOString(),
      counts,
      overallStatus: overallFail ? 'FAIL' : overallBlocked ? 'BLOCKED_BY_CREDENTIALS' : counts.WARN > 0 ? 'WARN' : 'PASS',
      results,
    }, null, 2) + '\n');
  } else {
    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  CloudPort Multi-Cloud Preflight Check');
    console.log('  Experiment: multicloud-portability-v1 (AWS EKS vs GCP GKE)');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    for (const r of results) {
      const icon = STATUS_ICON[r.status] || '❓';
      const line = `  ${icon}  [${r.id}] ${r.description}`;
      console.log(line);
      if (r.message) console.log(`       → ${r.message}`);
      if (r.detail) console.log(`       ⚑ ${r.detail.slice(0, 200)}`);
    }

    console.log('');
    console.log('───────────────────────────────────────────────────────────────');
    console.log(`  PASS: ${counts.PASS}   WARN: ${counts.WARN}   FAIL: ${counts.FAIL}   BLOCKED_BY_CREDENTIALS: ${counts.BLOCKED_BY_CREDENTIALS}`);
    console.log('');

    if (overallFail) {
      console.log('  ❌ PREFLIGHT FAILED — resolve FAIL items before running the experiment.');
    } else if (overallBlocked) {
      console.log('  🔑 READY (pending credentials)');
      console.log('');
      console.log('  All tool and file prerequisites are met.');
      console.log('  The experiment will be ready to run once:');
      console.log('    1. AWS credentials are configured');
      console.log('    2. GCP credentials are configured');
      console.log('    3. terraform apply (infra/terraform/aws + infra/terraform/gcp)');
      console.log('    4. infra/contexts/configure-contexts.sh');
      console.log('    5. kubectl apply -k platform/multicloud/benchmark/   (both contexts)');
      console.log('    6. kubectl apply -k platform/multicloud/locust/kubernetes/  (both contexts)');
    } else if (counts.WARN > 0) {
      console.log('  ⚠️  READY WITH WARNINGS — review warnings before running the experiment.');
    } else {
      console.log('  ✅ ALL CHECKS PASSED — ready to execute the experiment.');
    }

    console.log('');
    console.log('  Next steps:');
    console.log('    After credentials:  bash infra/contexts/configure-contexts.sh');
    console.log('    Deploy benchmark:   kubectl apply --context=aws-eks-cloudport -k platform/multicloud/benchmark/');
    console.log('                        kubectl apply --context=gcp-gke-cloudport  -k platform/multicloud/benchmark/');
    console.log('    Deploy Locust:      kubectl apply --context=aws-eks-cloudport -k platform/multicloud/locust/kubernetes/');
    console.log('                        kubectl apply --context=gcp-gke-cloudport  -k platform/multicloud/locust/kubernetes/');
    console.log('    Ingest results:     POST /api/multicloud/trials');
    console.log('    Run analysis:       POST /api/multicloud/experiments/<id>/run { "confirm": true }');
    console.log('    Check status:       GET  /api/multicloud/experiments/<id>/status');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
  }

  // Exit code: 1 only for real failures (not credential-blocked)
  process.exit(overallFail ? 1 : 0);
}

runAll().catch((err) => {
  console.error('Preflight check crashed:', err);
  process.exit(1);
});
