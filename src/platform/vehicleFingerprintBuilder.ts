/**
 * vehicleFingerprintBuilder — Otomatik Araç Parmak İzi ÜRETİCİSİ (PR-26).
 *
 * AMAÇ: PR-25'te kurulan SAF foundation'ı (vehicleFingerprintService) canlı OBD akışına
 * GÜVENLE bağlar. Araç bağlandıktan (VID: taşıma doğrulandı + protokol biliniyor) sonra
 * fingerprint OTOMATİK oluşur, kaydedilir; aynı araç tekrar gelince duplicate ÜRETMEZ.
 *
 * KATMAN (Clean Architecture): bu dosya ENTEGRASYON katmanıdır (useVidStore + Discovery
 * gözlemlerini OKUR). Foundation (buildFingerprint/store) DEĞİŞMEZ. Saf yaşam-döngüsü
 * mantığı (ingest/profileHint/collectEcuAddresses) React'sız test edilebilir; abonelik
 * yalnız ince bir sarmalayıcıdır.
 *
 * PAZARLIKSIZ İNVARYANTLAR (CLAUDE.md):
 *  - HOT-PATH'e girmez: useVidStore aboneliği her değişimde tetiklense de, KİMLİK imzası
 *    (VIN/protocol/ECU/adaptör) değişmedikçe iş yapılmaz → yüksek-frekanslı telemetri
 *    tick'leri (trustScore/thermal) erken-döner, safeStorage'a yazma yapılmaz.
 *  - FAIL-SOFT: fingerprint üretimi/depolaması başarısız olursa hata YUTULUR; mevcut OBD
 *    akışı aynen devam eder (asla throw sızmaz).
 *  - Discovery Pipeline'a DOKUNULMAZ: yalnız getObservations() (SALT-OKUNUR) tüketilir.
 *  - Native/SQL/Supabase/PID-DID registry/hot-poll/queue DEĞİŞMEZ. Cloud sync YOK.
 */

import { useVidStore, type VidStore } from '../store/useVidStore';
import {
  discoveryCaptureService,
  type DiscoveryObservation,
} from './obd/discovery';
import {
  buildFingerprint,
  normalizeVin,
  normalizeEcuAddress,
  normalizeEcuAddresses,
  vehicleFingerprintStore,
  VehicleFingerprintStore,
  type VehicleFingerprint,
  type VehicleFingerprintInput,
} from './vehicleFingerprintService';

/* ══════════════════════════════════════════════════════════════════════════
 * Öğrenilmiş (yaşam-döngülü) parmak izi — foundation kimliğinin ÜSTÜNE builder alanları
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Foundation kaydını (kimlik) builder yaşam-döngüsü alanlarıyla genişletir. Depo bu
 * alanları JSON olarak şeffaf saklar (foundation tipini değiştirmeden — Clean Arch).
 */
export interface LearnedVehicleFingerprint extends VehicleFingerprint {
  /** İlk kayıt anı (kimlik değişince değil — yalnız yeni araçta). */
  createdAt:   number;
  /** Bu araç kaç kez/kaynaktan gözlemlendi (her tekrar bağlanışta +1). */
  sourceCount: number;
  /** Kimlik güveni [0,1] — gözlem tekrarı arttıkça yükselir. */
  confidence:  number;
  /** VIN WMI'sinden marka ipucu ('Renault'…) veya '' (VIN yoksa). */
  profileHint: string;
}

/* ── Güven ayarları ───────────────────────────────────────────────────────── */
const INITIAL_CONFIDENCE = 0.5;   // yeni araç taban güveni
const VIN_CONFIDENCE_BONUS = 0.1; // VIN varsa ek güven (daha güçlü kimlik)
const CONFIDENCE_STEP = 0.1;      // her tekrar gözlemde artış
const MAX_CONFIDENCE = 1.0;

function clamp01(v: number): number {
  return Math.max(0, Math.min(MAX_CONFIDENCE, v));
}

/* ══════════════════════════════════════════════════════════════════════════
 * Profile Hint — VIN WMI (ilk 3 hane) → marka ipucu (İLK SÜRÜM: yalnız ipucu)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * WMI (World Manufacturer Identifier) → marka. Kapsam kasıtlı DAR ve KESİN tutulur
 * (uydurma yok — bilinmeyen WMI → ''). Bu yalnız bir İPUCU'dur; kesin çözümleme değil.
 */
