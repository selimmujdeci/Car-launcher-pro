'use client';

import { Component, type ReactNode } from 'react';

interface State { error: Error | null }

export class PwaErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#f87171', fontFamily: 'monospace', fontSize: 13, background: '#060d1a', minHeight: '100dvh' }}>
          <p style={{ color: '#fff', fontWeight: 'bold', marginBottom: 8 }}>Hata Detayı:</p>
          <p>{this.state.error.message}</p>
          <pre style={{ marginTop: 12, whiteSpace: 'pre-wrap', color: '#fca5a5', fontSize: 11 }}>
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            style={{ marginTop: 16, padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
          >
            Yenile
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
