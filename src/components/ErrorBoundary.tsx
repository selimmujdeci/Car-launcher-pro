import { Component, type ReactNode } from 'react';
import { logError } from '../platform/crashLogger';

interface Props  { children: ReactNode; }
interface State  { hasError: boolean; errorMsg: string; stack: string }

/**
 * Root error boundary — catches any unhandled render error in the tree.
 * Keeps the launcher alive instead of showing a blank screen.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, errorMsg: '', stack: '' };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMsg: error?.message ?? 'Bilinmeyen hata', stack: '' };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    logError('React', new Error(`${error.message}\n${info.componentStack}`));
    this.setState({ stack: info.componentStack.slice(0, 400) });
  }

  private recover = () => this.setState({ hasError: false, errorMsg: '', stack: '' });

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', background: 'var(--panel-bg)', color: '#fff', fontFamily: 'system-ui,sans-serif', userSelect: 'none', padding: '1rem' }} className="select-none">
          <span className="text-5xl opacity-30">⚠</span>
          <div className="text-primary text-base font-semibold">Bir sorun oluştu</div>
          {this.state.errorMsg && (
            <div className="text-red-400 text-xs text-center px-2 opacity-80 font-mono" style={{ wordBreak: 'break-all' }}>
              {this.state.errorMsg}
            </div>
          )}
          {this.state.stack && (
            <div className="text-yellow-300 text-[9px] text-left px-2 opacity-70 font-mono w-full overflow-auto" style={{ maxHeight: '40vh', wordBreak: 'break-all', whiteSpace: 'pre-wrap' }}>
              {this.state.stack}
            </div>
          )}
          <button
            onClick={this.recover}
            className="px-8 py-3 bg-blue-600 text-primary rounded-xl text-sm font-semibold active:scale-95 transition-[transform] duration-100 shadow-lg shadow-blue-600/25"
          >
            Tekrar Dene
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}


