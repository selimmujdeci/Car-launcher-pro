/**
 * useDayNightAttr — KANONİK gün/gece kaynağı (`<html data-day-night>`).
 *
 * Neden bu, `settings.dayNightMode` değil:
 *   useDayNightManager `data-day-night` + `light-ui` sınıfını GÖRÜNEN gün/geceye
 *   göre ayarlar (saat/ALS/far). Kullanıcı override durumunda `settings.dayNightMode`
 *   bu DOM bayrağından AYRIŞABİLİR → kartlar light-ui ile açık ama tema paleti
 *   (settings.dayNightMode'a bağlıysa) koyu kalır (dock saati koyu görünür bug'ı).
 *
 * Bu hook tek gerçeği (`data-day-night`) reaktif okur → tema paleti, kartlar ve
 * saat HEPSI aynı görünen gün/geceyi takip eder. MutationObserver ile data-day-night
 * her değiştiğinde günceller. Zero-Leak: observer cleanup'lı.
 */
import { useEffect, useState } from 'react';

function read(): 'day' | 'night' {
  if (typeof document === 'undefined') return 'day';
  return document.documentElement.getAttribute('data-day-night') === 'night' ? 'night' : 'day';
}

export function useDayNightAttr(): 'day' | 'night' {
  const [mode, setMode] = useState<'day' | 'night'>(read);

  useEffect(() => {
    const el = document.documentElement;
    const update = () => setMode(read());
    update(); // mount'ta anlık senkron (SSR/ilk paint farkı)
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ['data-day-night'] });
    return () => obs.disconnect();
  }, []);

  return mode;
}
