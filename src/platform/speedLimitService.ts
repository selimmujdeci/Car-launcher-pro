/**
 * speedLimitService — yol hız limiti (GERÇEK veri, Overpass `maxspeed`).
 *
 * ⚠️ KALDIRILAN SAHTE SERVİS (2026-08-03): bu dosyada her 30 saniyede
 * `[30,50,70,82,90,110,120]` arasından **rastgele** limit ve rastgele yol adı
 * üreten bir servis vardı (`startSpeedLimitService` + `useSpeedLimit`) ve
 * `useLayoutServices` onu ÜRETİMDE başlatıyordu. Ekrana bağlı değildi ama
 * sürekli timer çalıştırıyor ve her an yanlışlıkla bağlanabilecek bir tuzak
 * oluşturuyordu — sürücüye uydurma hız limiti göstermek CLAUDE.md'nin
 * "kanıtsız bilgi üretilmez" kuralının en tehlikeli ihlalidir. Silindi.
 *
 * Geriye kalan tek yol GERÇEK veridir: `useSpeedLimitByLocation`.
 */

import { useState, useEffect, useRef } from 'react';

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
/** Limitin kaynağı — sürücüye DÜRÜST gösterilir. */
export type SpeedLimitSource = 'osm' | 'inferred';

export interface RoadSpeedLimit {
  /** km/h */
  kmh:    number;
  /** 'osm' = yolun `maxspeed` etiketi (levha karşılığı) ·
   *  'inferred' = yol SINIFINDAN çıkarım (levha okunmadı) */
  source: SpeedLimitSource;
}

/* ── ZENGİN GÖZLEM + TEK ÇÖZÜMLEYİCİ (MINI_MAP_…_P0) ────────────────────────
 * İKİ ARIZA kapatılır:
 *
 * (a) **Bayat levha.** Eski hook yeni yola geçildiğinde `hasLimitRef`i
 *     sıfırlıyor ama `limit` state'ini TEMİZLEMİYORDU → yeni yolun cevabı
 *     gelene kadar ÖNCEKİ YOLUN levhası ekranda kalıyordu. Değerin NEREDE ve
 *     NE ZAMAN çözüldüğü artık taşınır; `speedLimitTruthModel` bayatı eler.
 *
 * (b) **Çift ağ trafiği.** Hook'u iki bileşen (NavigationHUD + MiniMapWidget)
 *     birden mount ederse İKİ ayrı Overpass sorgu döngüsü açılıyordu — bu
 *     dosyanın kendi notlarında kullanıcı ISINMA bildirmişti. Artık çözümleyici
 *     MODÜL DÜZEYİNDE TEKTİR: ilk abone başlatır, son abone durdurur; tüm
 *     tüketiciler aynı sonucu paylaşır. İKİNCİ OTORİTE KURULMAZ. */

/** Ham gözlem — `speedLimitTruthModel.classifySpeedLimit` bunu sınıflandırır. */
export interface SpeedLimitObservationRaw {
  kmh:           number | null;
  source:        SpeedLimitSource | null;
  /** performance.now() — monotonik. */
  resolvedAtMs:  number | null;
  resolvedAtLat: number | null;
  resolvedAtLon: number | null;
  /** Aynı sorguda birden fazla FARKLI maxspeed görüldü mü. */
  conflicting:   boolean;
  /** Limitin okunduğu yolun OSM `highway` sınıfı (ör. `motorway`) — levhanın
   *  geçerlilik YARIÇAPI bundan türer (`speedLimitMaxDistanceM`). Zaten aynı
   *  Overpass yanıtında geliyordu ama taşınmıyordu; saha 2026-08-04'te sabit
   *  200 m yarıçap otoyolda levhayı zamanın %64'ünde gizliyordu. */
  highway:       string | null;
}

const _EMPTY_OBS: SpeedLimitObservationRaw = {
  kmh: null, source: null, resolvedAtMs: null,
  resolvedAtLat: null, resolvedAtLon: null, conflicting: false, highway: null,
};

let _obs: SpeedLimitObservationRaw = _EMPTY_OBS;
const _obsListeners = new Set<(o: SpeedLimitObservationRaw) => void>();

function _publish(next: SpeedLimitObservationRaw): void {
  _obs = next;
  for (const fn of [..._obsListeners]) { try { fn(next); } catch { /* fail-soft */ } }
}

