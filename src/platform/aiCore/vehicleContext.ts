/**
 * aiCore/vehicleContext.ts — ORTAK ARAÇ BAĞLAMI (read-only · point-in-time · decoupled).
 *
 * AMAÇ: Ajanların OKUYACAĞI tek "araç durumu görüntüsü"nü mevcut kaynaklardan (Vehicle HAL
 * sinyalleri · Capability Registry · Vehicle Fingerprint · Diagnostics bölümleri · DTC)
 * BİRLEŞTİRİR. VERİ SAHİBİ DEĞİLDİR — her alanı dışarıdan alır, normalize eder, immutable
 * bir read-model döndürür (VİZYON: "UI/tüketici ham veri okumaz; yalnız durum katmanını").
 *
 * NEDEN AYRI: her ajan aynı tutarlı bağlamı görmeli (yarış yok, tek tazelik anı). Bağlam
 * ayrıca `deriveContextEvidence` ile Evidence Store'u besleyecek kanıt satırlarını üretir —
 * böylece "hangi ajan neye baktı" tek yerden izlenir (explainable + tekrar-üretilebilir).
 *
 * DECOUPLED: girdi tipleri "*Like" desenindedir (diagnostics/capability MODÜLLERİNİ import
 * ETMEZ, yalnız şekli bilir → bağımlılık döngüsü yok). Fingerprint HAM VIN değil, anonim
 * hash taşır (gizlilik). SAF/DI: zaman enjekte edilir, I/O yok.
 */

import type { SignalEnvelope } from '../obd/signalEnvelope';
import type { TriageSections } from '../diagnosticTriage';
import type { AiEvidenceItem } from './types';
import { signalToEvidence, dtcToEvidence, makeEvidence } from './evidenceStore';

/* ── Decoupled girdi şekilleri ──────────────────────────────────── */

/** Capability Registry kaydının yalnız kullanılan alanları (CapabilityRecord *Like). */
export interface CapabilityRecordLike {
  readonly id?: string;
  readonly status?: string;
  readonly confidence?: number;
}

/** DTC girdisi (obdDeep.dtc.codes elemanı *Like). */
export interface DtcLike {
  readonly code?: string;
  readonly severity?: string;
}

export interface VehicleContextInput {
  readonly now?: number;
  /** Anonim araç kimliği (fingerprint hash) — HAM VIN DEĞİL. */
  readonly fingerprintHash?: string | null;
  readonly connected?: boolean;
  /** Kontak durumu — null = bilinmiyor (fail-soft). */
  readonly ignitionOn?: boolean | null;
  readonly online?: boolean;
  /** İsimli SignalEnvelope haritası (ör. { coolant_temp, speed, rpm, … }). */
  readonly signals?: Readonly<Record<string, SignalEnvelope | null | undefined>>;
  readonly capabilities?: readonly CapabilityRecordLike[];
  /** Diagnostics V2 bölümleri — Verdict Engine'e passthrough (yorumlanmaz). */
  readonly diagnosticSections?: TriageSections | null;
  readonly dtcs?: readonly DtcLike[];
}

/* ── Read-model ─────────────────────────────────────────────────── */

export interface CapabilitySummary {
  readonly available: readonly string[];
  readonly degraded: readonly string[];
  readonly unavailable: readonly string[];
  readonly unknown: readonly string[];
}

export interface VehicleContext {
  readonly generatedAt: number;
  readonly fingerprintHash: string | null;
  readonly connected: boolean;
  readonly ignitionOn: boolean | null;
  readonly online: boolean;
  /** Yalnız GEÇERLİ değeri olan (value!==null) sinyaller — "no-data" bağlama girmez. */
  readonly signals: Readonly<Record<string, SignalEnvelope>>;
  readonly capabilitySummary: CapabilitySummary;
  readonly diagnosticSections: TriageSections;
  readonly dtcCount: number;
  /** Bağlamda karar-derecesinde kanıt var mı (sinyal/DTC). "kanıt yoksa tahmin yok" ölçütü. */
  readonly hasSignals: boolean;
}

/** Anonim hash doğrulama — 8..64 hex; 17-karakter (ham VIN) reddedilir. */
function _fingerprint(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (s.length === 17) return null;               // ham VIN sızıntısı engeli
  return /^[0-9a-fA-F]{8,64}$/.test(s) ? s.toLowerCase() : null;
}

