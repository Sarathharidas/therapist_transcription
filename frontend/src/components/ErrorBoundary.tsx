import { Component, ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * Catches render-time exceptions anywhere below it and shows a
 * recoverable error screen instead of a blank page.
 *
 * React error boundaries only catch render errors — async errors
 * (in event handlers, fetch callbacks, etc.) are handled inline
 * with try/catch in each component.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string }) {
    console.error('[ErrorBoundary]', error, info);
  }

  handleReload = () => {
    this.setState({ error: null });
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div className="max-w-md text-center">
          <h1 className="text-2xl mb-3" style={{ fontFamily: 'var(--font-serif)' }}>
            Something went wrong
          </h1>
          <p className="text-sm text-muted-foreground mb-6">
            The app hit an unexpected error. Please reload the page.
            Your data is safe — recorded sessions are saved to the server.
          </p>
          <details className="mb-6 text-left">
            <summary className="text-xs text-muted-foreground cursor-pointer mb-2">
              Technical details
            </summary>
            <pre className="text-[10px] bg-secondary/50 p-3 rounded-lg overflow-auto max-h-48 text-foreground/70">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
          </details>
          <button
            onClick={this.handleReload}
            className="px-5 py-2.5 bg-accent text-accent-foreground text-sm font-semibold rounded-lg hover:opacity-90 transition-opacity"
          >
            Reload page
          </button>
        </div>
      </div>
    );
  }
}
