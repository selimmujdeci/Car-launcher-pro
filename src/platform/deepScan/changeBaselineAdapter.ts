/**
 * changeBaselineAdapter — Deep Scan change detection için BASELINE ÇÖZÜCÜ (W5-3c-3).
 *
 * Offline `change_detection` fazının karşılaştıracağı "önceki durum"u PASİF okumayla bulur:
 * araca HİÇBİR sorgu göndermez, hiçbir şey YAZMAZ, Event Bus'a dokunmaz.
 *
 * NEDEN İKİ AŞAMALI ARAMA (mimari gerekçe — silmeyin):
 *   Fingerprint hash'i `V:vin|P:proto|E:ecuAddresses|B:bitmap` türevidir → ECU seti
 *   değişince HASH DE DEĞİŞİR. Bu yüzden YALNIZ hash ile arama, ECU değişimini yapısal
 *   olarak ASLA tespit edemez: aranan anahtarın kendisi değişmiştir → kayıt bulunamaz →
 *   "baseline yok" denir ve gerçek değişim sessizce kaybolur.
 *   Çözüm: (1) hash ile ara → bulunursa ECU seti aynıdır. (2) bulunamazsa VIN eşleşen
 *   ÖNCEKİ fingerprint üzerinden baseline'a ulaş → ECU setlerini KARŞILAŞTIR.
 *
 * FAIL-CLOSED: baseline yokluğu "değişiklik yok" DEĞİLDİR → `no_baseline`. Okuma hatası
 * yutulmaz → `unavailable` (çağıran fazı başarılı SAYMAZ).
 *
 * LAZY: kurulum I/O yapmaz; disk yalnız `resolve()` çağrılınca (yani faza gelince) okunur.
 */

import {
  findBestMatch,
  vehicleFingerprintStore,
  type VehicleFingerprint,
  type VehicleFingerprintStore,
} from '../vehicleFingerprintService';
import {
  deepScanPersistenceStore,
  type DeepScanPersistenceStore,
  type DeepScanRecord,
} from './deepScanPersistence';

/** Enjekte edilebilir bağımlılıklar (test için değiştirilebilir). */
export interface ChangeBaselineDeps {
  readonly fingerprintStore?: VehicleFingerprintStore;
  readonly persistence?: DeepScanPersistenceStore;
}

/**
 * Baseline çözümü — BOUNDED. Dışarıya ham kimlik (VIN/ECU adresi) TAŞIMAZ;
 * `record` yalnız modül içi karar için taşınır, faz sonucuna KOYULMAZ.
 */
export type BaselineResolution =
  /** Aynı hash → aynı araç + aynı ECU seti (fingerprint tanımı gereği). */
  | { readonly kind: 'match'; readonly record: DeepScanRecord }
  /** VIN eşleşti ama ECU seti FARKLI → gerçek değişim kanıtı. */
  | { readonly kind: 'ecu_set_changed'; readonly record: DeepScanRecord }
  /** VIN eşleşti, hash farklı ama ECU seti aynı (bitmap/protokol değişmiş). */
  | { readonly kind: 'match_via_vin'; readonly record: DeepScanRecord }
  /** Kanıt yok — "değişiklik yok" DEĞİL. */
  | { readonly kind: 'no_baseline' }
  /** Okuma başarısız — fail-closed; faz başarılı sayılmamalı. */
  | { readonly kind: 'unavailable' };

/** İki ECU adres kümesi anlamlı biçimde farklı mı (sıra/tekrar duyarsız). */
function ecuSetChanged(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size !== sb.size) return true;
  for (const x of sa) if (!sb.has(x)) return true;
  return false;
}

export class ChangeBaselineAdapter {
  private readonly _fingerprints: VehicleFingerprintStore;
  private readonly _persistence: DeepScanPersistenceStore;

  constructor(deps: ChangeBaselineDeps = {}) {
    // Yalnız REFERANS alınır — kurulumda I/O YOK (lazy sözleşmesi).
    this._fingerprints = deps.fingerprintStore ?? vehicleFingerprintStore;
    this._persistence = deps.persistence ?? deepScanPersistenceStore;
  }

  /**
   * Baseline'ı ÇÖZER — disk burada okunur (lazy). Fail-closed: hata yutulmaz,
   * `unavailable` döner. Araca sorgu YOK, yazma YOK.
   */
  resolve(): BaselineResolution {
    let known: readonly VehicleFingerprint[];
    try {
      known = this._fingerprints.list();
    } catch {
      return { kind: 'unavailable' };
    }

    const current = known[0];                                 // LRU: en son görülen araç
    if (!current || typeof current.hash !== 'string' || current.hash === '') {
      return { kind: 'no_baseline' };                         // araç kimliği bilinmiyor
    }

    try {
      // (1) HASH ile — bulunursa ECU seti tanım gereği aynıdır.
      const direct = this._persistence.load(current.hash);
      if (direct) return { kind: 'match', record: direct };

      // (2) VIN eşleşen ÖNCEKİ fingerprint üzerinden. Kendisi listeden ÇIKARILIR
      //     (aksi hâlde matcher kendisiyle eşleşir → tautoloji).
      const others = known.filter((f) => f && f.hash !== current.hash);
      if (others.length === 0) return { kind: 'no_baseline' };

      const best = findBestMatch(current, others);
      // YALNIZ VIN eşleşmesi (confidence 1.0) baseline devretmeye yeter. `signature`
      // zaten ECU/bitmap türevidir (döngüsel), `adapter-mac` aracı değil dongle'ı tanır.
      if (best.reason !== 'vin' || !best.hash) return { kind: 'no_baseline' };

      const prior = this._persistence.load(best.hash);
      if (!prior) return { kind: 'no_baseline' };             // o araç hiç taranmamış

      const priorFp = others.find((f) => f.hash === best.hash);
      if (!priorFp) return { kind: 'no_baseline' };

      return ecuSetChanged(current.ecuAddresses ?? [], priorFp.ecuAddresses ?? [])
        ? { kind: 'ecu_set_changed', record: prior }
        : { kind: 'match_via_vin', record: prior };
    } catch {
      return { kind: 'unavailable' };                          // fail-closed
    }
  }
}

export function createChangeBaselineAdapter(deps: ChangeBaselineDeps = {}): ChangeBaselineAdapter {
  return new ChangeBaselineAdapter(deps);
}
