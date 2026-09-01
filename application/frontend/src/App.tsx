import React from 'react';
import { NavLink, Route, Routes } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
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

const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/experiments', label: 'Experiments' },
  { to: '/infrastructure-a', label: 'Infrastructure A' },
  { to: '/infrastructure-b', label: 'Infrastructure B' },
  { to: '/comparison', label: 'A/B Comparison' },
  { to: '/telemetry', label: 'Telemetry' },
  { to: '/replication', label: 'Replication' },
  { to: '/leakage', label: 'Leakage Analysis' },
  { to: '/evidence', label: 'Evidence' },
  { to: '/reports', label: 'Reports' },
  { to: '/recovery', label: 'Recovery' },
];

export default function App() {
  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-title">CloudPort</div>
          <div className="sidebar-brand-subtitle">cloudport:1.0.0</div>
        </div>
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            {item.label}
          </NavLink>
        ))}
      </nav>
      <main className="main">
        <Routes>
          <Route path="/" element={<Dashboard />} />
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
        </Routes>
      </main>
    </div>
  );
}
