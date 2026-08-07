/**
 * decoderRegistrySources.ts — Çözücü Kayıtları'nın TEK okuma noktası (Faz A8).
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ STATİK registry verisi okunur. Araç YOK, ECU YOK, oturum YOK.
 *  · OBD/AT komutu · PID/DID taraması · keşif · bağlantı · polling · reconnect ·
 *    native köprü · ağ isteği · timer · localStorage yazımı — HİÇBİRİ YOK.
 *  · `await` yok; tüm okuma senkron.
 *  · Her kaynak AYRI try/catch — biri patlarsa diğerleri okunmaya devam eder.
 *
 * ── CANLI REFERANS VERİLMEZ ─────────────────────────────────────────────────
 * `STANDARD_PID_MAP` TypeScript'te `ReadonlyMap` olarak yazılmıştır ama çalışma
 * zamanında SIRADAN bir `Map`'tir; profil nesneleri de sıradan nesnelerdir. Bu
 * katman bunlardan HİÇBİRİNİ dışarı vermez: her kayıttan yalnız PRİMİTİF alanlar
 * kopyalanır. Model/ekran registry'ye erişemez → mutasyon riski YAPISAL olarak yok.
 *
 * ── `decode` FONKSİYONU ─────────────────────────────────────────────────────
 * Hiçbir kayıtta `decode` fonksiyon referansı taşınmaz. `Function.prototype.toString`
 * ÇAĞRILMAZ, eval/dinamik kod YOK. DID'lerde formül özeti VERİDEN üretilir
 * (`decode.fn` + a/b katsayıları); standart PID'lerde makine-okunur spec YOKTUR →
 * özet `null` kalır, uydurulmaz.
 *
 * ── compileVehicleDidProfile() SAF MI? EVET ─────────────────────────────────
 * Koddan doğrulandı: profil nesnesini alır, `new Map` kurar, ECU referansını çözer
 * ve saf çözücü kapanışı üretir. Ağ/OBD/cihaz/kullanıcı verisi OKUMAZ, modül
 * durumu DEĞİŞTİRMEZ. Bu yüzden burada DETERMİNİSTİK olarak çağrılabilir —
 * yalnız envanter sayımı ve "hangi DID derlemede hayatta kaldı" tespiti için.
 */

import { STANDARD_PIDS } from '../obd/StandardPidRegistry';
import {
  MANUFACTURER_DID_PROFILES, MANUFACTURER_DID_PROFILE_SOURCES,
} from '../obd/profiles';
import { compileVehicleDidProfile } from '../obd/vehicleDidProfile';
import type {
  DecoderRegistryRaw, RawPidRecord, RawDidRecord, RawProfileRecord,
} from './decoderRegistryModel';
import { MAX_DECODER_RECORDS } from './decoderRegistryModel';