/** Salt-okunur anlık gözlem (LAB / test). */
export function getSpeedLimitObservation(): SpeedLimitObservationRaw { return _obs; }

/** YALNIZ testler için. */
export function _resetSpeedLimitObservationForTest(): void { _publish(_EMPTY_OBS); }

/** Zengin gözleme abone olan React hook'u — sorgu döngüsü AÇMAZ. */
export function useSpeedLimitObservation(): SpeedLimitObservationRaw {
  const [o, setO] = useState<SpeedLimitObservationRaw>(_obs);
  useEffect(() => {
    setO(_obs);
    const fn = (n: SpeedLimitObservationRaw) => setO(n);
    _obsListeners.add(fn);
    return () => { _obsListeners.delete(fn); };
  }, []);
  return o;
}

/* ── Yol sınıfından çıkarım (Türkiye) ────────────────────────────────────────
 * OSM'de Türkiye sokaklarının çoğunda `maxspeed` etiketi YOKTUR (Tarsus
 * Bağlar Mahallesi'nde ölçüldü: 350 m çevrede 29 adlı yolun hiçbirinde yok).
 * Etiket yoksa levha HİÇ gösterilmiyordu → kart sürücüye pratikte hiç
 * çıkmıyordu.
 *
 * ⚖️ DÜRÜSTLÜK SINIRI: çıkarım BİR TAHMİNDİR, okunmuş levha değildir. Bu
 * yüzden uydurma sayılmaması için (a) `source: 'inferred'` ile İŞARETLENİR,
 * (b) arayüzde kesikli çerçeveyle AYRI gösterilir, (c) yol sınıfı bilinmiyorsa
 * hiçbir değer üretilmez (`null`). Karayolları Trafik Kanunu'nun yerleşim
 * yeri içi/dışı genel sınırları esas alınır. */
const _CLASS_LIMIT: Record<string, number> = {
  motorway:       120,
  motorway_link:   80,
  trunk:          110,
  trunk_link:      70,
  primary:         90,
  primary_link:    50,
  secondary:       90,
  secondary_link:  50,
  tertiary:        50,
  unclassified:    50,
  residential:     50,
  living_street:   20,
  service:         20,
};

/** Yol sınıfından hız limiti çıkarır; bilinmeyen sınıf → `null` (uydurma yok). */
export function inferLimitFromHighwayClass(highway?: string): number | null {
  if (!highway) return null;
  return _CLASS_LIMIT[highway] ?? null;
}

/* ── Uç noktalar ve zamanlama (cihazda ÖLÇÜLDÜ 2026-08-03) ──────────────────
 * Ölçüm (gerçek telefon, gerçek şebeke, Tarsus): `overpass-api.de` isteği
 * **10–13 sn** sürüp **HTTP 504** döndü ve gövdesi JSON değil HTML'di. Ürünün
 * o günkü hâli 4 sn'de iptal ediyordu → istek HİÇ tamamlanamıyordu; tamamlansa
 * bile `res.json()` HTML'de `SyntaxError` atıp boş `catch`e düşüyordu. Yani
 * levha kartı sürücüye YAPISAL olarak hiç çıkamıyordu. */
const _OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
] as const;

/** Uç nokta başına iptal süresi (ms).
 *  ⚠️ İLK DEĞERİM (15 sn) YANLIŞ GEREKÇEYE DAYANIYORDU: ölçülen 10–13 sn
 *  **başarısız** (504) yanıtların süresiydi; onları beklemenin bir faydası yok.
 *  ÇALIŞAN yanıt aynı uçtan **1.9 sn**'de geldi. Sınır başarı gecikmesini bol
 *  payla kapsamalı, ölü isteği uzun tutmamalı — uzun timeout telsizi boşuna
 *  açık tutar (kullanıcı ısınma bildirdi 2026-08-03). */
const _EP_TIMEOUT_MS = 8_000;
/** Limit HÂLÂ bilinmezken yeniden deneme gecikmeleri (ms). */
/* ÖLÇÜM (cihaz 2026-08-03): `overpass-api.de` aynı konumda önce **504** (9–13 sn),
   dakikalar sonra **200 / 1.9 sn** döndü — kesinti GEÇİCİ. Üç deneme bu dalgayı
   yakalamaya yetmiyordu; duran araçta kart doğmadan hak bitiyordu. */
