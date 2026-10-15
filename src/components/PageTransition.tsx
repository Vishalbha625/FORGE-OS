import { useEffect, useState, type ReactNode } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * A 150 ms fade between pages, CSS only (.page-enter / .page-enter-active in
 * index.css; skipped under reduced motion). Keyed on the path so each
 * navigation replays it.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  return (
    <Fade key={pathname}>
      {children}
    </Fade>
  );
}

function Fade({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false);
  useEffect(() => {
    const id = requestAnimationFrame(() => setActive(true));
    return () => cancelAnimationFrame(id);
  }, []);
  return <div className={`page-enter ${active ? 'page-enter-active' : ''}`}>{children}</div>;
}
