/**
 * etaModel.ts — VARIŞ SÜRESİ tek otoritesi (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · ağ YOK · React YOK · global durum YOK.
 *
 * ── DEĞİŞEN SÖZLEŞME ────────────────────────────────────────────────────────
 * ESKİ: `ETA = kalanMesafe / (0.6 × son30sn ortalama hız + 0.4 × mevcut adımın
 * tasarım hızı)`. Yani rotanın KALANI değil, aracın ŞU ANKİ hâli modelliyordu.
 * Şehir içinde başlayıp otoyola çıkan bir rotada bu ETA'yı önce şişiriyor,
 * sonra düşürüyordu; varış saati sürekli kayıyor ve sürücünün güveni kırılıyordu.
 *
 * YENİ: ETA'nın gövdesi **rota sağlayıcısının kendi süre modelidir**
 * (`routeDurationModel.remainingRouteDurationS`). Anlık hız yalnız SINIRLI bir
 * düzeltme çarpanı üretir — modeli EZEMEZ.
 *
 * ── PAZARLIKSIZ KURALLAR ────────────────────────────────────────────────────
 *  · Araç kısa süre durunca ETA sonsuza gitmez: düzeltme çarpanı ancak araç
 *    anlamlı bir hızdayken (`MIN_CORRECTION_KMH`) uygulanır ve kırpılır.
 *  · Anlık hız sıçraması ETA'yı zıplatmaz: girdi zaten yuvarlanmış ortalama
 *    hızdır ve çarpan `[MIN_FACTOR, MAX_FACTOR]` arasına kırpılır.
 *  · Geçilen segmentlerin süresi yeniden eklenmez (kalan süre MUTLAK okunur).
 *  · Bayat rota süresi KULLANILMAZ: süre dizisinin ait olduğu revizyon aktif
 *    rota revizyonundan farklıysa durum `STALE` olur ve sayı ÜRETİLMEZ.
 *  · Düz-hat rehberliği OSRM ETA'sı gibi sunulmaz (`STRAIGHT_LINE_ESTIMATE`
 *    kaynağı asla `ROUTE_MODEL` durumunu üretemez).
 */

import type {
  RouteDurationIntegrity, RouteDurationSource,
} from './routeDurationModel';

export type EtaState =
  /** Rota süre modelinden hesaplandı — en yüksek güven. */
  | 'ROUTE_MODEL'
  /** Süre modeli yok/bozuk → mesafe ÷ hız yedeği kullanıldı (dürüstçe işaretli). */
  | 'DEGRADED_FALLBACK'
  /** Ne süre ne kullanılabilir mesafe var → sayı ÜRETİLMEZ. */
  | 'INSUFFICIENT_ROUTE_DATA'
  /** Süre verisi başka bir rota revizyonuna ait → sayı ÜRETİLMEZ. */
  | 'STALE'
  /** Navigasyon aktif değil / henüz değerlendirilmedi. */
  | 'UNKNOWN';

export const ETA_STATE_LABEL: Readonly<Record<EtaState, string>> = {
  ROUTE_MODEL:             'ROTA SÜRE MODELİ',
  DEGRADED_FALLBACK:       'YEDEK (mesafe ÷ hız)',
  INSUFFICIENT_ROUTE_DATA: 'VERİ YETERSİZ',
  STALE:                   'BAYAT ROTA SÜRESİ',
  UNKNOWN:                 'BİLİNMİYOR',
} as const;

/* ── Düzeltme çarpanı sınırları ─────────────────────────────────────────────
 * Bunlar uydurulmadı; iki somut arızadan türedi:
 *  (a) Araç kırmızı ışıkta duruyorken ortalama hız 0'a yaklaşır. Sınırsız
 *      düzeltme ETA'yı sonsuza götürürdü → alt hız kapısı (`MIN_CORRECTION_KMH`).
 *  (b) Trafikte rota modelinden belirgin yavaş gidiliyorsa ETA uzamalıdır, ama
 *      modelin tamamen yerine geçmemelidir → üst kırpma 1.5×.
 * Simetrik olmayan alt sınır (0.8) bilinçlidir: sürücüye "erken varacaksın"
 * demek, geç kalmaktan daha zararlı bir yanlıştır. */
