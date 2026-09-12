'use client';

import { useEffect, useRef } from 'react';
import { createRealtimeEngine, normalizeVehicleIds, type BaseRealtimeEngine } from '@/lib/realtimeEngine';
import { NotificationEngine } from '@/lib/notificationEngine';
import { useVehicleStore } from '@/store/vehicleStore';
import { useNotificationStore } from '@/store/notificationStore';
import {
  captureCleanupGeneration,
  isCleanupGenerationCurrent,
} from '@/security/accountCleanup/cleanupLockdown';
import {
  evaluateAccountScopedCapability,
  getAccountCleanupRuntime,
} from '@/security/accountCleanup/accountCleanupRuntime';
import { attachRealtimeSyncRuntime } from '@/lib/realtime/attachRealtimeSyncRuntime';

/**
 * useRealtime — Supabase realtime aboneliğini AKTİF ARAÇ KÜMESİNE bağlar.
 *
 * ── ONARILAN KUSUR (P1) ─────────────────────────────────────────────────────
 * Hook YALNIZ mount anında çalışıyordu: kanallar o andaki araç ID'leriyle bir
 * kez kuruluyordu. `AddVehicleModal` ile sonradan bağlanan araç yalnız Zustand
 * store'a giriyor, realtime motoru yeni ID'yi HİÇ görmüyordu → yeni aracın
 * `vehicle_telemetry` / `vehicle_locations` olayları filtreye takılıyor ve araç
 * `offline` + `lat=0` + `lng=0` durumunda kalıyordu. Sayfa YENİLENİNCE yeni ID
 * ilk abone listesine girdiği için düzeliyordu — kusurun imzası buydu.
 *
 * ── ÇÖZÜM ───────────────────────────────────────────────────────────────────
 * Araç ID listesinin TEK KAYNAĞI store'dur (ikinci liste / gölge state YOK).
 * Selector KANONİK bir STRING döndürür (tekrarsız + sıralı) → referans eşitliği
 * sorunu ve "aynı küme, farklı sıra" kaynaklı gereksiz reconnect OLMAZ.
 * Küme değişince motor TEK kapıdan (`syncVehicleIds`) yeniden abone olur.
 */
