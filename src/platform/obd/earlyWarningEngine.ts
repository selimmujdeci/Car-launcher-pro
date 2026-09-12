/**
 * earlyWarningEngine — P0-OBD-04 · DTC'DEN ÖNCE ÖLÇÜLEBİLİR BOZULMA (SAF).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React importu YOK.
 * Tüm girdi çağırandan gelir; aynı girdi her zaman aynı çıktıyı verir.
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * Mevcut `predictionEngine` bir sinyalin EŞİĞE NE ZAMAN VARACAĞINI hesaplar
 * (aşırı ısınma, akü düşüşü). Ama arızaların çoğu eşiğe koşmaz: yakıt trimi
 * aylarca ±%14'te durur, EGR yavaşça tıkanır, termostat açık kalır. Bunlar
 * "ne zaman patlar" değil, **"normalden ne kadar ve NE KADAR SÜREDİR sapıyor"**
 * sorularıdır. Bu modül o ikinci soruyu yanıtlar ve `predictionEngine`in trend
 * matematiğini (`fitTrend`) YENİDEN KULLANIR — paralel bir sistem KURMAZ.
 *
 * ── TEK ÖLÇÜMLE TEŞHİS YOK (pazarlıksız) ──────────────────────────────────
 * Her kural pencere içindeki **MEDYAN** üzerinden karar verir, anlık değer
 * üzerinden DEĞİL. Medyan tek bir sıçramayı (enjektör tıklaması, ECU'nun geçici
 * zenginleştirmesi, adaptör glitch'i) yapısal olarak yutar. Ek olarak:
 *   · asgari GÖZLEM SÜRESİ (`minDwellMs`) dolmadan hüküm verilmez,
 *   · koşulun pencerede ne kadarını kapladığı (`dwellFraction`) ölçülür,
 *   · ilişkili sinyaller varsa DESTEK olarak aranır.
 *
 * ── "BİLMİYORUM" BİR SONUÇTUR ─────────────────────────────────────────────
 * Desteklenmeyen PID **NORMAL SAYILMAZ**. Gerekli sinyallerden biri yoksa hüküm
 * `SIGNAL_MISSING`, örneklem yetersizse `INSUFFICIENT_DATA` olur — ikisi de
 * `NORMAL`den AYRIDIR ve hangi sinyalin eksik olduğu adıyla bildirilir.
 * Çağıran YALNIZ `LIVE` ölçüm besler (bkz. `readLiveObdSignal`); bayat veri bu
 * modüle hiç ulaşmaz.
 *
 * ── DİL: "ARIZA VAR" DEMEYİZ ──────────────────────────────────────────────
 * Seviyeler `WATCH` (izle) ve `ATTENTION` (dikkat). Kesin teşhis dili
 * KULLANILMAZ; her hüküm hangi ölçüme dayandığını taşır (`evidence`) ki Mavi
 * gerekçeyi okuyabilsin ve kullanıcı körü körüne inanmasın.
 */

import { fitTrend, MIN_TREND_SAMPLES, type TrendSample } from './predictionEngine';
import type { CanonicalObdKey } from './canonicalObdSignals';

/* ── Türler ───────────────────────────────────────────────────────────────── */

export type EarlyWarningId =
  | 'fuel_trim_drift'
  | 'fuel_trim_bank_imbalance'
  | 'egr_flow_fault'
  | 'charging_system_weak'
  | 'thermostat_stuck_open'
  | 'catalyst_overtemp'
  | 'oil_overheat_trend'
  | 'intake_temp_implausible';

/**
 * Hüküm. `NORMAL` ile `SIGNAL_MISSING` / `INSUFFICIENT_DATA` BİRLEŞTİRİLMEZ:
 * "ölçtük, iyi" ile "ölçemedik" tamamen farklı iki gerçektir ve ikincisini
 * birincisi sanmak, sessiz körlüğün ta kendisidir.
 */
export type EarlyWarningVerdict =
  | 'NORMAL'
  | 'WATCH'
  | 'ATTENTION'
  | 'INSUFFICIENT_DATA'
  | 'SIGNAL_MISSING';

export interface EarlyWarningEvidence {
  /** Ölçümün kanonik anahtarı. */
  readonly key: CanonicalObdKey;
  /** Türkçe kısa ad. */
  readonly label: string;
  /** Pencere MEDYANI (anlık değer DEĞİL). */
  readonly median: number;
  readonly unit: string;
  /** Bu sinyalden kaç örnek kullanıldı. */
  readonly samples: number;
}

