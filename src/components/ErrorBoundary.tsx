import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Names the section in the console log, e.g. "analytics". */
  section?: string;
}

interface State {
  error?: Error;
}

/**
 * Keeps one broken section from taking down the whole app. Shows a short
 * message (the error text only in development) and a reload button.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`Forge OS: ${this.props.section ?? 'a section'} crashed.`, error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="card mx-auto my-8 max-w-sm p-6 text-center">
        <p className="font-medium">Something went wrong</p>
        <p className="mt-1 text-sm text-muted">Your data is safe on this device. Reloading usually fixes this.</p>
        {import.meta.env.DEV && <pre className="mt-3 overflow-auto whitespace-pre-wrap rounded-md border border-border p-2 text-left text-xs text-bad">{error.message}</pre>}
        <button className="btn-outline mt-4" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  }
}
