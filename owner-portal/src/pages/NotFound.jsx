import { useNavigate } from 'react-router';
import { PageHead } from '../components/ui';

/** an address that isn't a page here: said plainly, with a way back */
export function NotFound() {
  const nav = useNavigate();
  return (
    <>
      <PageHead crumb="Operator console" title="Page not found">
        There is no page at <code>{window.location.pathname}</code>. It may have been moved or removed.
      </PageHead>
      <button className="btn" onClick={() => nav('/')}>Go to the Command centre</button>
    </>
  );
}
