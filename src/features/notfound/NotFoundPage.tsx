import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="py-16 text-center">
      <h1 className="page-title">Page not found</h1>
      <p className="mt-2 text-sm text-muted">This address doesn't match anything in Forge OS.</p>
      <Link to="/" className="btn-outline mt-6 inline-flex">Back to dashboard</Link>
    </div>
  );
}
