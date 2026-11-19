import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useAuth } from './auth/auth-context';
import { AuthProvider, RequireAuth } from './auth/AuthProvider';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ToastProvider } from './components/Toast';
import { useToast } from './components/toast-context';
import { AIControls } from './pages/AIControls';
import { Accounts } from './pages/Accounts';
import { Assistant } from './pages/Assistant';
import { Inspections } from './pages/Inspections';
import { Announcements } from './pages/Announcements';
import { AuditLog } from './pages/AuditLog';
import { Dashboard } from './pages/Dashboard';
import { Directory } from './pages/Directory';
import { EventsPolls } from './pages/EventsPolls';
import { Issues } from './pages/Issues';
import { Login } from './pages/Login';
import { Moderation } from './pages/Moderation';
import { OwnerDetail } from './pages/OwnerDetail';
import { Owners } from './pages/Owners';
import { UsersUnits } from './pages/UsersUnits';
import { Communication } from './pages/Communication';
import { Gate } from './pages/Gate';
import { Maintenance } from './pages/Maintenance';
import { Gallery } from './pages/Gallery';
import { Support } from './pages/Support';
import { AccessGate, AccessProvider } from './lib/access';
import { PlanProvider } from './lib/plan';
import { Team } from './pages/Team';
import { StoreProvider } from './store/store';

function Shell() {
  const { pathname } = useLocation();
  const { signOut } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

  const doSignOut = useCallback(() => {
    signOut();
    nav('/login', { replace: true });
    toast('Signed out', 'Your session on this device has ended.');
  }, [signOut, nav, toast]);

  return (
    <div className="adm">
      <Sidebar open={navOpen} onClose={() => setNavOpen(false)} onSignOut={doSignOut} />
      <div className="adm-body">
        <Header onMenu={() => setNavOpen(true)} onSignOut={doSignOut} />
        <main className="adm-main">
          {/* keyed so each section fades in on navigation */}
          <div className="page" key={pathname}><AccessGate /></div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AuthProvider>
        <PlanProvider>
        <AccessProvider>
        <StoreProvider>
          <BrowserRouter>
            <Routes>
              <Route path="login" element={<Login />} />
              <Route element={<RequireAuth />}>
                <Route element={<Shell />}>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="issues" element={<Issues />} />
                  <Route path="maintenance" element={<Maintenance />} />
                  <Route path="gate" element={<Gate />} />
                  <Route path="accounts" element={<Accounts />} />
                  <Route path="owners" element={<Owners />} />
                  <Route path="owners/:unitId" element={<OwnerDetail />} />
                  <Route path="assistant" element={<Assistant />} />
                  <Route path="inspections" element={<Inspections />} />
                  <Route path="communication" element={<Communication />} />
                  <Route path="moderation" element={<Moderation />} />
                  <Route path="announcements" element={<Announcements />} />
                  <Route path="events-polls" element={<EventsPolls />} />
                  <Route path="gallery" element={<Gallery />} />
                  <Route path="residents" element={<UsersUnits key="residents" view="residents" />} />
                  <Route path="flats" element={<UsersUnits key="flats" view="flats" />} />
                  <Route path="users" element={<Navigate to="/residents" replace />} />
                  <Route path="directory" element={<Directory />} />
                  <Route path="team" element={<Team />} />
                  <Route path="ai" element={<AIControls />} />
                  <Route path="audit" element={<AuditLog />} />
                  <Route path="support" element={<Support />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </StoreProvider>
        </AccessProvider>
        </PlanProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