const WMI_MAKE: Readonly<Record<string, string>> = {
  VF1: 'Renault',      VF2: 'Renault',
  UU1: 'Dacia',        UU5: 'Dacia',        UU6: 'Dacia',
  WF0: 'Ford',         '1FA': 'Ford',       '1FT': 'Ford',       '3FA': 'Ford',
  JTD: 'Toyota',       JTM: 'Toyota',       JTN: 'Toyota',       NMT: 'Toyota',       VNK: 'Toyota',      SB1: 'Toyota',
  VF3: 'Peugeot',      VF7: 'Citroën',      ZFA: 'Fiat',
  WVW: 'Volkswagen',   WV1: 'Volkswagen',   WV2: 'Volkswagen',
  VSK: 'Nissan',       SJN: 'Nissan',
  W0L: 'Opel',         W0V: 'Opel',
  WBA: 'BMW',          WBS: 'BMW',
  WDB: 'Mercedes-Benz', WDD: 'Mercedes-Benz', W1K: 'Mercedes-Benz',
  KMH: 'Hyundai',      NLH: 'Hyundai',      TMB: 'Škoda',
};

/** VIN'in ilk 3 hanesinden (WMI) marka ipucu üretir; VIN yok/kısa/bilinmeyen → ''. */
export function profileHintFromVin(vin: string | undefined | null): string {
  const v = normalizeVin(vin);
  if (v.length < 3) return '';
  return WMI_MAKE[v.slice(0, 3)] ?? '';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ingest — SAF yaşam-döngüsü mantığı (yeni / duplicate)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir araç girişini parmak izine çevirip depoya işler. Depoda AYNI kimlik (hash) varsa
 * DUPLICATE ÜRETMEZ: lastSeen güncellenir, sourceCount++ , confidence yükseltilir. Yoksa
 * yeni kayıt (createdAt/firstSeen/lastSeen + başlangıç güveni + profileHint) oluşturulur.
 *
 * @param store test/özelleştirme için enjekte edilebilir (varsayılan: tekil depo).
 * @param now   zaman damgası (test için enjekte edilebilir).
 */
export function ingestVehicleFingerprint(
  input: VehicleFingerprintInput,
  store: VehicleFingerprintStore = vehicleFingerprintStore,
  now: number = Date.now(),
): LearnedVehicleFingerprint {
  const base = buildFingerprint(input, now);
  const existing = store.load(base.hash) as LearnedVehicleFingerprint | null;

  if (existing) {
    // Aynı araç — DUPLICATE YOK: yalnız yaşam-döngüsü alanlarını güncelle.
    const learned: LearnedVehicleFingerprint = {
      ...base,
      createdAt:   existing.createdAt   ?? existing.firstSeen ?? now,
      firstSeen:   existing.firstSeen   ?? now,
      lastSeen:    now,
      sourceCount: (existing.sourceCount ?? 1) + 1,
      confidence:  clamp01((existing.confidence ?? INITIAL_CONFIDENCE) + CONFIDENCE_STEP),
      // İpucu bir kez çözülürse korunur; yoksa (ör. sonradan VIN geldiyse) yeniden dener.
      profileHint: existing.profileHint || profileHintFromVin(base.vin),
    };
    return store.save(learned) as LearnedVehicleFingerprint;
  }

  // Yeni araç.
  const learned: LearnedVehicleFingerprint = {
    ...base,
    createdAt:   now,
    sourceCount: 1,
    confidence:  clamp01(INITIAL_CONFIDENCE + (base.vin ? VIN_CONFIDENCE_BONUS : 0)),
    profileHint: profileHintFromVin(base.vin),
  };
  return store.save(learned) as LearnedVehicleFingerprint;
}

/* ══════════════════════════════════════════════════════════════════════════
 * VID + Discovery → fingerprint girdisi (SALT-OKUNUR toplama)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bağlantı TAMAM mı: OBD taşıması doğrulandı + protokol biliniyor. VIN OPSİYONELDİR
 * (VIN'siz araçlar da öğrenilir — zero-trust/bilinmeyen araç vizyonu).
 */
export function isConnectionComplete(vid: VidStore): boolean {
  return vid.obdAdapter.isTransportVerified === true && !!vid.obdAdapter.lastProtocolNum;
}

/**
 * Discovery Capture gözlemlerinden (SALT-OKUNUR) benzersiz ECU adreslerini toplar.
 * Discovery mantığına DOKUNMAZ; yalnız zaten toplanmış gözlemleri okur.
 */
export function collectEcuAddresses(observations: readonly DiscoveryObservation[]): string[] {
  const set = new Set<string>();
  for (const o of observations) {
    const e = normalizeEcuAddress(o.record.ecuAddress);
    if (e) set.add(e);
  }
  return [...set].sort();
}

/** VID + Discovery'den fingerprint girdisi kurar (yan etkisiz okuma). */
export function assembleFingerprintInput(
  vid: VidStore,
  observations: readonly DiscoveryObservation[],
): VehicleFingerprintInput {
  const label = [vid.vehicle.make, vid.vehicle.model].filter(Boolean).join(' ');
  return {
    vin:          vid.vehicle.vin ?? '',
    protocol:     vid.obdAdapter.lastProtocolNum ?? '',
    ecuAddresses: collectEcuAddresses(observations),
    metadata: {
      adapterMac: vid.obdAdapter.lastAddress ?? undefined,
      label:      label || undefined,
    },
  };
}

/** Girdinin KİMLİK imzası — telemetri tick'lerinde gereksiz iş yapmamak için dedup anahtarı. */
export function fingerprintInputSignature(input: VehicleFingerprintInput): string {
  return [
    normalizeVin(input.vin),
    (input.protocol ?? '').trim().toUpperCase(),
    normalizeEcuAddresses(input.ecuAddresses).join(','),
    (input.metadata?.adapterMac ?? '').trim().toUpperCase(),
  ].join('|');
}

/* ══════════════════════════════════════════════════════════════════════════
 * Otomatik üretici — useVidStore aboneliği (ince sarmalayıcı)
 * ════════════════════════════════════════════════════════════════════════ */

export class AutomaticVehicleFingerprint {
  private _unsub: (() => void) | null = null;
  /** Son işlenen kimlik imzası — aynıysa (telemetri tick'i vb.) atla. */
  private _lastSig: string | null = null;
  private readonly _store: VehicleFingerprintStore;
  private readonly _readVid: () => VidStore;
  private readonly _readObs: () => DiscoveryObservation[];

  constructor(
    store: VehicleFingerprintStore = vehicleFingerprintStore,
    readVid: () => VidStore = () => useVidStore.getState(),
    readObs: () => DiscoveryObservation[] = () => discoveryCaptureService.getObservations(),
  ) {
    this._store = store;
    this._readVid = readVid;
    this._readObs = readObs;
  }

  /** Aboneliği başlatır (idempotent). Döndürülen fonksiyon durdurur (zero-leak). */
  start(): () => void {
    if (this._unsub) return () => this.stop();
    this._unsub = useVidStore.subscribe(() => this._onVidChange());
    this._onVidChange(); // mevcut durumu bir kez değerlendir
    return () => this.stop();
  }

  stop(): void {
    this._unsub?.();
    this._unsub = null;
    this._lastSig = null;
  }

  /** VID değişiminde: bağlantı tamamsa ve kimlik değiştiyse fingerprint işle. FAIL-SOFT. */
  private _onVidChange(): void {
    try {
      const vid = this._readVid();
      if (!isConnectionComplete(vid)) return;
      const input = assembleFingerprintInput(vid, this._readObs());
      const sig = fingerprintInputSignature(input);
      if (sig === this._lastSig) return; // kimlik değişmedi → hot-path/telemetri tick'i atla
      this._lastSig = sig;
      ingestVehicleFingerprint(input, this._store);
    } catch {
      /* FAIL-SOFT: fingerprint hatası mevcut OBD akışını ASLA bozmaz */
    }
  }
}

/** Uygulama geneli tekil otomatik üretici (SystemBoot Wave-3'ten başlatılır). */
export const automaticVehicleFingerprint = new AutomaticVehicleFingerprint();

/** SystemBoot wiring yardımcı — başlatır, cleanup fonksiyonu döndürür. */
export function startAutomaticVehicleFingerprint(): () => void {
  return automaticVehicleFingerprint.start();
}
