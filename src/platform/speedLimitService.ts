import { useState, useEffect, useRef } from 'react';

export interface SpeedLimitData {
  limit: number;      // km/h
  roadName: string;
  isOverSpeed: boolean;
}

let _currentLimit = 50;
let _roadName = "Şehir İçi Yol";
let _currentSpeed = 0;

const LIMITS = [30, 50, 70, 82, 90, 110, 120];
const ROADS = ["Dar Sokak", "Bulvar", "Ana Yol", "Çevre Yolu", "Devlet Yolu", "Otoyol", "Otoban"];

let _timer: ReturnType<typeof setInterval> | null = null;
const _listeners = new Set<(d: SpeedLimitData) => void>();

function _notify(): void {
  const snap: SpeedLimitData = {
    limit: _currentLimit,
    roadName: _roadName,
    isOverSpeed: _currentSpeed > _currentLimit,
  };
  _listeners.forEach((fn) => fn(snap));
}

export function startSpeedLimitService() {
  if (_timer) return;
  _timer = setInterval(() => {
    const idx = Math.floor(Math.random() * LIMITS.length);
    _currentLimit = LIMITS[idx];
    _roadName = ROADS[idx];
    _notify();
  }, 30000);
}

export function stopSpeedLimitService() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

export function useSpeedLimit(currentSpeed: number): SpeedLimitData {
  const [data, setData] = useState<SpeedLimitData>(() => ({
    limit: _currentLimit,
    roadName: _roadName,
    isOverSpeed: currentSpeed > _currentLimit,
  }));

  // Hız değişince hem local state hem de overSpeed'i güncelle
  useEffect(() => {
    _currentSpeed = currentSpeed;
    setData((prev) => ({ ...prev, isOverSpeed: currentSpeed > prev.limit }));
  }, [currentSpeed]);

  // Servis limit güncellemelerine abone ol
  useEffect(() => {
    const handler = (d: SpeedLimitData) => setData(d);
    _listeners.add(handler);
    return () => { _listeners.delete(handler); };
  }, []);

  return data;
}

/**
 * GPS konumuna göre gerçek zamanlı hız limiti — Overpass API (maxspeed etiketi).
 * Her 200 m'de bir sorgu atar; ağ hatası veya sonuç yoksa önceki limit korunur.
 * NavigationHUD tarafından kullanılır.
 *
 * SAHA FİX 2026-06-12: başlangıç 50 → null. Eski sabit 50 varsayılanı internetsiz/
 * yavaş bağlantıda HİÇ güncellenmiyor, sürücüye yanlış/sabit levha gösteriyordu
 * (otomotiv dürüstlüğü: veri yoksa levha HİÇ çizilmez — SpeedPanel hasLimit guard'ı).
 * İlk gerçek Overpass sonucu gelince levha görünür; sonrasında önceki değer korunur.
 */
export function useSpeedLimitByLocation(lat: number | null, lon: number | null): number | null {
  const [limit, setLimit]   = useState<number | null>(null);
  const prevPosRef          = useRef<{ lat: number; lon: number } | null>(null);
  const timerRef            = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!lat || !lon) return;
    if (prevPosRef.current) {
      const dlat = (lat - prevPosRef.current.lat) * 111_320;
      const dlon = (lon - prevPosRef.current.lon) * 111_320 * Math.cos(lat * (Math.PI / 180));
      if (Math.sqrt(dlat * dlat + dlon * dlon) < 200) return;
    }
    prevPosRef.current = { lat, lon };

    let cancelled = false;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const q    = `[out:json][timeout:3];way[highway][maxspeed](around:30,${lat},${lon});out tags 1;`;
        const url  = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(q)}`;
        const ctrl = new AbortController();
        const t    = setTimeout(() => ctrl.abort(), 4_000);
        const res  = await fetch(url, { signal: ctrl.signal });
        clearTimeout(t);
        if (cancelled) return;
        const data = await res.json() as { elements?: Array<{ tags?: { maxspeed?: string } }> };
        const ms   = data.elements?.[0]?.tags?.maxspeed;
        if (ms) {
          const n = parseInt(ms, 10);
          if (Number.isFinite(n) && n > 0 && n <= 300) setLimit(n);
        }
      } catch { /* ağ hatası → önceki limit korunur */ }
    }, 800);

    return () => { cancelled = true; };
  }, [lat, lon]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return limit;
}
