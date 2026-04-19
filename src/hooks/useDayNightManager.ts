/**
 * useDayNightManager — AGAMA Sunlight-Readability + Day/Night otomasyonu.
 *
 * 3 Katmanlı Algılama:
 *
 *   Katman 1 — AmbientLightSensor API (Android 7+ / Chrome 56+)
 *     Cihazın ışık sensöründen lux değeri okunur.
 *     ≥ 10.000 lux → direct sunlight (sunlight-mode)
 *     ≥  1.000 lux → bright outdoors   (sunlight-mode)
 *     <  1.000 lux → indoor/overcast   (normal)
 *
 *   Katman 2 — OBD Far Proxy (Katman 1 yoksa)
 *     Gündüz saatlerinde farlar açıksa (tünel/kapalı hava) sunlight-mode kapalı.
 *     Gündüz saatlerinde farlar kapalıysa muhtemelen güneşli → sunlight-mode.
 *
 *   Katman 3 — Zaman Sezgisel (Katman 1 ve 2 yoksa)
 *     09:00–17:00 → sunlight-mode tetiklenmeye aday
 *     07:00–09:00 / 17:00–19:00 → geçiş (normal)
 *     Diğer → gece (normal)
 *
 * Sunlight-Mode neden gerekli?
 *   WCAG AAA (≥7:1 kontrast) ve ISO 15008:2017 araç içi görsel standartları,
 *   direkt güneş ışığında minimum 4.5:1 kontrast oranı gerektirir.
 *   Glassmorphism blur efektleri (25px) güneş altında parlamayı artırır;
 *   bu mod onları 4px'e düşürerek hem GPU yükünü azaltır hem okunabilirliği artırır.
 *
 * Uygulama:
 *   document.documentElement.classList.add('sunlight-mode')
 *   CSS tarafı: src/styles/theme-styles.css → .sunlight-mode kuralları
 */

import { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { onOBDData } from '../platform/obdService';

/* ── Eşikler ─────────────────────────────────────────────── */

/** ALS: doğrudan güneş ışığı eşiği (lux) */
const SUNLIGHT_LUX_THRESHOLD = 1_000;
/** ALS: sensör örnekleme frekansı (Hz) */
const ALS_FREQUENCY_HZ = 0.5;

/**
 * Gündüz saati aralığı (hh) — sunlight-mode tetiklenmeye uygun saatler.
 * 07:00–19:00 tam gündüz bandı; 09:00-17:00 dar pencereydi ve sabah/akşam
 * trafiğinde (yüksek güneş açısı!) aktif olmuyordu — otomotiv güvenlik riski.
 */
const DAY_START_H = 7;
const DAY_END_H   = 19;

/* ── ALS tip tanımı (Chrome/Android WebView) ─────────────── */

interface AmbientLightSensorReading {
  illuminance: number;
  onreading:   (() => void) | null;
  onerror:     ((e: ErrorEvent) => void) | null;
  start():     void;
  stop():      void;
}

// Global scope tip genişletme — AmbientLightSensor bazı ortamlarda eksik
declare global {
  // eslint-disable-next-line @typescript-eslint/naming-convention
  interface Window { AmbientLightSensor?: new (opts: { frequency: number }) => AmbientLightSensorReading; }
}

/* ── Sunlight-Mode DOM uygulayıcı ────────────────────────── */

function applySunlightMode(on: boolean): void {
  const root = document.documentElement;
  if (on) {
    root.classList.add('sunlight-mode');
  } else {
    root.classList.remove('sunlight-mode');
  }
}

function applyDayNightDOM(mode: 'day' | 'night'): void {
  document.documentElement.setAttribute('data-day-night', mode);
  // Tek tema — dinamik stil enjeksiyonu devre dışı
}


/* ── Hook ────────────────────────────────────────────────── */

export function useDayNightManager(): void {
  const { settings, updateSettings } = useStore();

  // Mevcut far ve ALS durumunu ref ile tut (render tetiklemeden)
  const headlightsRef  = useRef(false);
  const alsActiveRef   = useRef(false);   // gerçek ALS kullanılıyor mu?

  /* ── Katman 1: AmbientLightSensor ─────────────────────── */
  useEffect(() => {
    if (!settings.autoBrightnessEnabled && !settings.autoThemeEnabled) return;

    const AlsClass = window.AmbientLightSensor;
    if (!AlsClass) return; // Android eski sürümü veya güvenlik politikası engeli

    let sensor: AmbientLightSensorReading | null = null;
    try {
      sensor = new AlsClass({ frequency: ALS_FREQUENCY_HZ });
      sensor.onreading = () => {
        if (!sensor) return;
        const isBright = sensor.illuminance >= SUNLIGHT_LUX_THRESHOLD;
        alsActiveRef.current = true;
        applySunlightMode(isBright);
      };
      sensor.onerror = () => {
        alsActiveRef.current = false;
        if (sensor) { try { sensor.stop(); } catch { /* ignore */ } }
      };
      sensor.start();
    } catch {
      // Güvenlik politikası veya desteklenmiyorsa sessizce devam et
      alsActiveRef.current = false;
    }

    return () => {
      if (sensor) { try { sensor.stop(); } catch { /* ignore */ } }
    };
  // ALS tek seferlik kurulur — autoBrightness değişiminde yeniden başlatılır
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.autoBrightnessEnabled, settings.autoThemeEnabled]);

  /* ── Katman 2: OBD Far Proxy ───────────────────────────── */
  useEffect(() => {
    const unsub = onOBDData((d) => {
      headlightsRef.current = d.headlights;
      // ALS zaten devredeyse gerek yok
      if (alsActiveRef.current) return;

      const hour       = new Date().getHours();
      const isDayHour  = hour >= DAY_START_H && hour < DAY_END_H;
      // Gündüz + farlar kapalı → muhtemelen güneşli
      if (isDayHour && !d.headlights) {
        applySunlightMode(true);
      } else {
        applySunlightMode(false);
      }
    });
    return unsub;
  }, []);

  /* ── Katman 3a: Sıfır gecikmeli dayNightMode → sunlight-mode köprüsü ─
   *
   * Problem: Zaman sezgisel 60 sn aralıklarla çalışır. Uygulama sabah 07:30'da
   * açıldığında veya settings.dayNightMode dışarıdan değiştiğinde sunlight-mode
   * 60 sn gecikebilir — güneş altında ölümcül okunaksızlık penceresi.
   *
   * Çözüm: dayNightMode store değişimine doğrudan abone ol.
   *   'day'   → applySunlightMode(true)   (ALS aktifse ALS override eder)
   *   'night' → applySunlightMode(false)  (hep kapat)
   * ─────────────────────────────────────────────────────────────────── */
  useEffect(() => {
    // ALS varsa ve aktifse o zaten okuyor — bu katman gürültü oluşturur
    if (alsActiveRef.current) return;

    if (settings.dayNightMode === 'day') {
      // Far açıksa tünel/bulutlu gün → karartma mantıklı, kapat
      applySunlightMode(!headlightsRef.current);
    } else {
      applySunlightMode(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.dayNightMode]);

  /* ── Mount: DOM'a yaz + saate göre gün/gece ayarla ─ */
  useEffect(() => {
    const h = new Date().getHours();
    const target = h >= DAY_START_H && h < DAY_END_H ? 'day' : 'night';
    applyDayNightDOM(target);
    if (settings.dayNightMode !== target) {
      updateSettings({ dayNightMode: target, theme: target === 'day' ? 'light' : 'dark' });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── dayNightMode değiştiğinde DOM'u güncelle ─ */
  useEffect(() => {
    applyDayNightDOM(settings.dayNightMode);
  }, [settings.dayNightMode]);

  /* ── Katman 3b: Zaman sezgisel + Day/Night Mode kontrolü ─ */
  useEffect(() => {
    if (!settings.autoThemeEnabled) {
      // autoTheme kapalıysa sadece sunlight-mode sınıfını kaldır (temizlik)
      if (!settings.autoBrightnessEnabled) applySunlightMode(false);
      return;
    }

    const checkTime = () => {
      const hour       = new Date().getHours();
      const isDayHour  = hour >= DAY_START_H && hour < DAY_END_H;
      const isNight    = !isDayHour;
      const targetMode = isNight ? 'night' : 'day';

      // Gün/Gece tema değişimi
      if (settings.dayNightMode !== targetMode) {
        updateSettings({
          dayNightMode: targetMode,
          theme: targetMode === 'day' ? 'light' : 'dark',
        });
        // dayNightMode değişimi Katman 3a'yı tetikler → ek applySunlightMode gerekmez
        return;
      }

      // Mod değişmedi ama ALS kapalı → periyodik onay
      if (!alsActiveRef.current) {
        // Gündüz + far kapalı → muhtemelen güneşli
        applySunlightMode(isDayHour && !headlightsRef.current);
      }
    };

    checkTime(); // Anında çalıştır

    const interval = setInterval(checkTime, 60_000);
    return () => clearInterval(interval);
  }, [
    settings.autoThemeEnabled,
    settings.autoBrightnessEnabled,
    settings.dayNightMode,
    updateSettings,
  ]);

  /* ── Temizlik: unmount'ta sunlight-mode kaldır ─────────── */
  useEffect(() => () => { applySunlightMode(false); }, []);
}