function _safe<T>(fn: () => T): T | null {
  try {
    const v = fn();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

function _str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function _num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Standart PID'ler
 * ════════════════════════════════════════════════════════════════════════ */

function _readPids(): { records: RawPidRecord[]; invalid: number } | null {
  const defs = _safe(() => STANDARD_PIDS);
  if (!Array.isArray(defs)) return null;

  const records: RawPidRecord[] = [];
  let invalid = 0;

  for (const d of defs) {
    if (records.length >= MAX_DECODER_RECORDS) break;
    // null/undefined/bozuk kayıt → SAYILIR, uydurulmaz.
    if (!d || typeof d !== 'object' || typeof d.pid !== 'string' || d.pid.length === 0) {
      invalid++;
      continue;
    }
    records.push({
      pid:      d.pid,
      name:     _str(d.name),
      unit:     _str(d.unit),
      bytes:    _num(d.bytes),
      min:      _num(d.min),
      max:      _num(d.max),
      category: _str(d.category),
      core:     d.core === true,
      /* GÜVENLİK: `d.decode` bir JS kapanışıdır — REFERANSI TAŞINMAZ, gövdesi
         OKUNMAZ. Yalnız VARLIĞI bildirilir. */
      hasDecoder: typeof d.decode === 'function',
    });
  }
  return { records, invalid };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Üretici DID profilleri
 * ════════════════════════════════════════════════════════════════════════ */

function _readProfiles(): { profiles: RawProfileRecord[]; dids: RawDidRecord[]; invalid: number } | null {
  const table = _safe(() => MANUFACTURER_DID_PROFILES);
  if (!table || typeof table !== 'object') return null;

  const sources = _safe(() => MANUFACTURER_DID_PROFILE_SOURCES) ?? {};
  const profiles: RawProfileRecord[] = [];
  const dids: RawDidRecord[] = [];
  let invalid = 0;

  for (const profileId of Object.keys(table)) {
    // TEK profil patlarsa DİĞERLERİ okunmaya devam eder (fail-soft, kayıt bazında).
    const p = _safe(() => (table as Record<string, unknown>)[profileId]) as
      | { brand?: unknown; source?: unknown; note?: unknown; protocols?: unknown;
          ecus?: unknown; dids?: unknown }
      | null;

    if (!p || typeof p !== 'object' || !Array.isArray(p.dids) || !Array.isArray(p.ecus)) {
      invalid++;
      continue;
    }

    /* DERLEME: saf ve deterministik. Hangi DID'in derlemede HAYATTA KALDIĞINI
       (ECU referansı çözülebildi mi) yalnız buradan öğrenebiliriz. */
    const compiledKeys = _safe(() => {
      const map = compileVehicleDidProfile(p as never);
      return Array.from(map.keys());
    });
    const survived: ReadonlySet<string> = new Set(compiledKeys ?? []);

    const ecuIds: string[] = [];
    for (const e of p.ecus as { id?: unknown }[]) {
      if (e && typeof e.id === 'string') ecuIds.push(e.id);
    }

    let declared = 0;
    for (const d of p.dids as Record<string, unknown>[]) {
      if (dids.length >= MAX_DECODER_RECORDS) break;
      if (!d || typeof d !== 'object' || typeof d.did !== 'string' || d.did.length === 0) {
        invalid++;
        continue;
      }
      declared++;
      const spec = (d.decode ?? null) as { fn?: unknown; a?: unknown; b?: unknown } | null;
      const didUpper = d.did.toUpperCase();

      dids.push({
        profileId,
        did:      d.did,
        service:  typeof d.service === 'string' ? d.service : '22',   // repo varsayılanı
        ecu:      _str(d.ecu),
        ecuKnown: typeof d.ecu === 'string' && ecuIds.indexOf(d.ecu) >= 0,
        name:     _str(d.name),
        unit:     _str(d.unit),
        bytes:    _num(d.bytes),
        min:      _num(d.min),
        max:      _num(d.max),
        category: _str(d.category),
        /* Çözücü SPEC'i VERİDİR (fn adı + katsayı) — fonksiyon gövdesi DEĞİL. */
        decodeFn: spec && typeof spec.fn === 'string' ? spec.fn : null,
        decodeA:  spec ? _num(spec.a) : null,
        decodeB:  spec ? _num(spec.b) : null,
        /** Derlemede hayatta kaldı mı (ECU referansı çözüldü + son yazan oldu). */
        compiled: survived.has(didUpper),
      });
    }

    profiles.push({
      profileId,
      brand:        _str(p.brand),
      source:       _str((sources as Record<string, unknown>)[profileId]) || _str(p.source),
      note:         typeof p.note === 'string' ? p.note : null,
      protocols:    Array.isArray(p.protocols)
        ? (p.protocols as unknown[]).filter((x): x is string => typeof x === 'string')
        : null,
      ecuCount:     ecuIds.length,
      declaredDids: declared,
      /** `null` = derleme okunamadı (0 ile KARIŞTIRILMAZ). */
      compiledDids: compiledKeys === null ? null : compiledKeys.length,
    });
  }

  return { profiles, dids, invalid };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tek seferlik senkron okuma
 * ════════════════════════════════════════════════════════════════════════ */

export function readDecoderRegistrySnapshot(): DecoderRegistryRaw {
  const readAt = Date.now();
  const pids = _readPids();
  const prof = _readProfiles();

  return {
    readAt,
    /** `null` = registry OKUNAMADI (boş liste ile KARIŞTIRILMAZ). */
    pids:         pids ? pids.records : null,
    pidInvalid:   pids ? pids.invalid : 0,
    profiles:     prof ? prof.profiles : null,
    dids:         prof ? prof.dids : null,
    didInvalid:   prof ? prof.invalid : 0,
  };
}
