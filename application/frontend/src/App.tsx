import React from 'react';
import { NavLink, Route, Routes, Navigate, Link } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ProtectedRoute } from './components/ProtectedRoute';

import LandingPage from './pages/LandingPage';
import LoginPage from './pages/LoginPage';
import SignUpPage from './pages/SignUpPage';
import Dashboard from './pages/Dashboard';
import ApplicationsPage from './pages/ApplicationsPage';
import ApplicationDetailPage from './pages/ApplicationDetailPage';
import DeployApplicationPage from './pages/DeployApplicationPage';
import DeploymentDetailPage from './pages/DeploymentDetailPage';
import Experiments from './pages/Experiments';
import InfrastructureAPage from './pages/InfrastructureA';
import InfrastructureBPage from './pages/InfrastructureB';
import Comparison from './pages/Comparison';
import Telemetry from './pages/Telemetry';
import Replication from './pages/Replication';
import Leakage from './pages/Leakage';
import Evidence from './pages/Evidence';
import Reports from './pages/Reports';
import Recovery from './pages/Recovery';

// --- Nav Icon components (inline SVG, no icon library needed) ---
function IconDashboard() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    </svg>
  );
}
function IconApps() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M2 4h12M2 8h8M2 12h5" strokeLinecap="round" />
    </svg>
  );
}
function IconDeploy() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2v9M5 8l3 3 3-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 13h12" strokeLinecap="round" />
    </svg>
  );
}
function IconInfraA() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="1.5" y="6.5" width="5" height="8" rx="1" />
      <rect x="9.5" y="2.5" width="5" height="12" rx="1" />
      <path d="M1.5 10.5h12.5" strokeLinecap="round" strokeDasharray="2 2" />
    </svg>
  );
}
function IconInfraB() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="9.5" y="6.5" width="5" height="8" rx="1" />
      <rect x="1.5" y="2.5" width="5" height="12" rx="1" />
      <path d="M1.5 10.5h12.5" strokeLinecap="round" strokeDasharray="2 2" />
    </svg>
  );
}
function IconCompare() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 3h4v10H3zM9 3h4v10H9z" />
      <path d="M7 8h2" strokeLinecap="round" />
    </svg>
  );
}
function IconFlask() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M6 2h4M5.5 7l-3 6.5a.5.5 0 00.5.5h10a.5.5 0 00.5-.5L10.5 7M6 2v5M10 2v5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconTelemetry() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <polyline points="1,12 4,7 7,10 10,4 13,8 15,5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
function IconReplication() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2.5C5 2.5 2.5 5 2.5 8S5 13.5 8 13.5 13.5 11 13.5 8 11 2.5 8 2.5z" />
      <path d="M8 5v3l2 2" strokeLinecap="round" />
    </svg>
  );
}
function IconLeakage() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M8 2l5 10H3L8 2z" strokeLinejoin="round" />
      <path d="M8 6v3M8 10.5v.5" strokeLinecap="round" />
    </svg>
  );
}
function IconEvidence() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M3 2h7l3 3v9H3V2z" />
      <path d="M10 2v3h3M5 7h6M5 10h4" strokeLinecap="round" />
    </svg>
  );
}
function IconReports() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <rect x="2" y="1" width="12" height="14" rx="1" />
      <path d="M5 5h6M5 8h6M5 11h3" strokeLinecap="round" />
    </svg>
  );
}
function IconRecovery() {
  return (
    <svg className="nav-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M14 8A6 6 0 112 8" strokeLinecap="round" />
      <path d="M14 8l-2-2.5L9.5 8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// Grouped nav structure
const NAV_GROUPS = [
  {
    label: 'Workspace',
    items: [
      { to: '/dashboard', label: 'Dashboard', Icon: IconDashboard },
      { to: '/applications', label: 'Applications', Icon: IconApps },
      { to: '/deploy', label: 'Deploy Application', Icon: IconDeploy },
    ],
  },
  {
    label: 'Infrastructure',
    items: [
      { to: '/infrastructure-a', label: 'Infrastructure A', Icon: IconInfraA },
      { to: '/infrastructure-b', label: 'Infrastructure B', Icon: IconInfraB },
      { to: '/comparison', label: 'A/B Comparison', Icon: IconCompare },
    ],
  },
  {
    label: 'Research',
    items: [
      { to: '/experiments', label: 'Experiments', Icon: IconFlask },
      { to: '/telemetry', label: 'Telemetry', Icon: IconTelemetry },
      { to: '/replication', label: 'Replication', Icon: IconReplication },
    ],
  },
  {
    label: 'Analysis',
    items: [
      { to: '/leakage', label: 'Leakage Analysis', Icon: IconLeakage },
      { to: '/evidence', label: 'Evidence', Icon: IconEvidence },
      { to: '/reports', label: 'Reports', Icon: IconReports },
      { to: '/recovery', label: 'Recovery', Icon: IconRecovery },
    ],
  },
];

function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const { user, activeApp, logout } = useAuth();

  return (
    <div className="app-shell">
      <nav className="sidebar" aria-label="Main navigation">
        {/* Brand */}
        <div className="sidebar-brand">
          <Link to="/" style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="sidebar-brand-title">CloudPort</div>
            <div className="sidebar-brand-subtitle">cloudport:1.0.0</div>
          </Link>
        </div>

        {/* Active Application Context Pill */}
        {activeApp && (
          <div className="active-app-pill">
            <div className="label">Active App</div>
            <div className="name" title={activeApp.name}>
              {activeApp.name}
            </div>
          </div>
        )}

        {/* Grouped Navigation */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="sidebar-section-label">{group.label}</div>
              {group.items.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
                >
                  <item.Icon />
                  {item.label}
                </NavLink>
              ))}
            </div>
          ))}
        </div>

        {/* Authenticated User Session Box */}
        <div className="sidebar-user-box">
          <div className="user-name-label" title={user?.email}>
            {user?.displayName || 'Authenticated User'}
          </div>
          <div className="user-role-badge">{user?.role || 'OPERATOR'}</div>
          <button
            onClick={logout}
            className="btn btn-outline btn-sm"
            style={{ width: '100%', marginTop: 10 }}
          >
            Log Out
          </button>
        </div>
      </nav>
      <main className="main" id="main-content">{children}</main>
    </div>
  );
}

