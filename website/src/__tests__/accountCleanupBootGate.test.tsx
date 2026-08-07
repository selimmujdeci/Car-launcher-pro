import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const hook = vi.hoisted(() => ({
  snapshot: {
    initialized: false,
    lockdownActive: true,
    cleanupState: 'IDLE',
    cleanupId: null,
    cleanupReason: null,
    generation: 0,
    bootStatus: 'CHECKING',
  },
  retryRecovery: vi.fn(),
}));

vi.mock('@/security/accountCleanup/useAccountCleanupRuntime', () => ({
  useAccountCleanupRuntime: () => ({
    runtime: { retryRecovery: hook.retryRecovery },
    snapshot: hook.snapshot,
  }),
}));

import { AccountCleanupBootGate } from '@/components/security/AccountCleanupBootGate';

function render(status: string, initialized = true) {
  hook.snapshot.initialized = initialized;
  hook.snapshot.bootStatus = status;
  return renderToStaticMarkup(
    <AccountCleanupBootGate>
      <div>PROTECTED_DASHBOARD_SENTINEL</div>
    </AccountCleanupBootGate>,
  );
}

describe('AccountCleanupBootGate', () => {
  it('does not mount protected children while checking', () => {
    expect(render('CHECKING', false)).not.toContain('PROTECTED_DASHBOARD_SENTINEL');
  });

  it('mounts protected children only for SAFE_TO_START', () => {
    expect(render('SAFE_TO_START')).toContain('PROTECTED_DASHBOARD_SENTINEL');
  });

  for (const status of [
    'CLEANUP_RECOVERY_REQUIRED',
    'STORAGE_CORRUPTED',
    'SECURITY_RESET_REQUIRED',
    'RUNTIME_ERROR',
    'AUTH_REQUIRED',
  ]) {
    it(`does not mount protected children for ${status}`, () => {
      expect(render(status)).not.toContain('PROTECTED_DASHBOARD_SENTINEL');
    });
  }

  it('renders only safe diagnostic copy, never credential payloads', () => {
    const html = render('STORAGE_CORRUPTED');
    expect(html).toContain('Araç verilerine erişim kapatıldı');
    expect(html).not.toMatch(/access_token|api[_ -]?key|pin hash/i);
  });
});