export interface EarlyWarningResult {
  readonly id: EarlyWarningId;
  readonly title: string;
  readonly verdict: EarlyWarningVerdict;
  /**
   * Güven 0..1. TEK SİNYALLİ kuralda tavan `SINGLE_SIGNAL_CONFIDENCE_CAP`,
   * ilişkili sinyalle desteklenende `CROSS_SIGNAL_CONFIDENCE_CAP`. ASLA 1.0
   * olmaz — bu bir teşhis değil, erken belirtidir.
   */
  readonly confidence: number;
  /** Kullanıcıya/Mavi'ye gösterilecek GEREKÇE — ölçüme dayanır, iddiaya değil. */
  readonly reason: string;
  /** Hükmü doğuran ölçümler. `NORMAL`de de doldurulur (şeffaflık). */
  readonly evidence: readonly EarlyWarningEvidence[];
  /** Eksik olan gerekli sinyaller (yalnız `SIGNAL_MISSING`de dolu). */
  readonly missing: readonly CanonicalObdKey[];
  /** Koşulun pencerede kapladığı oran 0..1 (`NORMAL`de 0 olabilir). */
  readonly dwellFraction: number;
  /** Kullanılan gözlem penceresi (ms) — kanıtın YAŞI değil, SÜRESİ. */
  readonly observedMs: number;
}

/** Bir sinyalin gözlem penceresi. Çağıran YALNIZ `LIVE` ölçüm ekler. */
export interface SignalWindow {
  /** Araç bu sinyali VERİYOR mu (en az bir gerçek ölçüm geldi mi). */
  readonly available: boolean;
  readonly samples: readonly TrendSample[];
}

export interface EarlyWarningInput {
  /** Kanonik anahtar → pencere. Anahtar YOKSA sinyal de yoktur. */
  readonly windows: ReadonlyMap<CanonicalObdKey, SignalWindow>;
  /**
   * Motor ÇALIŞIYOR mu. `null` = bilinmiyor → motor durumuna bağlı kurallar
   * FAIL-CLOSED susar (kontak kapalıyken düşük voltaj NORMALDİR).
   */
  readonly engineRunning: boolean | null;
}

/* ── Sabitler ─────────────────────────────────────────────────────────────── */

/** Tek sinyale dayanan hükmün güven TAVANI — teşhis değil, belirtidir. */
export const SINGLE_SIGNAL_CONFIDENCE_CAP = 0.60;
/** İlişkili sinyalle DESTEKLENEN hükmün güven tavanı. */
export const CROSS_SIGNAL_CONFIDENCE_CAP = 0.85;
/** Bu güvenin altında hüküm YAYINLANMAZ (`INSUFFICIENT_DATA`). */
export const MIN_EMIT_CONFIDENCE = 0.35;
/** Koşul pencerenin en az bu kadarını kaplamalı — anlık sapma hüküm doğurmaz. */
export const MIN_DWELL_FRACTION = 0.6;
/** `ATTENTION` için gereken kaplama oranı — neredeyse kesintisiz. */
export const ATTENTION_DWELL_FRACTION = 0.85;

/* ── Yardımcılar (saf) ────────────────────────────────────────────────────── */

/** Medyan — tek sıçramayı yapısal olarak yutar (ortalama yutmaz). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const a = [...values].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 === 1 ? a[m]! : (a[m - 1]! + a[m]!) / 2;
}

/** Pencere süresi (ms) — tek örnekte 0. */
function _spanMs(s: readonly TrendSample[]): number {
  return s.length < 2 ? 0 : s[s.length - 1]!.t - s[0]!.t;
}

/** Koşulu sağlayan örneklerin ORANI 0..1. */
function _dwell(s: readonly TrendSample[], pred: (v: number) => boolean): number {
  if (s.length === 0) return 0;
  let n = 0;
  for (const x of s) if (pred(x.value)) n++;
  return n / s.length;
}

function _values(s: readonly TrendSample[]): number[] {
  return s.map((x) => x.value);
}

/* ── Kural sözlüğü ────────────────────────────────────────────────────────── */