const _RETRY_BACKOFF_MS = [1_000, 5_000, 15_000, 45_000, 120_000] as const;
/** Yeni sorgu için gereken en küçük yer değiştirme (m). */
const _REQUERY_DIST_M = 200;

/** Uçuşta kaç `useSpeedLimitByLocation` örneği sorgu sahibi — YALNIZ biri olur. */
let _resolverOwned = false;

export function useSpeedLimitByLocation(lat: number | null, lon: number | null): RoadSpeedLimit | null {
  const [limit, setLimit] = useState<RoadSpeedLimit | null>(null);
  /* TEK ÇÖZÜMLEYİCİ: aynı anda iki bileşen bu hook'u kullanırsa (tam ekran HUD
     + mini harita) İKİ Overpass döngüsü açılırdı. Yalnız ilk mount eden sorgu
     sahibi olur; diğerleri paylaşılan gözlemi okur (bkz. useSpeedLimitObservation). */
  const isOwnerRef = useRef(false);
  const [owned, setOwned] = useState(false);
  useEffect(() => {
    if (_resolverOwned) return;
    _resolverOwned = true;
    isOwnerRef.current = true;
    setOwned(true);
    return () => { if (isOwnerRef.current) { _resolverOwned = false; isOwnerRef.current = false; } };
  }, []);
  /** En güncel konum — zamanlayıcı ATEŞLENDİĞİNDE buradan okunur.
   *  Sorguyu effect closure'ına bağlamak, 1 Hz GPS akışında her tikte kurulan
   *  yeni closure'la yarışıyor ve isteğin hiç atılamamasına yol açıyordu. */
  const posRef      = useRef<{ lat: number; lon: number } | null>(null);
  const lastQueryRef = useRef<{ lat: number; lon: number } | null>(null);
  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef  = useRef(true);
  /** Bu konum için kaçıncı deneme — başarıda ve 200 m sonra sıfırlanır. */
  const attemptRef  = useRef(0);
  const hasLimitRef = useRef(false);
  /** Uçuşta istek var mı — üst üste binen sorguları önler (telsiz/ısı). */
  const inFlightRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    };
  }, []);

  useEffect(() => {
    if (!owned) return;   // sorgu sahibi değiliz → ağ trafiği AÇMA
    if (lat == null || lon == null || !Number.isFinite(lat) || !Number.isFinite(lon)) return;
    posRef.current = { lat, lon };

    /* Konum kapısı: son SORGULANAN noktadan 200 m'den az uzaklaştıysak yeni bir
       sorgu turu AÇMA.
       ⚠️ İKİ ESKİ KUSUR BURADAYDI:
       (a) kapı `prevPos`i ilk denemede yazdığı için BAŞARISIZ denemeden sonra
           da kilitliyordu → 504 alınca araç 200 m yol alana kadar bir daha
           denenmiyordu ("kart yola çıkmadan gelmedi").
       (b) zamanlayıcı her GPS tikinde sıfırlanıyordu → gecikme hiç dolmuyor,
           istek ATILAMIYORDU. Artık kurulu zamanlayıcıya DOKUNULMAZ. */
    const q = lastQueryRef.current;
    if (q) {
      const dlat  = (lat - q.lat) * 111_320;
      const dlon  = (lon - q.lon) * 111_320 * Math.cos(lat * (Math.PI / 180));
      const moved = Math.sqrt(dlat * dlat + dlon * dlon);
      if (moved >= _REQUERY_DIST_M) {
        attemptRef.current  = 0;      // yeni yol → yeni deneme hakkı
        hasLimitRef.current = false;  // yeni yolun limiti YENİDEN öğrenilmeli
      } else if (hasLimitRef.current) {
        return;                        // aynı yol + bilgi var → sorgu gereksiz
      }
    }

    // Kurulu zamanlayıcı veya uçuşta istek varsa yeni tur açma (telsiz/ısı).
    if (timerRef.current !== null || inFlightRef.current) return;

    const delay = _RETRY_BACKOFF_MS[Math.min(attemptRef.current, _RETRY_BACKOFF_MS.length - 1)];
    const epIdx = attemptRef.current % _OVERPASS_ENDPOINTS.length;
    attemptRef.current += 1;

    timerRef.current = setTimeout(async () => {
      timerRef.current    = null;
      inFlightRef.current = true;
      try {
        const p = posRef.current;
        if (!p || !mountedRef.current) return;
        lastQueryRef.current = p;

        /* `maxspeed` ŞART DEĞİL: etiketli yol yoksa sınıfından çıkarım yapılır.
           Önce maxspeed'li yol aranır (otoriter), yoksa en yakın yol sınıfı. */
        const query = `[out:json][timeout:25];way[highway](around:30,${p.lat},${p.lon});out tags 6;`;
        /* Deneme başına TEK istek; uç noktalar denemeler ARASINDA dolaşılır.
           Eskiden her denemede üç uç arka arkaya deneniyordu → tek deneme
           3 × 15 sn'ye kadar açık bağlantı (kullanıcı ısınma bildirdi). */
        const ep  = _OVERPASS_ENDPOINTS[epIdx];
        const ctrl = new AbortController();
        const t    = setTimeout(() => ctrl.abort(), _EP_TIMEOUT_MS);
        let res: Response;
        try {
          res = await fetch(`${ep}?data=${encodeURIComponent(query)}`, { signal: ctrl.signal });
        } finally { clearTimeout(t); }
        if (!mountedRef.current) return;

        /* DURUM KODU KONTROLÜ (eskiden YOKTU): Overpass aşırı yükte 504 + HTML
           döndürür; doğrudan `res.json()` `SyntaxError` atıp boş `catch`e düşüyor,
           hata ağ hatasıyla aynı sessizliğe gömülüyordu. */
        if (!res.ok) return;
        const ct = res.headers.get('content-type') ?? '';
        if (!ct.includes('json')) return;

        const data = await res.json() as { elements?: Array<{ tags?: { maxspeed?: string; highway?: string } }> };
        if (!mountedRef.current) return;
        const els = data.elements ?? [];
        /* 200 + HİÇ eleman → bölgesel arşiv olabilir (ölçüm: `overpass.osm.ch`
           745 ms'de 200 + 0 eleman; aynı sorguyu `overpass-api.de` 3 yolla
           yanıtladı). Boş yanıt bir CEVAP değildir — sıradaki denemede sıradaki
           uç noktaya geçilir. */
        if (els.length === 0) return;

        // 1) OTORİTER: gerçekten `maxspeed` etiketli yol (levha karşılığı)
        for (const el of els) {
          const ms = el.tags?.maxspeed;
          if (!ms) continue;
          const n = parseInt(ms, 10);
          if (Number.isFinite(n) && n > 0 && n <= 300) {
            hasLimitRef.current = true;
            attemptRef.current  = 0;
            /* ÇELİŞKİ TESPİTİ: aynı 30 m yarıçapında FARKLI maxspeed etiketli
               başka yol var mı? Varsa hangisinin bizim yolumuz olduğunu
               bilemeyiz → truth model bunu CONFLICTED sayıp levhayı GİZLER. */
            let conflicting = false;
            for (const other of els) {
              const om = other.tags?.maxspeed;
              if (!om) continue;
              const on = parseInt(om, 10);
              if (Number.isFinite(on) && on > 0 && on !== n) { conflicting = true; break; }
            }
            setLimit({ kmh: n, source: 'osm' });
            _publish({
              kmh: n, source: 'osm', resolvedAtMs: performance.now(),
              resolvedAtLat: p.lat, resolvedAtLon: p.lon, conflicting,
              // Limitin OKUNDUĞU yolun sınıfı — geçerlilik yarıçapı bundan türer.
              highway: el.tags?.highway ?? null,
            });
            return;
          }
        }
        // 2) ÇIKARIM: etiket yok → yol sınıfından (arayüzde AYRI gösterilir)
        for (const el of els) {
          const inf = inferLimitFromHighwayClass(el.tags?.highway);
          if (inf !== null) {
            hasLimitRef.current = true;
            attemptRef.current  = 0;
            setLimit({ kmh: inf, source: 'inferred' });
            _publish({
              kmh: inf, source: 'inferred', resolvedAtMs: performance.now(),
              resolvedAtLat: p.lat, resolvedAtLon: p.lon, conflicting: false,
              highway: el.tags?.highway ?? null,
            });
            return;
          }
        }
        /* Yol var ama sınıfı bilinmiyor → önceki değer korunur, UYDURMA YOK. */
      } catch { /* ağ hatası → önceki limit korunur; bir sonraki tik yeniden dener */ }
      finally { inFlightRef.current = false; }
    }, delay);
  }, [lat, lon, owned]);

  return limit;
}