export const ETA_MIN_FACTOR = 0.8;
export const ETA_MAX_FACTOR = 1.5;
/** Bu hızın altında düzeltme UYGULANMAZ (durma ETA'yı şişirmesin). */
export const ETA_MIN_CORRECTION_KMH = 8;

/* ══════════════════════════════════════════════════════════════════════════
 * G3 DÜZELTMESİ · HIZ KAPISI RAMPASI (kütük #538 · kök kanıtı #530)
 *
 * ── ÖLÇÜLDÜ (2026-08-11, gerçek araç · `etaJumpLedger`) ───────────────────
 *   byTrigger: SPEED_GATE_CHANGED 4 · ROUTE_REVISION 1 · BASE_DURATION_ONLY 1
 *              DISTANCE_SOURCE_CHANGED 0   ← hiç tetiklenmedi
 *   dominant : SPEED_GATE_CHANGED (4/6 = %67)
 *
 * Dört geçişin HEPSİ `factor 1 ↔ 1.5` idi ve aritmetik beklentiyle 0-8 s
 * içinde uyuştu (167→246 · 224→150 · 143→207 · 183→122). Yani dur-kalk
 * trafiğinde araç 8 km/h eşiğini her geçtiğinde düzeltme çarpanı **ANİ**
 * olarak 1 ↔ 1.5 atlıyor ve ETA %50 zıplıyordu. **Mesafe kaynağı SUÇSUZ**
 * (`distanceSource: ALONG_ROUTE` sabit) — önceki "mesafe daha şüpheli"
 * tahmini ÖLÇÜMLE ÇÜRÜTÜLDÜ.
 *
 * ── DÜZELTME ─────────────────────────────────────────────────────────────
 * Kapı artık AÇIK/KAPALI bir anahtar değil, bir RAMPADIR: çarpan eşikte 1'den
 * başlar ve bant boyunca kademeli olarak tam değerine yürür. Eşiğin TAM
 * üstünde etkisi 0 olduğu için fonksiyon eşikte SÜREKLİDİR → sıçrama
 * matematiksel olarak imkânsız hâle gelir (histerezis gibi "daha seyrek
 * sıçrama" değil, sıçramanın KENDİSİNİN kaldırılması).
 *
 * ⚠️ SAF ÇÖZÜM BİLİNÇLİ: zamana bağlı rampalama (saniye başına en fazla X)
 * bu modüle durum ve saat sokardı; `computeEta` saflığı ETA'nın test
 * edilebilirliğinin temelidir. Rampa yalnız HIZA bağlıdır → saf kalır.
 *
 * Bant genişliği eşiğin kendisi kadar (8 → 16 km/h): dur-kalk trafiğinin
 * gerçek salınım aralığı burasıdır; 16 km/h üstünde düzeltme tam uygulanır
 * ve ESKİ DAVRANIŞ BİREBİR KORUNUR (otoyol/şehir içi seyir etkilenmez).
 * ════════════════════════════════════════════════════════════════════════ */
export const ETA_GATE_RAMP_KMH = 8;

/**
 * Hız kapısının ETKİ AĞIRLIĞI (0-1) — düzeltme çarpanının ne kadarı uygulanır.
 *
 *   `<= 8 km/h`      → 0   (düzeltme yok; durma ETA'yı şişirmez)
 *   `8 → 16 km/h`    → 0→1 (kademeli)
 *   `>= 16 km/h`     → 1   (tam düzeltme — eski davranış)
 *
 * SAF: girdiden başka hiçbir şeye bakmaz. `etaJumpLedger` de bu fonksiyonu
 * kullanır → rampanın şekli TEK OTORİTEDEDİR (ikinci bir eşik doğmaz).
 */