interface RuleDef {
  readonly id: EarlyWarningId;
  readonly title: string;
  /** Bu sinyaller OLMADAN hüküm verilemez. */
  readonly requires: readonly CanonicalObdKey[];
  /** Varsa güveni artıran, yoksa hükmü ENGELLEMEYEN sinyaller. */
  readonly supports: readonly CanonicalObdKey[];
  /** Asgari gözlem süresi — bu kadar sürmeden hüküm YOK. */
  readonly minDwellMs: number;
  /** Motorun çalışıyor olması ŞART mı. */
  readonly needsEngineRunning: boolean;
  readonly evaluate: (c: RuleContext) => RuleOutcome;
}

interface RuleContext {
  readonly get: (k: CanonicalObdKey) => SignalWindow | undefined;
  readonly med: (k: CanonicalObdKey) => number;
  readonly observedMs: number;
}

interface RuleOutcome {
  /** Sapma var mı (yoksa `NORMAL`). */
  readonly deviating: boolean;
  /** `ATTENTION` bandına girdi mi (yalnız `deviating` iken anlamlı). */
  readonly severe: boolean;
  /** Koşulun pencerede kapladığı oran. */
  readonly dwellFraction: number;
  /** Türkçe gerekçe (ölçüm değerleriyle). */
  readonly reason: string;
  /** İlişkili sinyal hükmü DESTEKLİYOR mu (güven tavanını yükseltir). */
  readonly corroborated: boolean;
  /** Gösterilecek ölçümler. */
  readonly evidence: readonly EarlyWarningEvidence[];
  /**
   * Kural KENDİ ön koşulunu sağlamıyorsa (ör. EGR hiç komutlanmıyor) hüküm
   * `NORMAL` DEĞİL `INSUFFICIENT_DATA` olmalıdır — "ölçtük iyi" demek yalan olur.
   */
  readonly inconclusive?: string;
}

function ev(
  key: CanonicalObdKey, label: string, med: number, unit: string, samples: number,
): EarlyWarningEvidence {
  return { key, label, median: Number(med.toFixed(2)), unit, samples };
}

/* Eşikler: hepsi SAE J1979 pratiğinde yerleşik "incele" bantlarıdır ve DTC
   eşiklerinin ALTINDA seçilmiştir — amaç kod yanmadan önce görmektir. */
const LTFT_WATCH = 10;      // %  — sektörde yerleşik "incele" çizgisi
const LTFT_HIGH  = 18;      // %  — DTC bandının (~%25) altında
const BANK_WATCH = 8;       // %  bankalar arası fark
const BANK_HIGH  = 15;      // %
const EGR_ERR_WATCH = 20;   // %
const EGR_ERR_HIGH  = 35;   // %
const EGR_MIN_COMMANDED = 5;// % — bunun altında "hata" ölçüsü anlamsızdır
const CHARGE_WATCH = 13.0;  // V  — çalışan motorda şarj gerilimi bunun üstünde olmalı
const CHARGE_HIGH  = 12.6;  // V  — akü boşalıyor demektir
const WARMUP_MIN_RUNTIME_S = 600;  // 10 dk
const WARMUP_WATCH_C = 70;  // °C
const WARMUP_HIGH_C  = 60;  // °C
const WARMUP_MIN_AMBIENT_C = 0;    // donma altında yavaş ısınma NORMALDİR
const CAT_WATCH_C = 900;    // °C
const CAT_HIGH_C  = 950;    // °C
const OIL_WATCH_C = 125;    // °C
const OIL_HIGH_C  = 135;    // °C
const IAT_BELOW_AMBIENT_C = 10;    // °C — emme havası ortamdan bu kadar soğuk olamaz