/**
 * Ham girdiden immutable araç bağlamı üretir. Fail-soft: eksik alanlar güvenli boşa düşer.
 * `signals` yalnız value!==null zarfları taşır (no-data/unsupported dışlanır — bağlam yalan
 * söylemez). SAF: yan etki yok.
 */
export function assembleVehicleContext(input: VehicleContextInput = {}): VehicleContext {
  const now = typeof input.now === 'number' && Number.isFinite(input.now) ? input.now : Date.now();

  const signals: Record<string, SignalEnvelope> = {};
  const rawSignals = input.signals ?? {};
  for (const [k, sig] of Object.entries(rawSignals)) {
    if (sig && sig.value !== null && sig.state !== 'no_data' && sig.state !== 'unsupported') {
      signals[k] = sig;
    }
  }

  const available: string[] = [];
  const degraded: string[] = [];
  const unavailable: string[] = [];
  const unknown: string[] = [];
  for (const c of input.capabilities ?? []) {
    if (!c || typeof c.id !== 'string' || !c.id) continue;
    switch (c.status) {
      case 'available': available.push(c.id); break;
      case 'degraded': degraded.push(c.id); break;
      case 'unavailable': case 'unsupported': unavailable.push(c.id); break;
      default: unknown.push(c.id); break;    // unknown/restricted
    }
  }

  const dtcCount = Array.isArray(input.dtcs)
    ? input.dtcs.filter((d) => d && typeof d.code === 'string' && d.code).length
    : 0;

  return Object.freeze({
    generatedAt: now,
    fingerprintHash: _fingerprint(input.fingerprintHash),
    connected: input.connected === true,
    ignitionOn: input.ignitionOn === true ? true : input.ignitionOn === false ? false : null,
    online: input.online === true,
    signals: Object.freeze(signals),
    capabilitySummary: Object.freeze({
      available: Object.freeze([...available]),
      degraded: Object.freeze([...degraded]),
      unavailable: Object.freeze([...unavailable]),
      unknown: Object.freeze([...unknown]),
    }),
    diagnosticSections: (input.diagnosticSections ?? {}) as TriageSections,
    dtcCount,
    hasSignals: Object.keys(signals).length > 0 || dtcCount > 0,
  });
}

/**
 * Bağlamdan KANIT satırları türetir (Evidence Store'a ingest için). Sinyaller +
 * DTC'ler + araç kimliği + degraded capability'ler kanıta çevrilir. SAF; sahte kanıt
 * üretmez (no-data zaten bağlama girmedi). @param now DTC/kimlik kanıtı için zaman.
 */
export function deriveContextEvidence(ctx: VehicleContext, now: number = Date.now()): AiEvidenceItem[] {
  const out: AiEvidenceItem[] = [];

  for (const [name, sig] of Object.entries(ctx.signals)) {
    const ev = signalToEvidence(name, sig, name);
    if (ev) out.push(ev);
  }

  // DTC'ler diagnostic bölümünden (varsa) — bağlam yalnız sayı tutar; kod detayı sections'ta.
  const codes = ctx.diagnosticSections?.obdDeep?.dtc?.codes;
  if (Array.isArray(codes)) {
    for (const c of codes) {
      if (c && typeof c.code === 'string' && c.code) {
        const ev = dtcToEvidence(c.code, typeof c.severity === 'string' ? c.severity : undefined, now);
        if (ev) out.push(ev);
      }
    }
  }

  // Araç kimliği (anonim hash) — bağlamın "hangi araç" kanıtı.
  if (ctx.fingerprintHash) {
    const ev = makeEvidence({
      key: 'fingerprint.identity', kind: 'fingerprint',
      summary: `Araç kimliği ${ctx.fingerprintHash.slice(0, 8)}… tanındı`,
      confidence: 0.9, observedAt: now, source: 'fingerprint',
    });
    if (ev) out.push(ev);
  }

  // Degraded capability'ler — "bu yetenek sınırlı çalışıyor" kanıtı (karar bağlamı).
  for (const id of ctx.capabilitySummary.degraded) {
    const ev = makeEvidence({
      key: `capability.${id}`, kind: 'capability',
      summary: `Yetenek ${id} sınırlı (degraded)`,
      confidence: 0.6, observedAt: now, source: 'capability',
    });
    if (ev) out.push(ev);
  }

  return out;
}
