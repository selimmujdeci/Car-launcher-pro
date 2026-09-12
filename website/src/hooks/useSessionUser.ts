'use client';

/**
 * useSessionUser — oturumdaki kullanıcı kimliği.
 *
 * Hesap değişiminde (`onAuthStateChange`) çevrimdışı durum TAMAMEN sıfırlanır:
 * önceki kullanıcının kuyruğu, snapshot'ı ve bekleyen pairing kayıtları yeni
 * oturuma SIZAMAZ.
 */

import { useEffect, useRef, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase';
import {
  beginAuthSessionOperation,
  canApplyAuthSessionOperation,
  canApplyCurrentAuthEvent,
  finishAuthSessionOperation,
} from '@/security/accountCleanup/authSessionGenerationGuard';
import { requestCanonicalAccountTransition } from
  '@/security/accountCleanup/canonicalLogout';
import {
  captureAuthCleanupTarget,
  observeAuthCleanupTarget,
} from '@/security/accountCleanup/authCleanupTarget';

export function useSessionUser(): { userId: string | null; loading: boolean } {
  const [userId, setUserId]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const lastUserRef = useRef<string | null>(null);
  /**
   * İlk auth olayı bir hesap DEĞİŞİMİ değildir.
   *
   * supabase-js abonelik kurulur kurulmaz `INITIAL_SESSION` yayınlar. O anda
   * `lastUserRef` henüz `null` olduğu için "kullanıcı değişti" sanılıyordu ve
   * her sayfa açılışında çevrimdışı durum TAMAMEN siliniyordu (telefonda
   * ölçüldü: bekleyen işlem sayfa geçişinde yok oluyor). Bu bayrak hidrasyonu
   * gerçek hesap değişiminden ayırır; hidrasyonda temizlik KAPSAM KORUMALI
   * yapılır → başka hesabın kaydı yine ayakta kalmaz.
   */
  const hydratedRef = useRef(false);
  const mountedRef  = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    if (!supabaseBrowser) {
      setLoading(false);
      return () => { mountedRef.current = false; };
    }

    const hydration = beginAuthSessionOperation();
    if (hydration) {
      void supabaseBrowser.auth.getSession().then(({ data }) => {
        if (!mountedRef.current ||
            !canApplyAuthSessionOperation(hydration)) return;
        const id = data.session?.user?.id ?? null;
        void observeAuthCleanupTarget(data.session);
        if (!hydratedRef.current) hydratedRef.current = true;
        lastUserRef.current = id;
        setUserId(id);
        setLoading(false);
      }).finally(() => finishAuthSessionOperation(hydration));
    }

    const { data: sub } = supabaseBrowser.auth.onAuthStateChange((_event, session) => {
      if (!canApplyCurrentAuthEvent()) return;
      const id = session?.user?.id ?? null;
      if (!hydratedRef.current) {
        // HİDRASYON — hesap değişimi DEĞİL; observer storage temizlemez.
        hydratedRef.current = true;
      } else if (lastUserRef.current !== id) {
        const previousAccountId = lastUserRef.current;
        if (previousAccountId && id) {
          // Observer storage silmez. Account A authority canonical coordinator
          // terminal sonucu olmadan Account B state'ine uygulanmaz.
          const previousTarget = captureAuthCleanupTarget();
          if (previousTarget?.accountId === previousAccountId) {
            void requestCanonicalAccountTransition(previousTarget, id);
          }
          return;
        }
      }
      void observeAuthCleanupTarget(session);
      lastUserRef.current = id;
      if (mountedRef.current) setUserId(id);
    });

    return () => {
      mountedRef.current = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { userId, loading };
}