const RULES: readonly RuleDef[] = [
  {
    id: 'fuel_trim_drift',
    title: 'Yakıt karışımı sapması',
    requires: ['longFuelTrimB1'],
    supports: ['shortFuelTrimB1', 'maf', 'manifoldPressure'],
    minDwellMs: 120_000,
    needsEngineRunning: true,
    evaluate: (c) => {
      const w = c.get('longFuelTrimB1')!;
      const m = c.med('longFuelTrimB1');
      const lean = m > 0;
      const dwell = _dwell(w.samples, (v) => Math.abs(v) > LTFT_WATCH);
      const stft = c.get('shortFuelTrimB1');
      const stftMed = stft ? c.med('shortFuelTrimB1') : Number.NaN;
      /* DESTEK: kısa dönem trim AYNI yönde sapıyorsa ECU hâlâ aktif olarak
         düzeltiyor demektir — sapma "öğrenilmiş ve oturmuş" değil, SÜRÜYOR. */
      const corroborated = Number.isFinite(stftMed) && Math.sign(stftMed) === Math.sign(m)
        && Math.abs(stftMed) > 3;
      const evidence = [ev('longFuelTrimB1', 'Uzun dönem yakıt trim (B1)', m, '%', w.samples.length)];
      if (Number.isFinite(stftMed)) {
        evidence.push(ev('shortFuelTrimB1', 'Kısa dönem yakıt trim (B1)', stftMed, '%',
          stft!.samples.length));
      }
      return {
        deviating: Math.abs(m) > LTFT_WATCH,
        severe: Math.abs(m) > LTFT_HIGH,
        dwellFraction: dwell,
        corroborated,
        reason: `Uzun dönem yakıt trimi ${(c.observedMs / 60_000).toFixed(0)} dakikadır `
          + `medyan %${m.toFixed(1)} (${lean ? 'fakir — ECU yakıt EKLİYOR' : 'zengin — ECU yakıt KISIYOR'}). `
          + `Normal bant ±%${LTFT_WATCH}.`
          + (corroborated ? ` Kısa dönem trim de aynı yönde (%${stftMed.toFixed(1)}) — sapma sürüyor.` : ''),
        evidence,
      };
    },
  },
  {
    id: 'fuel_trim_bank_imbalance',
    title: 'Bankalar arası karışım farkı',
    requires: ['longFuelTrimB1', 'longFuelTrimB2'],
    supports: [],
    minDwellMs: 120_000,
    needsEngineRunning: true,
    evaluate: (c) => {
      const b1 = c.med('longFuelTrimB1');
      const b2 = c.med('longFuelTrimB2');
      const diff = Math.abs(b1 - b2);
      const w1 = c.get('longFuelTrimB1')!;
      const w2 = c.get('longFuelTrimB2')!;
      /* Fark iki AYRI sinyalden gelir; kaplama oranını ikisinin de sapma
         gösterdiği örnek oranıyla değil, farkın kendi büyüklüğüyle ölçemeyiz —
         bu yüzden her iki bankanın da yeterli örnekle temsil edilmesi şart
         koşulur ve kaplama, daha zayıf bankanın kaplaması sayılır. */
      const dwell = Math.min(
        _dwell(w1.samples, () => true),
        _dwell(w2.samples, () => true),
      ) * (diff > BANK_WATCH ? 1 : 0);
      return {
        deviating: diff > BANK_WATCH,
        severe: diff > BANK_HIGH,
        dwellFraction: dwell,
        corroborated: true,   // iki bağımsız sinyalin KIYASI zaten çapraz kontroldür
        reason: `Banka 1 uzun dönem trimi medyan %${b1.toFixed(1)}, Banka 2 %${b2.toFixed(1)} — `
          + `aradaki fark %${diff.toFixed(1)}. Tek taraflı bir kaçak, enjektör ya da `
          + `lambda sensörü farkı bu izi bırakır.`,
        evidence: [
          ev('longFuelTrimB1', 'Uzun dönem trim (B1)', b1, '%', w1.samples.length),
          ev('longFuelTrimB2', 'Uzun dönem trim (B2)', b2, '%', w2.samples.length),
        ],
      };
    },
  },
  {
    id: 'egr_flow_fault',
    title: 'EGR akış sapması',
    requires: ['egrError', 'egrCommanded'],
    supports: [],
    minDwellMs: 120_000,
    needsEngineRunning: true,
    evaluate: (c) => {
      const err = c.med('egrError');
      const cmd = c.med('egrCommanded');
      const w = c.get('egrError')!;
      /* ÖN KOŞUL: EGR hiç komutlanmıyorsa "hata" ölçüsü fiziksel olarak
         anlamsızdır. Bunu `NORMAL` saymak "EGR sağlam" demek olurdu — oysa
         hiç denenmemiştir. */
      if (cmd < EGR_MIN_COMMANDED) {
        return {
          deviating: false, severe: false, dwellFraction: 0, corroborated: false,
          reason: `EGR bu pencerede neredeyse hiç komutlanmadı (medyan %${cmd.toFixed(1)}) — `
            + `hata ölçüsü anlamlı değil.`,
          evidence: [ev('egrCommanded', 'Komutlanan EGR', cmd, '%', c.get('egrCommanded')!.samples.length)],
          inconclusive: 'EGR komutlanmadığı için değerlendirilemedi',
        };
      }
      const dwell = _dwell(w.samples, (v) => Math.abs(v) > EGR_ERR_WATCH);
      return {
        deviating: Math.abs(err) > EGR_ERR_WATCH,
        severe: Math.abs(err) > EGR_ERR_HIGH,
        dwellFraction: dwell,
        corroborated: true,   // komut ↔ gerçekleşen KIYASI çapraz kontroldür
        reason: `EGR %${cmd.toFixed(0)} komutlanırken hata medyanı %${err.toFixed(1)}. `
          + `Komut ile gerçekleşen arasındaki bu fark tıkalı ya da sıkışmış valfin izidir.`,
        evidence: [
          ev('egrError', 'EGR hatası', err, '%', w.samples.length),
          ev('egrCommanded', 'Komutlanan EGR', cmd, '%', c.get('egrCommanded')!.samples.length),
        ],
      };
    },
  },
  {
    id: 'charging_system_weak',
    title: 'Şarj sistemi zayıf',
    requires: ['moduleVoltage'],
    supports: [],
    minDwellMs: 90_000,
    needsEngineRunning: true,
    evaluate: (c) => {
      const v = c.med('moduleVoltage');
      const w = c.get('moduleVoltage')!;
      const dwell = _dwell(w.samples, (x) => x < CHARGE_WATCH);
      return {
        deviating: v < CHARGE_WATCH,
        severe: v < CHARGE_HIGH,
        dwellFraction: dwell,
        corroborated: false,   // tek sinyal → güven tavanı düşük kalır
        reason: `Motor çalışırken kontrol ünitesi voltajı medyan ${v.toFixed(1)} V. `
          + `Sağlıklı bir şarj sisteminde bu değer ${CHARGE_WATCH} V üstünde olur; `
          + `altında kalması alternatör ya da kayış/bağlantı tarafını işaret eder.`,
        evidence: [ev('moduleVoltage', 'Kontrol ünitesi voltajı', v, 'V', w.samples.length)],
      };
    },
  },
  {
    id: 'thermostat_stuck_open',
    title: 'Motor çalışma sıcaklığına ulaşmıyor',
    requires: ['coolantTemp', 'engineRunTime', 'ambientTemp'],
    supports: [],
    minDwellMs: 120_000,
    needsEngineRunning: true,
    evaluate: (c) => {
      const t = c.med('coolantTemp');
      const rt = c.med('engineRunTime');
      const amb = c.med('ambientTemp');
      const w = c.get('coolantTemp')!;
      /* ÖN KOŞULLAR: motor yeterince uzun çalışmış olmalı ve hava donun
         üstünde olmalı. Aksi hâlde düşük sıcaklık NORMALDİR. */
      if (rt < WARMUP_MIN_RUNTIME_S || amb < WARMUP_MIN_AMBIENT_C) {
        return {
          deviating: false, severe: false, dwellFraction: 0, corroborated: false,
          reason: rt < WARMUP_MIN_RUNTIME_S
            ? `Motor bu pencerede yalnız ${Math.round(rt / 60)} dakikadır çalışıyor — `
              + `ısınma değerlendirmesi için en az ${WARMUP_MIN_RUNTIME_S / 60} dakika gerekir.`
            : `Dış hava ${amb.toFixed(0)} °C — donma altında yavaş ısınma normaldir, hüküm verilmedi.`,
          evidence: [
            ev('coolantTemp', 'Soğutma sıvısı', t, '°C', w.samples.length),
            ev('engineRunTime', 'Motor çalışma süresi', rt, 's', c.get('engineRunTime')!.samples.length),
          ],
          inconclusive: 'Isınma penceresi henüz oluşmadı',
        };
      }
      const dwell = _dwell(w.samples, (x) => x < WARMUP_WATCH_C);
      return {
        deviating: t < WARMUP_WATCH_C,
        severe: t < WARMUP_HIGH_C,
        dwellFraction: dwell,
        corroborated: true,   // üç sinyalin BİRLİKTE değerlendirilmesi
        reason: `Motor ${Math.round(rt / 60)} dakikadır çalışıyor ve dış hava ${amb.toFixed(0)} °C `
          + `olmasına rağmen soğutma sıvısı medyan ${t.toFixed(0)} °C'de kalıyor. `
          + `Açık kalmış bir termostat bu izi bırakır; yakıt tüketimi ve kabin ısıtması etkilenir.`,
        evidence: [
          ev('coolantTemp', 'Soğutma sıvısı', t, '°C', w.samples.length),
          ev('engineRunTime', 'Motor çalışma süresi', rt, 's', c.get('engineRunTime')!.samples.length),
          ev('ambientTemp', 'Dış hava', amb, '°C', c.get('ambientTemp')!.samples.length),
        ],
      };
    },
  },
  {
    id: 'catalyst_overtemp',
    title: 'Katalizör sıcaklığı yüksek',
    requires: ['catTempB1S1'],
    supports: ['longFuelTrimB1'],
    minDwellMs: 60_000,
    needsEngineRunning: true,
    evaluate: (c) => {
      const t = c.med('catTempB1S1');
      const w = c.get('catTempB1S1')!;
      const dwell = _dwell(w.samples, (x) => x > CAT_WATCH_C);
      const ltft = c.get('longFuelTrimB1') ? c.med('longFuelTrimB1') : Number.NaN;
      const corroborated = Number.isFinite(ltft) && Math.abs(ltft) > LTFT_WATCH;
      const evidence = [ev('catTempB1S1', 'Katalizör sıcaklığı (B1S1)', t, '°C', w.samples.length)];
      if (Number.isFinite(ltft)) {
        evidence.push(ev('longFuelTrimB1', 'Uzun dönem yakıt trim (B1)', ltft, '%',
          c.get('longFuelTrimB1')!.samples.length));
      }
      return {
        deviating: t > CAT_WATCH_C,
        severe: t > CAT_HIGH_C,
        dwellFraction: dwell,
        corroborated,
        reason: `Katalizör sıcaklığı medyan ${t.toFixed(0)} °C. Sürekli ${CAT_WATCH_C} °C üstü, `
          + `katalizöre yanmamış yakıt gittiğine işaret eder.`
          + (corroborated ? ` Yakıt trimi de sapmış (%${ltft.toFixed(1)}) — iki ölçüm aynı yöne bakıyor.` : ''),
        evidence,
      };
    },
  },
  {
    id: 'oil_overheat_trend',
    title: 'Motor yağı sıcaklığı yüksek',
    requires: ['oilTemp'],
    supports: ['coolantTemp'],
    minDwellMs: 60_000,
    needsEngineRunning: true,
    evaluate: (c) => {
      const t = c.med('oilTemp');
      const w = c.get('oilTemp')!;
      const dwell = _dwell(w.samples, (x) => x > OIL_WATCH_C);
      /* DESTEK: yağ ısınırken soğutma sıvısı NORMALSE sorun yağlama/yük
         tarafındadır; ikisi birlikte yükseliyorsa soğutma sistemidir. Trend
         `predictionEngine.fitTrend` ile ölçülür — matematik TEK yerde. */
      const fit = fitTrend([...w.samples]);
      const rising = fit !== null && fit.slopePerMin > 0.5 && fit.fitQuality >= 0.6;
      const evidence = [ev('oilTemp', 'Motor yağı sıcaklığı', t, '°C', w.samples.length)];
      const cool = c.get('coolantTemp');
      if (cool) evidence.push(ev('coolantTemp', 'Soğutma sıvısı', c.med('coolantTemp'), '°C', cool.samples.length));
      return {
        deviating: t > OIL_WATCH_C,
        severe: t > OIL_HIGH_C,
        dwellFraction: dwell,
        corroborated: rising,
        reason: `Motor yağı sıcaklığı medyan ${t.toFixed(0)} °C`
          + (rising ? ` ve dakikada +${fit!.slopePerMin.toFixed(1)} °C yükseliyor` : '')
          + `. Uzun süre ${OIL_WATCH_C} °C üstü çalışmak yağın ömrünü kısaltır.`,
        evidence,
      };
    },
  },
  {
    id: 'intake_temp_implausible',
    title: 'Emme havası sıcaklığı fiziksel olarak tutarsız',
    requires: ['intakeTemp', 'ambientTemp'],
    supports: [],
    minDwellMs: 120_000,
    needsEngineRunning: false,
    evaluate: (c) => {
      const iat = c.med('intakeTemp');
      const amb = c.med('ambientTemp');
      const gap = amb - iat;
      const w = c.get('intakeTemp')!;
      const ambW = c.get('ambientTemp')!;
      const dwell = _dwell(w.samples, (x) => amb - x > IAT_BELOW_AMBIENT_C);
      return {
        deviating: gap > IAT_BELOW_AMBIENT_C,
        severe: gap > IAT_BELOW_AMBIENT_C * 2,
        dwellFraction: dwell,
        corroborated: true,   // İKİ sensörün fiziksel ilişkisi
        reason: `Emme havası medyan ${iat.toFixed(0)} °C, dış hava ${amb.toFixed(0)} °C — `
          + `emme havası dış havadan ${gap.toFixed(0)} °C daha soğuk görünüyor. `
          + `Motor bölmesi dış havadan SOĞUK olamaz; sensörlerden biri sapmış olabilir.`,
        evidence: [
          ev('intakeTemp', 'Emme havası', iat, '°C', w.samples.length),
          ev('ambientTemp', 'Dış hava', amb, '°C', ambW.samples.length),
        ],
      };
    },
  },
];