export function useRealtime(): void {
  const engineRef = useRef<BaseRealtimeEngine | null>(null);

  /* TEK OTORİTE: aktif araç kümesi. Primitive (string) döndüğü için Zustand'ın
     varsayılan `Object.is` karşılaştırması yeterlidir; özel equality gerekmez. */
  const vehicleIdKey = useVehicleStore(
    (state) => normalizeVehicleIds(Object.keys(state.vehicles)).join(','),
  );

  /* 1) YAŞAM DÖNGÜSÜ: motor + izleyici. Araç kimliklerine BAĞLI DEĞİLDİR →
   *    her araç eklendiğinde motor yeniden YARATILMAZ, yalnız yeniden abone olur. */
  useEffect(() => {
    let sokuldu = false;
    let temizle: (() => void) | null = null;

    /* ── ÖLÇÜLEN KUSUR: SAYFA YENİLENİNCE EŞLEŞTİRME "DÜŞÜYORDU" (#648) ────
     * Kapı buradan SENKRON soruluyordu:
     *     const access = evaluateAccountScopedCapability('REALTIME_SUBSCRIBE');
     *     if (!access.allowed) return;
     * Oysa `evaluateAccountScopedCapability` üretim runtime'ı HENÜZ
     * YARATILMAMIŞSA `RUNTIME_UNAVAILABLE` döner ve runtime'ı yaratan/başlatan
     * çağrı BU EFEKTİN İÇİNDEDİR — yani her taze sayfa yüklemesinde kapı
     * KESİN olarak kapalıydı. Ölçüm (jsdom, temiz modül kaydı):
     *     evaluateAccountScopedCapability('REALTIME_SUBSCRIBE')
     *       → { allowed: false, code: 'RUNTIME_UNAVAILABLE' }
     * Sonuç: `initializeFromLocal()` HİÇ çalışmıyordu → `localStorage`daki
     * eşleşmiş araç store'a girmiyor, `loading` sonsuza dek `true` kalıyor ve
     * kullanıcı yeniden eşleştirmeye zorlanıyordu. Eşleştirmenin hemen ardından
     * çalışmasının sebebi, `kumanda/page.tsx`in `handlePaired` içinde
     * `initializeFromLocal()`i DOĞRUDAN çağırmasıydı — yani kusur yalnız
     * YENİLEMEDE görünüyordu; sahadaki tarif de tam buydu.
     *
     * Düzeltme: runtime ÖNCE başlatılır, kapı SONRA sorulur. Yetki modeli
     * değişmez, ikinci otorite kurulmaz. */
    const runtime = getAccountCleanupRuntime();
    const baslatFn = (runtime as { initialize?: () => Promise<unknown> }).initialize;
    let hazir: Promise<unknown>;
    try {
      hazir = typeof baslatFn === 'function'
        ? Promise.resolve(baslatFn.call(runtime)).catch(() => undefined)
        : Promise.resolve(undefined);
    } catch { hazir = Promise.resolve(undefined); }

    void hazir.then(() => {
      if (sokuldu) return;
      temizle = baglan();
    });

    return () => {
      sokuldu = true;
      temizle?.();
    };

    /** Asıl bağlanma — runtime başlatıldıktan SONRA çağrılır. */
    function baglan(): () => void {
    const cleanupGeneration = captureCleanupGeneration();
    const notifEngine  = new NotificationEngine();
    const vehicleState = useVehicleStore.getState();

    /* Yerel okuma KAPIDAN ÖNCE yapılır: eşleşmiş aracın ekranda görünmesi
       realtime yetkisine BAĞLI DEĞİLDİR (ağ/oturum gerektirmez) ve hesap
       temizliği kilidi zaten `initializeFromLocal` İÇİNDE sorulur
       (`isAccountAccessLocked`) — ikinci kapı kurulmaz. Ayrıca `loading`
       bayrağını da bu çağrı düşürür; kapı kapalıyken sonsuz "yükleniyor"
       ekranı KALMAZ. */
    vehicleState.initializeFromLocal();

    const access = evaluateAccountScopedCapability('REALTIME_SUBSCRIBE');
    if (!access.allowed) return () => { /* abonelik kurulmadı */ };

    /* TEK BOŞLUK OTORİTESİ. Motor yalnız ham sinyal üretir; "veriler güncel mi?"
       kararını YALNIZ bu runtime verir (ikinci otorite YOK). */
    const syncRuntime = attachRealtimeSyncRuntime();

    const engine = createRealtimeEngine({
      onUpdate: (update) => {
        if (!isCleanupGenerationCurrent(cleanupGeneration)) return;
        const state    = useVehicleStore.getState();   // stale closure YOK
        const existing = state.vehicles[update.vehicleId];
        // FAIL-CLOSED: bilinmeyen araç olayı UYGULANMAZ ve araç OLUŞTURULMAZ.
        if (!existing) return;
        state.applyUpdate(update);
        const events = notifEngine.process(update, existing);
        if (events.length > 0) useNotificationStore.getState().addNotifications(events);
      },
      onConnectionChange: (status) => {
        if (!isCleanupGenerationCurrent(cleanupGeneration)) return;
        useVehicleStore.getState().setConnectionStatus(status);
        // BOŞLUK KARARI BURADA VERİLMEZ: durum tek otoriteye (RealtimeSyncAuthority)
        // aktarılır. `connected` doğrudan "güncel" ANLAMINA GELMEZ — otorite
        // snapshot alıp uzlaştırana kadar LIVE olunmaz.
        syncRuntime.onConnectionStatus(status);
      },
    });
    engineRef.current = engine;

    /* İLK ABONELİK BURADA YAPILIR (#648).
     * Motor artık runtime hazır olduktan SONRA kuruluyor; (2) numaralı efekt ise
     * mount anında bir kez koşup `engineRef.current` boş olduğu için hiçbir şey
     * yapmadan dönüyor ve araç kümesi DEĞİŞMEDİĞİ sürece bir daha koşmuyordu →
     * motor kurulsa bile HİÇBİR araca abone olmuyordu. Kaynak yine TEK
     * otoritedir (store); ikinci liste tutulmaz. */
    engine.syncVehicleIds(
      normalizeVehicleIds(Object.keys(useVehicleStore.getState().vehicles)),
    );

    /* Runtime bu efektin BAŞINDA başlatıldı (bkz. #648 notu) — burada yalnız
       yetki değişimi izlenir. `useFleet` kullanmayan sayfalarda (ör. CAROS LAB)
       da otorite beslenmeye devam eder. */
    const unsubscribeRuntime = runtime.subscribe(() => {
      if (!runtime.evaluateCapability('REALTIME_SUBSCRIBE').allowed) {
        engineRef.current = null;
        // Yetki kalkınca boşluk otoritesi de durdurulur: uçuştaki snapshot'ın
        // sonucu yeni hesabın kapsamına UYGULANAMAZ.
        syncRuntime.stop();
        engine.disconnect();
      }
    });

    /* Supabase arka planda zenginleştirir. ABONELİK KARARI ARTIK BURADA DEĞİL:
       store'a araç düştüğü anda (2) numaralı efekt devreye girer — böylece
       pairing sonrası eklenen araç da sayfa yenilemeden aboneliğe katılır. */
    void vehicleState.initializeFromSupabase().catch(() => {
      // No auth / offline — local data is already displayed, no action needed
    });

    const stopWatchdog = useVehicleStore.getState().startWatchdog();

    /* ── TARAYICI BAĞLANTI SİNYALİ → TEK OTORİTE ───────────────────────────
     * ONARILAN KUSUR (telefonda ölçüldü): otorite YALNIZ realtime kanalının
     * `subscribe` durum geri çağrısıyla besleniyordu. Gerçek cihazda 60 sn'lik
     * TAM ağ kesintisinde bile o geri çağrı hiç `CLOSED` üretmedi → otorite
     * `LIVE` kaldı, `reconnectCount` 0, snapshot İSTENMEDİ ve ekran "Canlı —
     * veriler güncel" demeye devam etti; oysa sunucu 6 revizyon ilerideydi.
     * Yani boşluk tespiti doğru yazılmış ama HİÇBİR gerçek sinyale bağlı
     * değildi.
     *
     * Çözüm: tarayıcının kendi `offline`/`online` olayları AYNI otoriteye
     * aktarılır — ikinci bir otorite KURULMAZ, karar yine `RealtimeSyncAuthority`
     * tarafından verilir. `offline` → SUSPECTED_GAP, `online` → snapshot
     * uzlaştırması. Sekme öne geldiğinde de backoff kapısı yoklanır.
     */
    /**
     * KAPI: mount anındaki kuşak DEĞİL, ÇAĞRI ANINDAKİ yetki.
     *
     * ONARILAN KUSUR (telefonda ölçüldü): dinleyiciler
     * `isCleanupGenerationCurrent(cleanupGeneration)` ile mount anında
     * yakalanan kuşağa kilitliydi. Girişten sonra hesap temizlik kuşağı
     * ilerlediğinde bu karşılaştırma KALICI olarak false oluyor ve
     * `offline`/`online` olayları otoriteye HİÇ ulaşmıyordu: 9 sn'lik tam
     * kesintide durum `LIVE` kalıyor, ekran "Canlı — veriler güncel" diyordu
     * (yani D3 düzeltmesi sessizce devre dışıydı). Doğru kapı, `useFleet`'te
     * olduğu gibi çağrı anındaki yetkiyi sormaktır.
     */
    const yetkiVar = () => evaluateAccountScopedCapability('REALTIME_SUBSCRIBE').allowed;

    const onBrowserOffline = () => {
      if (!yetkiVar()) return;
      syncRuntime.onConnectionStatus('disconnected');
    };
    const onBrowserOnline = () => {
      if (!yetkiVar()) return;
      syncRuntime.onConnectionStatus('connected');
    };
    const onVisible = () => {
      if (!yetkiVar()) return;
      if (document.visibilityState === 'visible') syncRuntime.tick();
    };
    window.addEventListener('offline', onBrowserOffline);
    window.addEventListener('online', onBrowserOnline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      engineRef.current = null;
      window.removeEventListener('offline', onBrowserOffline);
      window.removeEventListener('online', onBrowserOnline);
      document.removeEventListener('visibilitychange', onVisible);
      unsubscribeRuntime();
      syncRuntime.stop();    // abort + LAB kaydı bırakılır; zombi callback YOK
      engine.disconnect();   // kuşak artar → uçuştaki geç geri çağrılar ölür
      stopWatchdog();
    };
    }
  }, []);

  /* 2) ABONELİK: araç kümesi değiştikçe. Aynı kümede `syncVehicleIds` NO-OP'tur,
   *    dolayısıyla React StrictMode'un çift efekt koşusu mükerrer kanal ÜRETMEZ. */
  useEffect(() => {
    if (!evaluateAccountScopedCapability('REALTIME_SUBSCRIBE').allowed) return;
    const engine = engineRef.current;
    if (!engine) return;
    engine.syncVehicleIds(vehicleIdKey ? vehicleIdKey.split(',') : []);
  }, [vehicleIdKey]);
}
