// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Topbar from '@/components/layout/Topbar';
import Sidebar from '@/components/layout/Sidebar';

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  logout: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  usePathname: () => '/dashboard',
  useRouter: () => ({ push: mocks.push }),
}));
vi.mock('next/link', () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) =>
    <a {...props}>{children}</a>,
}));
vi.mock('@/security/accountCleanup/canonicalLogout', () => ({
  requestCanonicalLogout: mocks.logout,
}));
vi.mock('@/store/vehicleStore', () => ({
  useVehicleStore: (selector: (state: {
    getList: () => [];
    connectionStatus: string;
  }) => unknown) => selector({
    getList: () => [],
    connectionStatus: 'disconnected',
  }),
}));
vi.mock('@/store/notificationStore', () => ({
  useNotificationStore: (selector: (state: {
    unreadCount: () => number;
  }) => unknown) => selector({ unreadCount: () => 0 }),
}));
vi.mock('@/components/dashboard/PushNotificationWidget', () => ({
  PushNotificationWidget: () => null,
}));
vi.mock('@/lib/supabase', () => ({ supabaseBrowser: null }));

describe('Topbar and Sidebar canonical logout wiring', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    mocks.push.mockReset();
    mocks.logout.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  it.each([
    ['Topbar', <Topbar />, 'button[title="Çıkış Yap"]'],
    ['Sidebar', <Sidebar />, 'button'],
  ])('%s does not navigate on blocking cleanup',
    async (_name, component, selector) => {
      mocks.logout.mockResolvedValue({
        ok: false,
        state: 'FAILED_BLOCKING',
      });
      await act(async () => { root.render(component); });
      const buttons = Array.from(container.querySelectorAll(selector));
      const button = buttons.find((item) =>
        item.getAttribute('title') === 'Çıkış Yap' ||
        item.textContent?.includes('Çıkış Yap'));
      expect(button).toBeDefined();
      await act(async () => {
        (button as HTMLButtonElement).click();
        await Promise.resolve();
      });
      expect(mocks.logout).toHaveBeenCalledTimes(1);
      expect(mocks.push).not.toHaveBeenCalled();
    });

  it.each([
    ['Topbar', <Topbar />, 'button[title="Çıkış Yap"]'],
    ['Sidebar', <Sidebar />, 'button'],
  ])('%s navigates only after cleanup success',
    async (_name, component, selector) => {
      mocks.logout.mockResolvedValue({
        ok: true,
        cleanupId: 'cleanup-a',
        state: 'COMPLETED',
      });
      await act(async () => { root.render(component); });
      const buttons = Array.from(container.querySelectorAll(selector));
      const button = buttons.find((item) =>
        item.getAttribute('title') === 'Çıkış Yap' ||
        item.textContent?.includes('Çıkış Yap'));
      await act(async () => {
        (button as HTMLButtonElement).click();
        await Promise.resolve();
      });
      expect(mocks.logout).toHaveBeenCalledTimes(1);
      expect(mocks.push).toHaveBeenCalledWith('/login');
    });
});