/** Katalog (LAB/testler gezer). */
export const EARLY_WARNING_RULES: readonly { id: EarlyWarningId; title: string;
  requires: readonly CanonicalObdKey[]; minDwellMs: number }[] =
  RULES.map((r) => ({ id: r.id, title: r.title, requires: r.requires, minDwellMs: r.minDwellMs }));

/* ── Değerlendirme ────────────────────────────────────────────────────────── */

function _missingResult(
  r: RuleDef, missing: readonly CanonicalObdKey[],
): EarlyWarningResult {
  return {
    id: r.id, title: r.title, verdict: 'SIGNAL_MISSING', confidence: 0,
    reason: `Bu değerlendirme için gereken ölçüm(ler) araçtan alınamıyor: ${missing.join(', ')}. `
      + `Bu "sorun yok" DEMEK DEĞİLDİR — ölçemediğimiz için hüküm veremiyoruz.`,
    evidence: [], missing, dwellFraction: 0, observedMs: 0,
  };
}

function _inconclusive(
  r: RuleDef, reason: string, evidence: readonly EarlyWarningEvidence[], observedMs: number,
): EarlyWarningResult {
  return {
    id: r.id, title: r.title, verdict: 'INSUFFICIENT_DATA', confidence: 0,
    reason, evidence, missing: [], dwellFraction: 0, observedMs,
  };
}

