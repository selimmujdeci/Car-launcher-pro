'use client';

/**
 * useRecordsSync.ts — BAKIM KAYITLARI KUYRUĞUNUN PWA TARAFINDAKİ SÜRÜCÜSÜ.
 *
 * ── NEDEN AYRI BİR HOOK ───────────────────────────────────────────────────
 * Kuyruğu boşaltan tek yer `useFleet` idi ve o hook YALNIZ `/dashboard/fleet/*`
 * sayfalarında mount ediliyor (ölçüldü: `useFleet(` çağıranların tamamı fleet
 * sayfaları). "Arabam Cebimde" (PWA `/kumanda`) onu HİÇ mount etmez → kayıt
 * kuyruğa alınsa bile telefonda hiçbir şey göndermezdi ve ekran "bağlantı
 * gelince gönderilecek" diye tutulamayacak bir söz vermiş olurdu.
 * Bu, #574'te ölçülen "mekanizma kodda var ≠ çalışıyor" sınıfının aynısıdır;
 * kuyruğa yazma ile boşaltma AYNI turda bağlanır.
 *
 * `useFleet` burada KULLANILMAZ: o hook şirket, üye ve araç listesi çeker;
 * PWA'nın bunlara ihtiyacı yok ve ağır bir bağımlılık ikinci bir otorite
 * kurardı. Buradaki tek iş kuyruğu sürmek ve durumunu DÜRÜSTÇE bildirmektir.
 *
 * Sözleşme:
 *   · timer YOK — mount'ta bir okuma + `online` olayı + elle "Şimdi gönder".
 *   · Hesap temizliği sürerken senkron BAŞLATILMAZ (`QUEUE_SYNC` kapısı).
 *   · `mountedRef` + cleanup; unmount sonrası setState YOK.
 *   · Sayılar ölçümdür: kuyruk okunamazsa 0 basılmaz, `null` döner.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getQueue, getOrchestrator, isOnline } from '@/lib/offline/fleetOffline';
import { isRecordOperation } from '@/lib/offline/recordsSyncTransport';
import { isTerminal } from '@/lib/offline/types';
import { supabaseBrowser, isSupabaseConfigured } from '@/lib/supabase';
import { evaluateAccountScopedCapability } from '@/security/accountCleanup/accountCleanupRuntime';

/**
 * Kuyruktaki tek bir kaydın kullanıcıya gösterilebilir özeti.
 *
 * Kaydın kendi içeriği (litre, tarih, kilometre) BURADA taşınmaz — ekranın
 * ihtiyacı olan tek şey hangi kaydın neden gitmediğidir; içerik zaten
 * listede görünür. Böylece hata ekranı ikinci bir veri kopyası tutmaz.
 */
export interface RecordsQueueEntry {
  id:           string;
  type:         'FUEL_LOG_ADD' | 'SERVICE_RECORD_ADD';
  status:       string;
  failureCode:  string | null;
  attemptCount: number;
  maxAttempts:  number;
  createdAt:    number;
  vehicleId:    string | null;
  clientRef:    string | null;
}

export interface RecordsSyncState {
  /** Gönderilmeyi bekleyen kayıt adedi. `null` = kuyruk okunamadı (0 DEĞİL). */
  pending:  number | null;
  /** Kalıcı olarak gönderilemeyen kayıt adedi — kullanıcı bilmelidir. */
  failed:   number | null;
  /** Gönderilemeyen kayıtların TEK TEK listesi (kullanıcı karar verebilsin). */
  failedItems: readonly RecordsQueueEntry[];
  syncing:  boolean;
  /** Elle tetikleme; çevrimdışıyken hiçbir şey yapmaz. */
  syncNow:  () => Promise<void>;
  /** Tek bir kaydı yeniden sıraya alır (deneme sayacı sıfırlanır). */
  retryItem:   (id: string) => Promise<void>;
  /** Kullanıcı vazgeçti — kayıt bir daha gönderilmez, cihazda kalır. */
  discardItem: (id: string) => Promise<void>;
  /** Sayaçları kuyruğun mevcut hâlinden yeniden okur. */
  refresh:  () => Promise<void>;
}

async function resolveUserId(): Promise<string | null> {
  if (!isSupabaseConfigured || !supabaseBrowser) return null;
  try {
    const { data } = await supabaseBrowser.auth.getSession();
    const id = data.session?.user?.id;
    return typeof id === 'string' && id !== '' ? id : null;
  } catch { return null; }
}

/** Terminal kabul edilen ama kullanıcının müdahale edebileceği durumlar. */
function isFailedStatus(status: string): boolean {
  return status === 'PERMANENT_FAILED' || status === 'EXPIRED' || status === 'CONFLICT';
}

