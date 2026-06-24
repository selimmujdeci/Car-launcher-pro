/**
 * useSafetyAlerts — Safety Assistant React hook (FAZ 2.6)
 *
 * SORUMLULUK: UnifiedVehicleStore değişimlerini dinler, computeSafetyTick'i
 * çağırır ve SafetyQueueOutput döndürür. UI render etmez, TTS/ses tetiklemez.
 *
 * LIFECYCLE GÜVENLİ QUEUE YÖNETİMİ:
 *   - Queue instance useRef ile tutulur — her render'da new ÇAĞRILMAZ.
 *   - Lazy init: ilk erişimde oluşturulur (null guard ile).
 *   - Unmount'ta useEffect cleanup → queue.reset() (debounce sayaçları temizlenir).
 *
 * TIMER YÖNETİMİ (FAZ 2.6):
 *   - tickerRef: createSafetyTicker(500ms) — React bağımsız interval kontrolcüsü.
 *   - Aktif alert yokken timer çalışmaz (perf dostu).
 *   - Aktif alert oluşunca sync(true) → timer başlar, debounce/repeat izler.
 *   - Koşul kalkınca engine 0 alert → tick false → timer kendini durdurur.
 *   - Unmount'ta ticker.dispose() → timer kaçağı yok.
 *
 * GEREKSİZ RE-RENDER AZALTMA (FAZ 2.6):
 *   safetyOutputsEqual ile derin karşılaştırma yapılır:
 *   - ts alanı KARŞILAŞTIRILMAZ (her tick değişir, içerik değil).
 *   - ruleId, length, muted, suppressed kıyaslanır.
 *   - Tüm alanlar aynıysa setOutput prev referansını korur → re-render yok.
 *
 * STALE CLOSURE ÖNLEMİ:
 *   optsRef: her render'da opts'un güncel değerini tutar.
 *   Ticker tick callback optsRef.current'ı okur → eski kapanım riski yok.
 *
 * MUTE ERİŞİMİ (Faz 3 için not):
 *   Mute işlemi queue ref'i üzerinden bağlanacak (useSafetyAlerts içinden
 *   sızdırılmaz). Faz 3 UI bileşeni queue'ya direkt erişim yerine ayrı
 *   useSafetyMute() hook'u veya context üzerinden bağlanacak.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useUnifiedVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
import { SafetyAlertQueue } from './SafetyAlertQueue';
import {
  computeSafetyTick,
  safetyOutputsEqual,
} from './safetyStateMapper';
import { createSafetyTicker } from './safetyTicker';
import type { SafetyMapOptions } from './safetyStateMapper';
import type { SafetyQueueOutput } from './types';

// ── Hook dönüş tipi ───────────────────────────────────────────────────────────
/**
 * useSafetyAlerts dönüş tipi.
 * output: mevcut SafetyQueueOutput.
 * mute: ruleId bazında sesi sustururur (SafetyProvider üzerinden erişilir).
 *
 * NOT: Bu hook artık yalnız SafetyProvider tarafından çağrılır.
 * Consumer bileşenler useSafetyContext() ile output ve mute alır.
 */
export interface UseSafetyAlertsResult {
  output: SafetyQueueOutput;
  mute: (ruleId: string) => void;
}

// ── Sabit boş çıktı (başlangıç state + "hiçbir alert yok" durumu) ─────────────
// Her render'da yeni obje oluşturmamak için modül seviyesi sabiti.
const EMPTY_OUTPUT: SafetyQueueOutput = {
  visibleAlerts: [],
  primaryBannerAlert: null,
  voiceAnnouncementAlert: null,
  muted: [],
  suppressed: [],
};

/**
 * Safety alert hook.
 *
 * @param opts - Gece/sinyal mevcudiyeti seçenekleri (stabil referans önerilir;
 *               her render'da yeni obje gönderilirse opts ref ile sarın).
 * @returns UseSafetyAlertsResult — output (SafetyQueueOutput) ve mute fonksiyonu.
 *
 * NOT: Artık yalnız SafetyProvider çağırır. Consumer bileşenler
 * useSafetyContext() ile bağlanır (tek queue, tek ticker, tek state).
 */
