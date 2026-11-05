import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate } from 'react-router';
import { useAuth } from './auth/auth-context';
import { AuthProvider, RequireAuth } from './auth/AuthProvider';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ToastProvider } from './components/Toast';
import { useToast } from './components/toast-context';
import { AIControls } from './pages/AIControls';
import { Announcements } from './pages/Announcements';
import { AuditLog } from './pages/AuditLog';
import { Dashboard } from './pages/Dashboard';
import { EventsPolls } from './pages/EventsPolls';
import { Issues } from './pages/Issues';
import { Login } from './pages/Login';
import { Moderation } from './pages/Moderation';
import { UsersUnits } from './pages/UsersUnits';
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
          <div className="page" key={pathname}><Outlet /></div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <StoreProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              <Route path="login" element={<Login />} />
              <Route element={<RequireAuth />}>
                <Route element={<Shell />}>
                  <Route index element={<Navigate to="/dashboard" replace />} />
                  <Route path="dashboard" element={<Dashboard />} />
                  <Route path="issues" element={<Issues />} />
                  <Route path="moderation" element={<Moderation />} />
                  <Route path="announcements" element={<Announcements />} />
                  <Route path="events-polls" element={<EventsPolls />} />
                  <Route path="users" element={<UsersUnits />} />
                  <Route path="ai" element={<AIControls />} />
                  <Route path="audit" element={<AuditLog />} />
                  <Route path="*" element={<Navigate to="/dashboard" replace />} />
                </Route>
              </Route>
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </StoreProvider>
    </ToastProvider>
  );
}
