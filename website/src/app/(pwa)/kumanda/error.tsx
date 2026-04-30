'use client';

import { useEffect } from 'react';

export default function KumandaError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('Kumanda page error:', error);
  }, [error]);

  return (
    <div style={{
      padding: 24, background: '#060d1a', minHeight: '100dvh',
      fontFamily: 'monospace', color: '#f87171',
    }}>
      <p style={{ color: '#fff', fontWeight: 'bold', marginBottom: 8 }}>Hata:</p>
      <p style={{ marginBottom: 12 }}>{error.message}</p>
      <pre style={{ fontSize: 11, whiteSpace: 'pre-wrap', color: '#fca5a5', marginBottom: 16 }}>
        {error.stack}
      </pre>
      <button
        onClick={reset}
        style={{ padding: '8px 16px', background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' }}
      >
        Tekrar Dene
      </button>
    </div>
  );
}