export function useSafetyAlerts(opts?: SafetyMapOptions): UseSafetyAlertsResult {
  // ── Queue lifecycle: her render'da new ÇAĞRILMAZ ──────────────────────────
  const queueRef = useRef<SafetyAlertQueue | null>(null);
  if (queueRef.current === null) {
    // Lazy init: ilk erişimde oluştur
    queueRef.current = new SafetyAlertQueue();
  }

  // ── Ticker lifecycle: her render'da new ÇAĞRILMAZ ─────────────────────────
  // createSafetyTicker: React-bağımsız interval kontrolcüsü.
  // tick callback useEffect içinde bağlanır (aşağıda).
  const tickerRef = useRef<ReturnType<typeof createSafetyTicker> | null>(null);

  // ── opts ref: stale closure önleme ───────────────────────────────────────
  // Ticker tick callback'i opts'a ihtiyaç duyar. Her render'da ref güncellenir
  // → tick her zaman güncel opts'u görür (useEffect deps olmadan).
  const optsRef = useRef<SafetyMapOptions | undefined>(opts);
  optsRef.current = opts; // her render'da güncelle

  // ── Çıktı state ───────────────────────────────────────────────────────────
  const [output, setOutput] = useState<SafetyQueueOutput>(EMPTY_OUTPUT);

  // ── Store subscribe ───────────────────────────────────────────────────────
  useEffect(() => {
    const queue = queueRef.current!;

    // Ticker lazy init — useEffect içinde (DOM/timer erişimi için güvenli).
    if (tickerRef.current === null) {
      tickerRef.current = createSafetyTicker(500, () => {
        // Ticker tick callback: bir interval tetiklendiğinde çalışır.
        // performance.now() ile hesapla → mapper'ın _vehicleSpeedTs saatiyle uyumlu.
        const now = performance.now();
        const v = useUnifiedVehicleStore.getState();
        const { output: next, hasActiveAlerts } = computeSafetyTick(
          queue,
          v,
          now,
          optsRef.current,
        );
        setOutput((prev) => (safetyOutputsEqual(prev, next) ? prev : next));
        // false döndürünce ticker kendini durdurur (aktif alert kalmadı).
        return hasActiveAlerts;
      });
    }

    const ticker = tickerRef.current!;

    // Yardımcı: store snapshot'ından output hesapla ve gerekiyorsa state güncelle
    function runCompute(now: number): void {
      const v = useUnifiedVehicleStore.getState();
      const { output: next, hasActiveAlerts } = computeSafetyTick(
        queue,
        v,
        now,
        optsRef.current,
      );
      // safetyOutputsEqual: ts hariç derin kıyas → gereksiz re-render önlenir
      setOutput((prev) => (safetyOutputsEqual(prev, next) ? prev : next));
      // Ticker'ı aktif alert varlığına göre başlat veya durdur
      ticker.sync(hasActiveAlerts);
    }

    // İlk değeri hemen hesapla (mount anında store snapshot'ı ile)
    runCompute(performance.now());

    // Store değişimlerini dinle
    const unsub = useUnifiedVehicleStore.subscribe(() => {
      runCompute(performance.now());
    });

    // Unmount temizliği
    return () => {
      unsub();
      ticker.dispose(); // interval kaçağı yok
      queue.reset();    // debounce/tekrar sayaçları sıfırla
    };
    // opts değişince yeniden subscribe: opts referansı dışarıdan geliyor.
    // Kullanıcı opts'u stabil tutmazsa gereksiz unsub/resub olur ama bu
    // semantik olarak doğrudur (farklı sinyal mevcudiyeti farklı davranış).
    // optsRef her render'da güncellendiği için deps listesinde olması gerekmez;
    // sadece imza değişikliklerini (isDark, seatbelt, headlights) izle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts?.isDark, opts?.signalsAvailable?.seatbelt, opts?.signalsAvailable?.headlights]);

  // mute: stabil referans (useCallback, yalnız queueRef bağımlılığı)
  // queueRef.current lazy init garantisi ile her zaman dolu → null guard yok.
  const mute = useCallback((ruleId: string) => {
    queueRef.current?.mute(ruleId);
  }, []);

  return { output, mute };
}
