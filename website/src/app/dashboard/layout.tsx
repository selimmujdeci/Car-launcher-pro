'use client';

import Sidebar from '@/components/layout/Sidebar';
import Topbar from '@/components/layout/Topbar';
import { useRealtime } from '@/hooks/useRealtime';

// Auth guard is handled server-side by middleware.ts — no localStorage needed here.
function DashboardInner({ children }: { children: React.ReactNode }) {
  useRealtime(); // starts engine, cleanup fires on unmount (zero-leak)

  return (
    <div className="flex h-screen bg-[#060d1a] overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar />
        <main className="flex-1 overflow-y-auto">
          <div className="p-6">{children}</div>
        </main>
      </div>
    </div>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return <DashboardInner>{children}</DashboardInner>;
}
