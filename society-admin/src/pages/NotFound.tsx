import { MagnifyingGlass } from '@phosphor-icons/react';
import { useLocation, useNavigate } from 'react-router';
import { Empty, PageHead } from '../components/ui';

/** an address that isn't a page here: said plainly, with a way back, instead of silently opening the dashboard (S-09) */
export function NotFound() {
  const nav = useNavigate();
  const { pathname } = useLocation();
  return (
    <>
      <PageHead title="Page not found" sub={`There is no page at ${pathname}. It may have been moved or removed.`} />
      <Empty icon={MagnifyingGlass} title="Nothing here" body="Use the menu, or go back to the dashboard." />
      <button className="a-btn" style={{ marginTop: 12 }} onClick={() => nav('/dashboard')}>Go to the dashboard</button>
    </>
  );
}