export function etaSpeedGateWeight(rollingAvgKmh: number): number {
  if (!Number.isFinite(rollingAvgKmh)) return 0;
  const over = rollingAvgKmh - ETA_MIN_CORRECTION_KMH;
  if (over <= 0) return 0;
  if (over >= ETA_GATE_RAMP_KMH) return 1;
  return over / ETA_GATE_RAMP_KMH;
}
/** Yedek hesapta sıfıra bölmeyi engelleyen taban (mevcut davranışla aynı). */
export const ETA_FALLBACK_FLOOR_KMH = 5;

export interface EtaInput {
  /** Navigasyon ACTIVE/REROUTING mi. */
  readonly navActive: boolean;
  /** Rota süre modelinden kalan süre (sn) — `null` = üretilemedi. */
  readonly remainingRouteDurationS: number | null;
  readonly durationIntegrity: RouteDurationIntegrity;
  readonly durationSource: RouteDurationSource;
  /** Aktif rotanın revizyon numarası. */
  readonly routeRevision: number;
  /** Süre dizisinin ait olduğu revizyon. Farklıysa → STALE. */
  readonly durationRevision: number;
  /** Rota üzerinde kalan mesafe (m) — yedek hesap için. */
  readonly remainingDistanceM: number | null;
  /** Son 30 sn ağırlıklı ortalama hız (km/sa). */
  readonly rollingAvgKmh: number;
  /** Yol tipi ipucu (mevcut adımın tasarım hızı, km/sa) — yalnız YEDEK hesapta. */
  readonly roadSpeedKmh?: number;
  /** Durma tamponu (sn) — mevcut trafik davranışı korunur. */
  readonly stopBufferS: number;
}

export interface EtaVerdict {
  /** Saniye — `ROUTE_MODEL`/`DEGRADED_FALLBACK` dışında `null`. */
  readonly etaSeconds: number | null;
  readonly state: EtaState;
  readonly source: RouteDurationSource;
  /** UYGULANAN düzeltme çarpanı (1 = düzeltme yok) — rampa DAHİL. */
  readonly correctionFactor: number;
  /**
   * #538 — rampa UYGULANMADAN ÖNCEKİ ham çarpan (LAB/defter için).
   * `undefined` = düzeltme hiç hesaplanmadı (sayı üretilmeyen durumlar).
   * Ham ile uygulanan arasındaki fark, rampanın o an ne kadar yumuşattığıdır.
   */
  readonly correctionFactorRaw?: number;
  /** #538 — hız kapısının etki ağırlığı (0-1). `undefined` = hesaplanmadı. */
  readonly speedGateWeight?: number;
  /** Düzeltmesiz ham model süresi (sn) — LAB için. */
  readonly baseSeconds: number | null;
  readonly reason: string;
}

const _NO_ETA = (state: EtaState, source: RouteDurationSource, reason: string): EtaVerdict => ({
  etaSeconds: null, state, source, correctionFactor: 1, baseSeconds: null, reason,
});

function _clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * ETA hükmü.
 *
 * Sıra: aktiflik → bayatlık → rota süre modeli → yedek → veri yok.
 */