/**
 * Güven skoru — üç bileşenin toplamı, kural tipine göre TAVANLANIR.
 *
 * Bileşenler bilinçlidir: uzun gözlem (kanıt süresi) · yüksek kaplama (tutarlılık) ·
 * ilişkili sinyal desteği (çapraz kontrol). Hiçbiri tek başına 1.0 üretemez.
 */
export function computeConfidence(
  observedMs: number, minDwellMs: number, dwellFraction: number, corroborated: boolean,
): number {
  const duration = Math.min(1, observedMs / (minDwellMs * 2)) * 0.5;
  const consistency = Math.max(0, Math.min(1, dwellFraction)) * 0.3;
  const cross = corroborated ? 0.2 : 0;
  const cap = corroborated ? CROSS_SIGNAL_CONFIDENCE_CAP : SINGLE_SIGNAL_CONFIDENCE_CAP;
  return Number(Math.min(cap, duration + consistency + cross).toFixed(2));
}

/**
 * TÜM kuralları değerlendirir — her kural için MUTLAKA bir hüküm döner.
 *
 * Hiçbir kural sessizce atlanmaz: sinyali yoksa `SIGNAL_MISSING`, örneklemi
 * yetersizse `INSUFFICIENT_DATA`, ölçüldü ve iyiyse `NORMAL`. Sessiz atlama,
 * "kural çalışıyor ama arıza yok" yanılsaması üretirdi.
 */