export function useRecordsSync(): RecordsSyncState {
  const [pending, setPending] = useState<number | null>(null);
  const [failed,  setFailed]  = useState<number | null>(null);
  const [failedItems, setFailedItems] = useState<readonly RecordsQueueEntry[]>([]);
  const [syncing, setSyncing] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const refresh = useCallback(async () => {
    const userId = await resolveUserId();
    if (!mounted.current) return;
    if (!userId) {
      // Oturum yok → kayıtlar zaten kuyruğa alınmıyor. Bu ölçülmüş 0'dır.
      setPending(0);
      setFailed(0);
      setFailedItems([]);
      return;
    }
    try {
      const items = await getQueue(userId).all();
      if (!mounted.current) return;
      const records = items.filter((i) => isRecordOperation(i.operationType));
      setPending(records.filter((i) => !isTerminal(i.status) && i.status !== 'CONFLICT').length);

      const broken = records.filter((i) => isFailedStatus(i.status));
      setFailed(broken.length);
      setFailedItems(broken.map((i) => ({
        id:           i.id,
        type:         i.operationType as RecordsQueueEntry['type'],
        status:       i.status,
        failureCode:  i.failureCode,
        attemptCount: i.attemptCount,
        maxAttempts:  i.maxAttempts,
        createdAt:    i.createdAt,
        vehicleId:    i.vehicleId,
        clientRef:    typeof i.payload.clientRef === 'string' ? i.payload.clientRef : null,
      })));
    } catch {
      // Kuyruk okunamadı → sahte 0 basmak "her şey gitti" iddiasıdır.
      if (!mounted.current) return;
      setPending(null);
      setFailed(null);
      setFailedItems([]);
    }
  }, []);

  const syncNow = useCallback(async () => {
    if (!isOnline()) return;
    const userId = await resolveUserId();
    if (!userId || !mounted.current) return;

    // Hesap temizliği/recovery sürerken hesap kapsamlı iş başlatılmaz.
    const access = evaluateAccountScopedCapability('QUEUE_SYNC');
    if (!access.allowed) return;

    setSyncing(true);
    try {
      await getOrchestrator(userId).drain();
    } catch {
      /* fail-soft: senkron turu düşse de ekran çalışmaya devam eder */
    } finally {
      if (mounted.current) setSyncing(false);
    }

    // Kuşak değiştiyse (çıkış / hesap değişimi) sayaçlar yazılmaz.
    const current = evaluateAccountScopedCapability('QUEUE_SYNC');
    if (!current.allowed || current.generation !== access.generation) return;
    await refresh();
  }, [refresh]);

  /**
   * Tek kaydı yeniden dener. `retry()` deneme sayacını sıfırlar ve öğeyi
   * PENDING'e çeker; ardından hemen bir tur sürülür — kullanıcı "yeniden
   * dene"ye bastıysa sonucu ŞİMDİ görmek ister.
   */
  const retryItem = useCallback(async (id: string) => {
    const userId = await resolveUserId();
    if (!userId || !mounted.current) return;
    if (!evaluateAccountScopedCapability('QUEUE_SYNC').allowed) return;
    try {
      await getQueue(userId).retry(id);
    } catch { /* fail-soft */ }
    await syncNowRef.current();
  }, []);

  /**
   * Kullanıcı vazgeçti. Kuyruk öğesi iptal edilir — kayıt CİHAZDA KALIR
   * ama bir daha gönderilmez. Yerel kaydı da silmek veri kaybı olurdu;
   * silmek isteyen kullanıcı listedeki Sil düğmesini kullanır.
   */
  const discardItem = useCallback(async (id: string) => {
    const userId = await resolveUserId();
    if (!userId || !mounted.current) return;
    if (!evaluateAccountScopedCapability('QUEUE_SYNC').allowed) return;
    try {
      await getQueue(userId).cancel(id);
    } catch { /* fail-soft */ }
    await refresh();
  }, [refresh]);

  const syncRef     = useRef(syncNow);
  const syncNowRef  = useRef(syncNow);
  useEffect(() => { syncRef.current = syncNow; syncNowRef.current = syncNow; }, [syncNow]);

  useEffect(() => {
    void refresh();
    // Bekleyen kayıt varsa açılışta bir kez gönderilmeyi dener — kullanıcının
    // "Şimdi gönder"e basmasını beklemek, verdiğimiz sözü ertelemektir.
    void syncRef.current();

    const onOnline = () => { void syncRef.current(); };
    window.addEventListener('online', onOnline);
    return () => { window.removeEventListener('online', onOnline); };
  }, [refresh]);

  return { pending, failed, failedItems, syncing, syncNow, retryItem, discardItem, refresh };
}

/** Kuyruk hata kodunu kullanıcının anlayacağı Türkçeye çevirir (uydurma YOK). */
export function queueFailureMessage(entry: RecordsQueueEntry): string {
  if (entry.status === 'EXPIRED') {
    return 'Kayıt çok uzun süre gönderilemedi ve geçerliliğini yitirdi.';
  }
  switch (entry.failureCode) {
    case 'network_error':   return 'Bağlantı kurulamadı.';
    case 'permission_denied': return 'Bu aracın kayıtlarına yazma yetkiniz yok.';
    case 'vehicle_not_found': return 'Araç bulunamadı — eşleştirme kopmuş olabilir.';
    case 'invalid_request': return 'Kayıt sunucu tarafından geçersiz bulundu.';
    case 'server_error':    return 'Sunucu yanıt vermedi.';
    case null:              return 'Gönderilemedi (gerekçe kaydedilmemiş).';
    default:                return `Gönderilemedi (${entry.failureCode}).`;
  }
}
