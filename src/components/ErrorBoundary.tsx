import { Component, type ReactNode } from 'react';
import { logError } from '../platform/crashLogger';

interface Props  { children: ReactNode; }
interface State  { hasError: boolean; errorMsg: string }

/**
 * Root error boundary — catches any unhandled render error in the tree.
 * Keeps the launcher alive instead of showing a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMsg: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMsg: error?.message ?? 'Bilinmeyen hata' };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    // Log in both dev and prod — adb logcat + localStorage persist
    logError('React', new Error(`${error.message}\n${info.componentStack}`));
  }

  private recover = () => this.setState({ hasError: false, errorMsg: '' });

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', background: '#060d1a', color: '#fff', fontFamily: 'system-ui,sans-serif', userSelect: 'none' }} className="select-none">
          <span className="text-5xl opacity-30">⚠</span>
          <div className="text-white text-base font-semibold">Bir sorun oluştu</div>
          {import.meta.env.DEV && this.state.errorMsg && (
            <div className="text-red-400 text-xs max-w-xs text-center px-4 opacity-70 font-mono">
              {this.state.errorMsg}
            </div>
          )}
          <button
            onClick={this.recover}
            className="px-8 py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold active:scale-95 transition-[transform] duration-100 shadow-lg shadow-blue-600/25"
          >
            Tekrar Dene
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