export function evaluateEarlyWarnings(i: EarlyWarningInput): readonly EarlyWarningResult[] {
  const out: EarlyWarningResult[] = [];

  for (const r of RULES) {
    // 1. Gerekli sinyaller VAR MI (desteklenmeyen PID ≠ normal).
    const missing = r.requires.filter((k) => {
      const w = i.windows.get(k);
      return w === undefined || !w.available || w.samples.length === 0;
    });
    if (missing.length > 0) { out.push(_missingResult(r, missing)); continue; }

    // 2. Motor durumu şartı — bilinmiyorsa FAIL-CLOSED sus.
    if (r.needsEngineRunning && i.engineRunning !== true) {
      out.push(_inconclusive(
        r,
        i.engineRunning === null
          ? 'Motorun çalışıp çalışmadığı bilinmiyor — bu değerlendirme yalnız motor çalışırken anlamlıdır.'
          : 'Motor çalışmıyor — bu değerlendirme yalnız motor çalışırken anlamlıdır.',
        [], 0,
      ));
      continue;
    }

    // 3. Örneklem ve süre yeterli mi.
    const spans = r.requires.map((k) => _spanMs(i.windows.get(k)!.samples));
    const counts = r.requires.map((k) => i.windows.get(k)!.samples.length);
    const observedMs = Math.min(...spans);
    if (Math.min(...counts) < MIN_TREND_SAMPLES || observedMs < r.minDwellMs) {
      out.push(_inconclusive(
        r,
        `Henüz yeterli gözlem yok: ${Math.min(...counts)} örnek / `
        + `${(observedMs / 60_000).toFixed(1)} dk (gereken en az ${MIN_TREND_SAMPLES} örnek ve `
        + `${(r.minDwellMs / 60_000).toFixed(0)} dk).`,
        [], observedMs,
      ));
      continue;
    }

    // 4. Kuralın kendi değerlendirmesi.
    const ctx: RuleContext = {
      get: (k) => i.windows.get(k),
      med: (k) => median(_values(i.windows.get(k)?.samples ?? [])),
      observedMs,
    };
    const o = r.evaluate(ctx);

    if (o.inconclusive !== undefined) {
      out.push(_inconclusive(r, o.reason, o.evidence, observedMs));
      continue;
    }

    if (!o.deviating || o.dwellFraction < MIN_DWELL_FRACTION) {
      /* NORMAL: ÖLÇTÜK ve iyi. Kaplama düşükse de NORMAL'dir — tek sıçrama
         hüküm doğurmaz (bu kuralın varlık sebebi). */
      out.push({
        id: r.id, title: r.title, verdict: 'NORMAL', confidence: 0,
        reason: o.deviating
          ? `Sapma görüldü ama süreklilik yok (pencerenin %${Math.round(o.dwellFraction * 100)}'i) — `
            + `tek seferlik dalgalanma hüküm doğurmaz.`
          : o.reason,
        evidence: o.evidence, missing: [], dwellFraction: o.dwellFraction, observedMs,
      });
      continue;
    }

    const confidence = computeConfidence(observedMs, r.minDwellMs, o.dwellFraction, o.corroborated);
    if (confidence < MIN_EMIT_CONFIDENCE) {
      out.push(_inconclusive(
        r, `Sapma var ama kanıt henüz zayıf (güven ${confidence.toFixed(2)}). Gözlem sürüyor.`,
        o.evidence, observedMs,
      ));
      continue;
    }

    const attention = o.severe && o.dwellFraction >= ATTENTION_DWELL_FRACTION;
    out.push({
      id: r.id, title: r.title,
      verdict: attention ? 'ATTENTION' : 'WATCH',
      confidence,
      reason: o.reason,
      evidence: o.evidence, missing: [],
      dwellFraction: Number(o.dwellFraction.toFixed(2)),
      observedMs,
    });
  }

  return out;
}

/**
 * Mavi'nin konuşacağı özet — GEREKÇELİ ve ihtiyatlı.
 *
 * Hiçbir koşulda "arıza var" DEMEZ: kesinlik iddiası, ölçümün taşıyabileceğinden
 * fazlasıdır. Erken belirti dili kullanılır ve hangi ölçüme dayandığı söylenir.
 */
export function explainEarlyWarnings(results: readonly EarlyWarningResult[]): string | null {
  const active = results.filter((r) => r.verdict === 'ATTENTION' || r.verdict === 'WATCH');
  if (active.length === 0) return null;
  active.sort((a, b) =>
    (a.verdict === b.verdict ? b.confidence - a.confidence : a.verdict === 'ATTENTION' ? -1 : 1));
  const top = active[0]!;
  const lead = top.verdict === 'ATTENTION'
    ? 'Dikkat edilmesi gereken bir belirti var'
    : 'İzlenmesi gereken bir belirti var';
  const more = active.length > 1 ? ` Ayrıca ${active.length - 1} belirti daha izleniyor.` : '';
  return `${lead}: ${top.title}. ${top.reason} Bu kesin bir arıza teşhisi değil, `
    + `ölçüme dayalı erken bir işarettir.${more}`;
}
