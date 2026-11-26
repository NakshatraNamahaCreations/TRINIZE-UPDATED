import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from 'react-router';
import { CommandPalette } from './components/CommandPalette';
import { Copilot } from './components/Copilot';
import { ChartTip, Modal, Toast } from './components/Overlays';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { Association360 } from './pages/Association360';
import { Associations } from './pages/Associations';
import { Changed } from './pages/Changed';
import { Collections } from './pages/Collections';
import { CommandCentre } from './pages/CommandCentre';
import { Issues } from './pages/Issues';
import { Login } from './pages/Login';
import { Managers } from './pages/Managers';
import { Modules } from './pages/Modules';
import { Renewals } from './pages/Renewals';
import { Subscriptions } from './pages/Subscriptions';
import { Team } from './pages/Team';
import { AiUsage } from './pages/AiUsage';
import { AuthProvider } from './store/AuthProvider';
import { LIVE } from './lib/api';
import { useAuth, usePortal } from './store/context';
import { PortalProvider } from './store/PortalContext';

const RAIL_KEY = 'trinize.owner.rail';
const readRail = () => { try { return localStorage.getItem(RAIL_KEY) === '1'; } catch { return false; } };

/** Signed-out visitors go to /login and come back to where they were heading. */
function RequireAuth() {
  const { session } = useAuth();
  const location = useLocation();
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

/** Connected mode: nothing is drawn until the real records have arrived. */
function Loading() {
  const { loadError, reload } = usePortal();
  const { session, signOut } = useAuth();
  return (
    <div className="boot">
      <div className="logo-t">T</div>
      {loadError ? (
        <>
          <b>Couldn’t load the portal</b>
          <span>{loadError}</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn sm" onClick={() => reload(session.at)}>Try again</button>
            <button className="btn sm ghost" onClick={signOut}>Sign out</button>
          </div>
        </>
      ) : <span>Loading your portfolio…</span>}
    </div>
  );
}

function Shell() {
  const { pathname } = useLocation();
  const { ready } = usePortal();
  const [collapsed, setCollapsed] = useState(readRail);
  const [drawer, setDrawer] = useState(false);
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  const toggleRail = useCallback(() => setCollapsed(c => {
    try { localStorage.setItem(RAIL_KEY, c ? '0' : '1'); } catch { /* storage blocked */ }
    return !c;
  }), []);
  const closeDrawer = useCallback(() => setDrawer(false), []);

  if (LIVE && !ready) return <Loading />;

  return (
    <div className={'app' + (collapsed ? ' rail' : '')}>
      <Sidebar collapsed={collapsed} onToggle={toggleRail} open={drawer} onClose={closeDrawer} />
      <div className="main">
        <Topbar onMenu={() => setDrawer(true)} />
        {/* keyed on the route so the fade-up replays on every page change, as in the concept */}
        <main className="content" key={pathname}><Outlet /></main>
      </div>
      <Copilot />
      <CommandPalette />
      <Modal />
      <ChartTip />
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <PortalProvider>
          <Routes>
            <Route path="login" element={<Login />} />
            <Route element={<RequireAuth />}>
              <Route element={<Shell />}>
                <Route index element={<CommandCentre />} />
                <Route path="renewals" element={<Renewals />} />
                <Route path="collections" element={<Collections />} />
                <Route path="associations" element={<Associations />} />
                <Route path="associations/:id" element={<Association360 />} />
                <Route path="subscriptions" element={<Subscriptions />} />
                <Route path="issues" element={<Issues />} />
                <Route path="managers" element={<Managers />} />
                <Route path="modules" element={<Modules />} />
                {LIVE && <Route path="team" element={<Team />} />}
                {LIVE && <Route path="ai-usage" element={<AiUsage />} />}
                <Route path="changed" element={<Changed />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Route>
            </Route>
          </Routes>
          {/* outside the shell so a sign-out confirmation still shows on the login page */}
          <Toast />
        </PortalProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