export function computeEta(input: EtaInput): EtaVerdict {
  const {
    navActive, remainingRouteDurationS, durationIntegrity, durationSource,
    routeRevision, durationRevision, remainingDistanceM, rollingAvgKmh,
    roadSpeedKmh, stopBufferS,
  } = input;

  if (!navActive) return _NO_ETA('UNKNOWN', durationSource, 'navigasyon aktif değil');

  const buffer = Number.isFinite(stopBufferS) && stopBufferS > 0 ? Math.round(stopBufferS) : 0;

  /* Bayat süre: rota değişti ama süre dizisi eski revizyona ait. Eski rotanın
     süresini yeni rotaya uygulamak sessiz bir yalandır → sayı üretilmez. */
  if (durationRevision !== routeRevision) {
    return _NO_ETA('STALE', durationSource,
      `süre dizisi rev#${durationRevision}, aktif rota rev#${routeRevision}`);
  }

  /* ── 1) ROTA SÜRE MODELİ ────────────────────────────────────────────────── */
  const modelUsable =
    durationIntegrity === 'VALID' &&
    durationSource === 'OSRM_ANNOTATION' &&
    remainingRouteDurationS !== null &&
    Number.isFinite(remainingRouteDurationS) &&
    remainingRouteDurationS >= 0;

  if (modelUsable) {
    const base = remainingRouteDurationS as number;

    /* Düzeltme: rota modelinin ima ettiği hız ile gerçekte gidilen hızın oranı.
       Yavaş gidiliyorsa (>1) ETA uzar, hızlı gidiliyorsa (<1) kısalır — ama
       her iki yönde de KIRPILIR ve modeli ezmez. */
    let factor = 1;
    let rawFactor = 1;
    /* #538: kapı bir ANAHTAR değil RAMPADIR — eşikte etki 0, bant boyunca 0→1. */
    const gateWeight = etaSpeedGateWeight(rollingAvgKmh);
    let why = 'düzeltme yok';
    if (rollingAvgKmh >= ETA_MIN_CORRECTION_KMH && base > 0
        && remainingDistanceM !== null && remainingDistanceM > 0) {
      const modelKmh = (remainingDistanceM / 1000) / (base / 3600);
      if (Number.isFinite(modelKmh) && modelKmh > 0) {
        rawFactor = _clamp(modelKmh / rollingAvgKmh, ETA_MIN_FACTOR, ETA_MAX_FACTOR);
        /* Ağırlıklı uygulama: eşiğin TAM üstünde `gateWeight = 0` → factor = 1,
           yani eşik altındaki dalla SÜREKLİ. Sahada ölçülen 1↔1.5 ANİ atlaması
           (ETA'da %50 zıplama) böylece yapısal olarak imkânsızlaşır. */
        factor = 1 + (rawFactor - 1) * gateWeight;
        why = `gözlenen ${rollingAvgKmh.toFixed(0)} km/sa · model ${modelKmh.toFixed(0)} km/sa`
            + ` · kapı rampası %${Math.round(gateWeight * 100)}`
            + (gateWeight < 1 ? ` (ham ${rawFactor.toFixed(2)} → ${factor.toFixed(2)})` : '');
      }
    } else if (rollingAvgKmh < ETA_MIN_CORRECTION_KMH) {
      why = 'araç yavaş/duruyor — düzeltme uygulanmadı (ETA şişmez)';
    }

    return {
      etaSeconds: Math.max(0, Math.round(base * factor) + buffer),
      state: 'ROUTE_MODEL',
      source: durationSource,
      correctionFactor: factor,
      correctionFactorRaw: rawFactor,
      speedGateWeight: gateWeight,
      baseSeconds: Math.round(base),
      reason: why,
    };
  }

  /* ── 2) YEDEK: mesafe ÷ hız (eski davranış, ama AÇIKÇA işaretli) ────────── */
  if (remainingDistanceM !== null && Number.isFinite(remainingDistanceM) && remainingDistanceM > 0) {
    const blended = (roadSpeedKmh !== undefined && roadSpeedKmh > 0)
      ? 0.60 * rollingAvgKmh + 0.40 * roadSpeedKmh
      : rollingAvgKmh;
    const effectiveKmh = Math.max(blended, ETA_FALLBACK_FLOOR_KMH);
    const movementS = Math.round((remainingDistanceM / 1000 / effectiveKmh) * 3600);
    return {
      etaSeconds: Math.max(0, movementS + buffer),
      state: 'DEGRADED_FALLBACK',
      source: durationSource,
      correctionFactor: 1,
      baseSeconds: movementS,
      reason: `rota süre modeli yok (${durationIntegrity}) — mesafe ÷ hız yedeği`,
    };
  }

  return _NO_ETA('INSUFFICIENT_ROUTE_DATA', durationSource,
    'ne doğrulanmış süre ne kullanılabilir mesafe var');
}
