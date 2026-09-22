import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

// Research pipeline steps shown as spatial nodes
const PIPELINE_STEPS = [
  { label: 'Application', dim: false },
  { label: 'Infrastructure A/B', dim: false },
  { label: 'Deterministic Trials', dim: false },
  { label: 'Telemetry Collection', dim: false },
  { label: 'Leakage Analysis', dim: false },
  { label: 'Causal Governance', dim: false },
  { label: 'Evidence', dim: false },
];

const DIMENSIONS = [
  {
    key: 'storage',
    title: 'Storage Isolation',
    desc: 'Evaluates PVC latency, IOPS constraints, and file mount semantics across hostpath and cloud block stores.',
  },
  {
    key: 'resource',
    title: 'Resource Throttling',
    desc: 'Measures CPU quota enforcement and memory reclaim boundaries under deterministic workload stress.',
  },
  {
    key: 'network',
    title: 'Network Policies',
    desc: 'Detects implicit ingress/egress filtering differences between CNI implementations.',
  },
  {
    key: 'ingress',
    title: 'Ingress & Routing',
    desc: 'Compares gateway latency headers, SSL termination, and proxy buffering across ingress controllers.',
  },
  {
    key: 'runtime',
    title: 'Runtime Scheduling',
    desc: 'Analyzes cold-start overhead, pod startup latency, and node affinity execution characteristics.',
  },
];

const Q_AND_A = [
  {
    q: 'What is CloudPort?',
    a: 'An automated verification platform that deploys identical workloads to differing container platforms (Kind, EKS, GKE) to measure whether performance, storage, and networking behave consistently.',
  },
  {
    q: 'What can I test?',
    a: 'Test workloads across core dimensions: Runtime behavior, Storage IO isolation, Network policy constraints, Ingress behavior, and Resource limits.',
  },
  {
    q: 'How do I start?',
    a: 'Register an application, configure an experiment with an invariant manifest, and execute paired deterministic trials.',
  },
  {
    q: 'Experiment Execution',
    a: 'Runs capture paired trials (Infrastructure A vs B), record application-visible metrics (latency, error rates), and verify environment parity.',
  },
  {
    q: 'Analyzing Results',
    a: 'CloudPort produces an automated Leakage Score and causal classification backed by cryptographic SHA-256 provenance.',
  },
  {
    q: 'Scientific Principle',
    a: 'Results are derived strictly from reproducible measurements and statistical t-tests. We do not fabricate metrics.',
  },
];

export default function LandingPage() {
  const { user } = useAuth();

  return (
    <div className="landing-container">
      {/* Header */}
      <header className="landing-header">
        <div className="brand-group">
          <span className="brand-title">CloudPort</span>
          <span className="badge badge-version">v1.0.0</span>
        </div>
        <nav className="header-actions" aria-label="Landing navigation">
          {user ? (
            <Link to="/dashboard" className="btn btn-primary">
              Enter Console →
            </Link>
          ) : (
            <>
              <Link to="/login" className="btn btn-outline">
                Sign In
              </Link>
              <Link to="/signup" className="btn btn-primary">
                Get Started
              </Link>
            </>
          )}
        </nav>
      </header>

      {/* Hero Section */}
      <section className="hero-section" aria-labelledby="hero-heading">
        <div className="hero-eyebrow">Infrastructure-Aware Application Portability</div>
        <h1 id="hero-heading" className="hero-title">
          Evaluate Portability with{' '}
          <span className="highlight-amber">Empirical Evidence</span>
        </h1>
        <p className="hero-description">
          Observe application behavior across heterogeneous environments. Measure divergence,
          isolate infrastructure leakage, and produce reproducible portability conclusions.
        </p>
        <div className="hero-actions">
          <Link to={user ? '/dashboard' : '/signup'} className="btn btn-primary">
            {user ? 'Open Dashboard' : 'Start Portability Testing'}
          </Link>
          <a href="#how-it-works" className="btn btn-outline">
            How It Works ↓
          </a>
        </div>

        {/* Research Pipeline Visual */}
        <div className="pipeline-visual" role="img" aria-label="Research pipeline: Application through to Evidence">
          {PIPELINE_STEPS.map((step, i) => (
            <React.Fragment key={step.label}>
              <div className="pipeline-node">
                <div className="pipeline-node-box">{step.label}</div>
              </div>
              {i < PIPELINE_STEPS.length - 1 && (
                <div className="pipeline-arrow" aria-hidden="true">→</div>
              )}
            </React.Fragment>
          ))}
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="info-section" aria-labelledby="how-heading">
        <h2 id="how-heading" className="section-title">Understanding CloudPort</h2>
        <div className="grid-responsive">
          {Q_AND_A.map((item, i) => (
            <div key={item.q} className="panel">
              <div className="panel-eyebrow">Question {i + 1}</div>
              <div className="panel-subtitle">{item.q}</div>
              <p className="panel-text">{item.a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Portability Dimensions */}
      <section className="info-section" aria-labelledby="dimensions-heading">
        <h2 id="dimensions-heading" className="section-title">Controlled Portability Dimensions</h2>
        <div className="grid-responsive">
          {DIMENSIONS.map((dim) => (
            <div key={dim.key} className="panel dimension-panel">
              <div className="dimension-title">{dim.title}</div>
              <div className="dimension-desc">{dim.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA */}
      <div className="panel cta-panel">
        <h3 className="cta-title">Ready to test your application?</h3>
        <p className="cta-description">
          Register your application and run reproducible multi-cloud portability experiments.
        </p>
        <Link to={user ? '/dashboard' : '/signup'} className="btn btn-primary">
          {user ? 'Go to Dashboard' : 'Create Account'}
        </Link>
      </div>
    </div>
  );
}