function AppContent() {
  const { user } = useAuth();

  return (
    <Routes>
      {/* Public Pages */}
      <Route
        path="/"
        element={user ? <Navigate to="/dashboard" replace /> : <LandingPage />}
      />
      <Route
        path="/login"
        element={user ? <Navigate to="/dashboard" replace /> : <LoginPage />}
      />
      <Route
        path="/signup"
        element={user ? <Navigate to="/dashboard" replace /> : <SignUpPage />}
      />

      {/* Protected Workspace Pages */}
      <Route
        path="/*"
        element={
          <ProtectedRoute>
            <AuthenticatedShell>
              <Routes>
                <Route path="/dashboard" element={<Dashboard />} />
                <Route path="/applications" element={<ApplicationsPage />} />
                <Route path="/applications/:id" element={<ApplicationDetailPage />} />
                <Route path="/deploy" element={<DeployApplicationPage />} />
                <Route path="/deployments/:id" element={<DeploymentDetailPage />} />
                <Route path="/experiments" element={<Experiments />} />
                <Route path="/infrastructure-a" element={<InfrastructureAPage />} />
                <Route path="/infrastructure-b" element={<InfrastructureBPage />} />
                <Route path="/comparison" element={<Comparison />} />
                <Route path="/telemetry" element={<Telemetry />} />
                <Route path="/replication" element={<Replication />} />
                <Route path="/leakage" element={<Leakage />} />
                <Route path="/evidence" element={<Evidence />} />
                <Route path="/reports" element={<Reports />} />
                <Route path="/recovery" element={<Recovery />} />
                <Route path="*" element={<Navigate to="/dashboard" replace />} />
              </Routes>
            </AuthenticatedShell>
          </ProtectedRoute>
        }
      />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
