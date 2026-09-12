'use client';

import type { ReactNode } from 'react';
import { useAccountCleanupRuntime } from '@/security/accountCleanup/useAccountCleanupRuntime';

export function AccountCleanupBootGate({ children }: { children: ReactNode }) {
  const { runtime, snapshot } = useAccountCleanupRuntime();

  /* SSR/prerender: `runtime` NULL'dur ve sunucu anlık görüntüsü
     `initialized:false · bootStatus:'CHECKING'` der → aşağıdaki ilk dal
     çalışır ve güvenli ekran render edilir. Dashboard içeriği sunucuda
     ASLA sızmaz; `runtime` hiçbir zaman null iken dereference edilmez. */
  if (runtime === null || !snapshot.initialized || snapshot.bootStatus === 'CHECKING') {
    return <SecurityScreen text="Güvenli oturum durumu kontrol ediliyor." />;
  }
  if (snapshot.bootStatus === 'SAFE_TO_START') return <>{children}</>;

  if (snapshot.bootStatus === 'CLEANUP_RECOVERY_REQUIRED') {
    return (
      <SecurityScreen
        text={'Güvenli oturum temizliği tamamlanıyor. ' +
          'Araç verileri ve uzaktan komutlar geçici olarak kilitlendi.'}
        retry={() => { void runtime.retryRecovery(); }}
      />
    );
  }
  if (snapshot.bootStatus === 'AUTH_REQUIRED') {
    return (
      <SecurityScreen
        text="Araç verilerine erişmek için güvenli oturum açmanız gerekiyor."
        href="/login"
      />
    );
  }
  return (
    <SecurityScreen text="Güvenli oturum doğrulanamadı. Araç verilerine erişim kapatıldı." />
  );
}

function SecurityScreen({
  text,
  retry,
  href,
}: {
  text: string;
  retry?: () => void;
  href?: string;
}) {
  return (
    <main
      role="status"
      aria-live="polite"
      className="min-h-[100dvh] grid place-items-center bg-[#060d1a] p-6 text-white"
    >
      <div className="max-w-md text-center space-y-4">
        <p className="text-base leading-7">{text}</p>
        {retry && (
          <button
            type="button"
            onClick={retry}
            className="min-h-12 rounded-xl border border-white/20 px-5 py-3"
          >
            Güvenli temizliği yeniden dene
          </button>
        )}
        {href && (
          <a
            href={href}
            className="inline-flex min-h-12 items-center rounded-xl border border-white/20 px-5 py-3"
          >
            Oturum aç
          </a>
        )}
      </div>
    </main>
  );
}
