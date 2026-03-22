import { Component, type ReactNode } from 'react';

interface Props  { children: ReactNode; }
interface State  { hasError: boolean; }

/**
 * Root error boundary — catches any unhandled render error in the tree.
 * Keeps the launcher alive instead of showing a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    if (import.meta.env.DEV) {
      console.error('[CarLauncher] Render error:', error, info.componentStack);
    }
  }

  private recover = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      return (
        <div className="h-full w-full flex flex-col items-center justify-center gap-4 bg-[#060d1a] select-none">
          <span className="text-5xl opacity-30">⚠</span>
          <div className="text-white text-base font-semibold">Bir sorun oluştu</div>
          <button
            onClick={this.recover}
            className="px-8 py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-500 active:scale-95 transition-all duration-150 shadow-lg shadow-blue-600/25"
          >
            Tekrar Dene
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
