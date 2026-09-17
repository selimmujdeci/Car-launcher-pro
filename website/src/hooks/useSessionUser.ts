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

/**
 * F1 · `isAnonymous` EKLENDİ (ikinci abonelik AÇILMADAN).
 *
 * Arabam Cebimde artık eski anonim kimliği "giriş yapılmış" saymaz; bu ayrım
 * için oturumun `user.is_anonymous` alanı gerekir. Ayrı bir hook ikinci bir
 * `onAuthStateChange` gözlemcisi açardı (§6) ve hesap değişimi temizliğiyle
 * yarışırdı — bu yüzden alan MEVCUT kanonik gözlemciye eklenmiştir. Filo
 * sayfaları alanı yok sayar; davranışları değişmez.
 */
export function useSessionUser(): {
  userId: string | null;
  loading: boolean;
  isAnonymous: boolean;
  authError: boolean;
} {
  const [userId, setUserId]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAnonymous, setIsAnonymous] = useState(false);
  /* `SIGNED_OUT` ile "oturum SORULAMADI" aynı şey değildir (§8): ilkinde
     kullanıcıya giriş gösterilir, ikincisinde dürüst bir hata. */
  const [authError, setAuthError] = useState(false);
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
      /* Yapılandırma yoksa giriş DENENEMEZ — bu "çıkış yapılmış" değildir. */
      setAuthError(true);
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
        setIsAnonymous(data.session?.user?.is_anonymous === true);
        setLoading(false);
      }).catch(() => {
        /* Oturum okunamadı: açılış SONSUZA KADAR asılı kalmamalı, ama
           "giriş yapılmamış" da denmemeli — bilinmezlik dürüstçe taşınır. */
        if (!mountedRef.current) return;
        setAuthError(true);
        setLoading(false);
      }).finally(() => finishAuthSessionOperation(hydration));
    } else {
      /* ── AÇILIŞ ASLA ASILI KALMAZ (production kusuru, 2026-09-17) ──────
         `beginAuthSessionOperation()` NULL döner: hesap temizliği auth
         yazımlarını kilitlemişken (ör. yarıda kalmış bir çıkış) veya çok
         sayıda işlem beklerken. Eskiden bu dal HİÇ YOKTU: `loading` sonsuza
         dek `true` kalıyor, Arabam Cebimde açılış ekranında donuyordu
         (telefonda ölçüldü — spinner hiç bitmiyor).

         Oturum SORULAMADIĞI için "giriş yapılmamış" DENMEZ (§8): bilinmezlik
         `authError` ile dürüstçe taşınır, kapı da kullanıcıya kurtarma yolu
         gösterir. */
      setAuthError(true);
      setLoading(false);
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
      if (mountedRef.current) {
        setUserId(id);
        setIsAnonymous(session?.user?.is_anonymous === true);
        setAuthError(false);
        /* Oturum olayı geldiyse açılış kararı ARTIK bilinmektedir; `loading`
           asılı kalırsa PWA sonsuz açılış ekranında donardı. */
        setLoading(false);
      }
    });

    return () => {
      mountedRef.current = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return { userId, loading, isAnonymous, authError };
}
