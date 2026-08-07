/**
 * vehicleFingerprintModel.ts — Araç Parmak İzi'nin SAF görünüm modeli (Faz A5).
 *
 * BU DOSYA YENİ BİR OTORİTE DEĞİLDİR: kimlik üretmez, hash HESAPLAMAZ, keşif
 * yapmaz. Yalnız MEVCUT kalıcı kayıtları sınıflandırır ve eksikleri BEYAN EDER.
 *
 * PARALEL MİMARİ YOK: gözlemlenebilirlik ilkelleri (`observed` · `derived` ·
 * `unavailable` · `Observability`) Session Inspector modelinden AYNEN yeniden
 * kullanılır — ikinci bir sınıflandırma sistemi kurulmaz.
 *
 * ── GİZLİLİK (pazarlıksız) ──────────────────────────────────────────────────
 *  · Ham VIN, plaka ve adaptör MAC'i bu modele HİÇ GİRMEZ (kaynak katmanı
 *    zaten taşımaz) ve hiçbir alanda GÖSTERİLMEZ.
 *  · Hash YOKSA üretilmez — "hash yok" denir.
 *  · Zaman damgası YOKSA "şimdi" yazılmaz — KAYNAK YOK denir.
 *
 * ── BOŞ ≠ KAYNAK YOK ────────────────────────────────────────────────────────
 *  `null` (kaynak okunamadı / hiç çalışmadı) ile `[]` (çalıştı, sonuç boş)
 *  AYRI sınıflandırılır. Bir API bu ayrımı YAPAMIYORSA (ör. `getAutoDiscoveredDids()`
 *  boş dizi döndürüp "tarandı mı" bilgisini vermiyor) belirsizlik AÇIKÇA yazılır;
 *  "tarandı, bulunamadı" diye YORUMLANMAZ.
 *
 * SAF: I/O yok, timer yok, modül durumu yok. Kaynak okuma `vehicleFingerprintSources.ts`te.
 */

import {
  observed, derived, unavailable,
  type InspectorField, type Observability,
} from './sessionInspectorModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

export type VfSectionId = 'identity' | 'ecu' | 'data' | 'evidence';

export const VF_SECTION_ORDER: readonly VfSectionId[] = [
  'identity', 'ecu', 'data', 'evidence',
] as const;

export const VF_SECTION_TITLE: Readonly<Record<VfSectionId, string>> = {
  identity: '1 · Araç Kimliği',
  ecu:      '2 · ECU Keşfi',
  data:     '3 · Desteklenen Veriler',
  evidence: '4 · Kanıt Sağlığı',
} as const;

export interface VfSection {
  readonly id:     VfSectionId;
  readonly title:  string;
  readonly fields: readonly InspectorField[];
}

/** Bölüm başına azami alan — Mali-400 render bütçesi. */
export const MAX_FIELDS_PER_VF_SECTION = 24;

/** Kanıt sağlığı — FAIL-CLOSED: kimlik yoksa asla HAZIR denmez. */
export type VfEvidenceHealth = 'READY' | 'PARTIAL' | 'NO_SOURCE';

export const VF_EVIDENCE_LABEL: Readonly<Record<VfEvidenceHealth, string>> = {
  READY:     'HAZIR',
  PARTIAL:   'KISMİ',
  NO_SOURCE: 'KAYNAK YOK',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Ham anlık görüntü sözleşmesi (kaynak okuyucu bunu üretir)
 * ════════════════════════════════════════════════════════════════════════ */

export interface VfIdentityRaw {
  readonly hash:               string;
  /** VIN'in YEREL FNV-1a özeti. Ham VIN ASLA taşınmaz. */
  readonly vinHash:            string | null;
  readonly vinPresent:         boolean;
  readonly protocol:           string | null;
  readonly supportedPidBitmap: string | null;
  readonly firstSeen:          number | null;
  readonly lastSeen:           number | null;
}

export interface VfAutoDid {
  readonly did:   string;
  readonly ecuRx: string;
}

export interface VfRawSnapshot {
  readonly readAt: number;
  readonly identity:           VfIdentityRaw | null;
  readonly storedVehicleCount: number | null;
  readonly ecuAddresses:       readonly string[] | null;
  readonly ecuAddressTotal:    number | null;
  readonly supportedPids:      readonly string[] | null;
  readonly supportedPidTotal:  number | null;
  readonly autoDids:           readonly VfAutoDid[] | null;
  readonly autoDidTotal:       number | null;
  readonly recordTotal:        number | null;
  readonly recordPidCount:     number | null;
  readonly recordDidCount:     number | null;
  readonly recordLastSeenAt:   number | null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kaynak künyeleri
 * ════════════════════════════════════════════════════════════════════════ */

const SRC = {
  store:  'vehicleFingerprintService.vehicleFingerprintStore.list()',
  repo:   'obd/discovery/discoveredDataRepository.loadRecords()',
  pids:   'obd/extendedPidService.getSupportedPids()',
  dids:   'obd/autoDidDiscovery.getAutoDiscoveredDids()',
  hash:   'obd/discovery/discoveredDataRepository.hashVin() [SAF, yerel]',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Bölüm kurucuları — hepsi SAF
 * ════════════════════════════════════════════════════════════════════════ */

function _identitySection(s: VfRawSnapshot): VfSection {
  const f: InspectorField[] = [];
  const id = s.identity;

  if (!id) {
    f.push(unavailable(
      { id: 'vfHash', label: 'parmak izi (hash)', source: SRC.store, note: '' },
      'Kayıtlı araç parmak izi YOK. Hash UYDURULMAZ: kimlik ancak gerçek bir handshake ' +
      'sonrası kaydedilir. Bu ekran araca sorgu göndermez, kayıt oluşturmaz.',
    ));
    f.push(observed(
      { id: 'vfStoredCount', label: 'kayıtlı araç sayısı', source: SRC.store,
        note: 'Kalıcı LRU deposundaki araç kimliği sayısı.' },
      s.storedVehicleCount,
    ));
    return _bound({ id: 'identity', title: VF_SECTION_TITLE.identity, fields: f });
  }

  f.push(observed(
    { id: 'vfHash', label: 'parmak izi (hash)', source: SRC.store, updatedAt: id.lastSeen,
      note: 'Deterministik kimlik: VIN+protokol+ECU+bitmap türevi. Ham VIN İÇERMEZ.' },
    id.hash || null,
  ));

  /* VIN: yalnız VARLIK + YEREL ÖZET. Ham VIN hiçbir koşulda gösterilmez. */
  f.push(id.vinHash
    ? observed(
        { id: 'vfVinHash', label: 'VIN özeti (FNV-1a)', source: SRC.hash,
          note: 'VIN\'in yerel özeti — geri çevrilemez ve ham VIN EKRANA BASILMAZ. ' +
                'Keşif deposu anahtarı da budur.' },
        id.vinHash,
      )
    : unavailable(
        { id: 'vfVinHash', label: 'VIN özeti (FNV-1a)', source: SRC.hash, note: '' },
        id.vinPresent
          ? 'Kayıtta VIN var ama özet hesaplanamadı; ham VIN GÖSTERİLMEZ.'
          : 'Kayıtta VIN yok (handshake VIN okuyamamış). Özet UYDURULMAZ.',
      ));

  f.push(observed(
    { id: 'vfProtocol', label: 'öğrenilmiş protokol', source: SRC.store,
      note: 'Kimlik kaydedilirken aktif olan ATSP protokolü.' },
    id.protocol,
  ));

  f.push(observed(
    { id: 'vfPidBitmap', label: 'desteklenen PID bitmap', source: SRC.store,
      note: 'Mode 01 destek maskesi (normalize + trailing-zero temizlenmiş). Kişisel veri değildir.' },
    id.supportedPidBitmap,
  ));

  f.push(id.firstSeen
    ? observed(
        { id: 'vfFirstSeen', label: 'ilk görülme', source: SRC.store, updatedAt: id.firstSeen,
          note: 'Bu kimliğin ilk kaydedildiği an.' },
        new Date(id.firstSeen).toISOString(),
      )
    : unavailable(
        { id: 'vfFirstSeen', label: 'ilk görülme', source: SRC.store, note: '' },
        'Damga yok — "şimdi" YAZILMAZ.',
      ));

  f.push(id.lastSeen
    ? observed(
        { id: 'vfLastSeen', label: 'son görülme', source: SRC.store, updatedAt: id.lastSeen,
          note: 'Bu kimliğin son eşleştiği an.' },
        new Date(id.lastSeen).toISOString(),
      )
    : unavailable(
        { id: 'vfLastSeen', label: 'son görülme', source: SRC.store, note: '' },
        'Damga yok — "şimdi" YAZILMAZ.',
      ));

  f.push(observed(
    { id: 'vfStoredCount', label: 'kayıtlı araç sayısı', source: SRC.store,
      note: 'Kalıcı LRU deposundaki araç kimliği sayısı (tavan 8).' },
    s.storedVehicleCount,
  ));

  return _bound({ id: 'identity', title: VF_SECTION_TITLE.identity, fields: f });
}

function _ecuSection(s: VfRawSnapshot): VfSection {
  const f: InspectorField[] = [];

  if (s.ecuAddresses === null || s.ecuAddressTotal === null) {
    f.push(unavailable(
      { id: 'vfEcuCount', label: 'görülen ECU sayısı', source: SRC.store, note: '' },
      'Kayıtlı parmak izi YOK → ECU listesi de yok. Boş liste ile "kaynak yok" AYRI şeylerdir.',
    ));
    return _bound({ id: 'ecu', title: VF_SECTION_TITLE.ecu, fields: f });
  }

  f.push(observed(
    { id: 'vfEcuCount', label: 'görülen ECU sayısı', source: SRC.store,
      note: 'Handshake sırasında yanıt veren ECU adresleri (normalize + tekil).' },
    s.ecuAddressTotal,
  ));

  f.push(s.ecuAddresses.length > 0
    ? observed(
        { id: 'vfEcuList', label: 'ECU adresleri', source: SRC.store,
          note: s.ecuAddressTotal > s.ecuAddresses.length
            ? `Bounded liste — ${s.ecuAddressTotal} adresin ilk ${s.ecuAddresses.length} tanesi.`
            : 'Tam liste.' },
        s.ecuAddresses.join(' · '),
      )
    : unavailable(
        { id: 'vfEcuList', label: 'ECU adresleri', source: SRC.store, note: '' },
        'Kimlik kaydı VAR ama ECU adresi BOŞ — handshake adres toplayamamış. Bu gerçek bir boşluktur.',
      ));

  // Keşif deposundaki son kayıt damgası — GERÇEK kaynak yoksa "son keşif" UYDURULMAZ.
  f.push(s.recordLastSeenAt
    ? observed(
        { id: 'vfLastDiscoveryAt', label: 'son keşif kaydı', source: SRC.repo, updatedAt: s.recordLastSeenAt,
          note: 'Keşif deposundaki EN YENİ kayıt damgası.' },
        new Date(s.recordLastSeenAt).toISOString(),
      )
    : unavailable(
        { id: 'vfLastDiscoveryAt', label: 'son keşif kaydı', source: SRC.repo, note: '' },
        s.recordTotal === null
          ? 'Depo anahtarı üretilemedi (VIN özeti yok) — zaman damgası YOK.'
          : 'Depoda damgalı kayıt yok — "şimdi" YAZILMAZ.',
      ));

  return _bound({ id: 'ecu', title: VF_SECTION_TITLE.ecu, fields: f });
}

function _dataSection(s: VfRawSnapshot): VfSection {
  const f: InspectorField[] = [];

  /* ── Desteklenen PID'ler: kaynak null/boş ayrımını KENDİSİ verir ──────── */
  if (s.supportedPids === null || s.supportedPidTotal === null) {
    f.push(unavailable(
      { id: 'vfPidCount', label: 'desteklenen PID sayısı', source: SRC.pids, note: '' },
      'PID keşfi HİÇ yapılmadı (getSupportedPids() null döndü). Sıfır göstermek ' +
      '"araç hiç PID desteklemiyor" yalanı olurdu.',
    ));
  } else {
    f.push(observed(
      { id: 'vfPidCount', label: 'desteklenen PID sayısı', source: SRC.pids,
        note: 'Mode 01 destek maskesinden çözülen PID kümesi.' },
      s.supportedPidTotal,
    ));
    f.push(s.supportedPids.length > 0
      ? observed(
          { id: 'vfPidList', label: 'PID listesi', source: SRC.pids,
            note: s.supportedPidTotal > s.supportedPids.length
              ? `Bounded liste — ${s.supportedPidTotal} PID'in ilk ${s.supportedPids.length} tanesi.`
              : 'Tam liste.' },
          s.supportedPids.join(' '),
        )
      : unavailable(
          { id: 'vfPidList', label: 'PID listesi', source: SRC.pids, note: '' },
          'Keşif YAPILDI ama küme BOŞ — bu gerçek bir sonuçtur (kaynak yokluğu değil).',
        ));
  }

  /* ── Otomatik DID'ler: API boş/taranmadı ayrımını VERMİYOR ────────────── */
  if (s.autoDids === null || s.autoDidTotal === null) {
    f.push(unavailable(
      { id: 'vfDidCount', label: 'otomatik keşfedilmiş DID sayısı', source: SRC.dids, note: '' },
      'Kaynak okunamadı.',
    ));
  } else if (s.autoDidTotal === 0) {
    f.push(unavailable(
      { id: 'vfDidCount', label: 'otomatik keşfedilmiş DID sayısı', source: SRC.dids, note: '' },
      'Boş dizi döndü. Bu API "tarama yapılmadı" ile "tarandı, bulunamadı" arasını ' +
      'AYIRT ETMİYOR — bu yüzden 0 diye HÜKÜM KURULMAZ.',
    ));
  } else {
    f.push(observed(
      { id: 'vfDidCount', label: 'otomatik keşfedilmiş DID sayısı', source: SRC.dids,
        note: 'Oturumdaki otomatik DID taramasının sonucu.' },
      s.autoDidTotal,
    ));
    f.push(observed(
      { id: 'vfDidList', label: 'DID listesi', source: SRC.dids,
        note: s.autoDidTotal > s.autoDids.length
          ? `Bounded liste — ${s.autoDidTotal} DID'in ilk ${s.autoDids.length} tanesi (DID@ECU).`
          : 'Tam liste (DID@ECU).' },
      s.autoDids.map((d) => `${d.did}@${d.ecuRx}`).join(' '),
    ));
  }

  /* ── Kalıcı keşif kayıtları ───────────────────────────────────────────── */
  if (s.recordTotal === null) {
    f.push(unavailable(
      { id: 'vfRecordCount', label: 'kayıtlı keşif kaydı', source: SRC.repo, note: '' },
      'Depo anahtarı üretilemedi: kayıtlı araç (ve VIN özeti) yok. Bu ekran araca ' +
      'sorgu göndererek VIN OKUMAZ — anahtar ancak mevcut kayıttan türetilir.',
    ));
  } else {
    f.push(observed(
      { id: 'vfRecordCount', label: 'kayıtlı keşif kaydı', source: SRC.repo,
        note: 'Bu araç için kalıcı depodaki kayıt sayısı (araç başına tavan 128).' },
      s.recordTotal,
    ));
    f.push(derived(
      { id: 'vfRecordBreakdown', label: 'kayıt kırılımı', source: SRC.repo,
        note: 'Depodaki kayıtların kind alanına göre sayımı.' },
      s.recordPidCount !== null && s.recordDidCount !== null
        ? `${s.recordPidCount} PID · ${s.recordDidCount} DID`
        : null,
    ));
  }

  return _bound({ id: 'data', title: VF_SECTION_TITLE.data, fields: f });
}

function _evidenceSection(health: VfEvidenceResult): VfSection {
  const f: InspectorField[] = [
    derived(
      { id: 'vfHealth', label: 'kanıt sağlığı', source: 'türetim (bu model)',
        note: 'HAZIR = kimlik + ECU + PID + kayıt kaynaklarının hepsi okundu. ' +
              'Kimlik yoksa ASLA HAZIR denmez (fail-closed).' },
      VF_EVIDENCE_LABEL[health.status],
    ),
    observed(
      { id: 'vfSourcesPresent', label: 'okunabilen kaynak', source: 'türetim (bu model)',
        note: 'Dört kaynaktan kaçı gerçekten veri verdi.' },
      `${health.presentCount} / ${health.totalSources}`,
    ),
  ];

  if (health.missing.length === 0) {
    f.push(observed(
      { id: 'vfMissing', label: 'eksik kaynak', source: 'türetim (bu model)',
        note: 'Tüm kaynaklar okundu.' },
      'yok',
    ));
  } else {
    for (const m of health.missing.slice(0, 8)) {
      f.push(unavailable(
        { id: `vfMissing-${m.key}`, label: `eksik: ${m.key}`, source: m.source, note: '' },
        m.reason,
      ));
    }
  }

  return _bound({ id: 'evidence', title: VF_SECTION_TITLE.evidence, fields: f });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kanıt sağlığı — FAIL-CLOSED
 * ════════════════════════════════════════════════════════════════════════ */

export interface VfMissingSource {
  readonly key:    string;
  readonly source: string;
  readonly reason: string;
}

export interface VfEvidenceResult {
  readonly status:       VfEvidenceHealth;
  readonly presentCount: number;
  readonly totalSources: number;
  readonly missing:      readonly VfMissingSource[];
}

/**
 * Dört kaynağın gerçekten okunup okunmadığını sayar.
 *
 * FAIL-CLOSED: kimlik (parmak izi) YOKSA hiçbir koşulda HAZIR denmez — kimlik
 * olmadan diğer kanıtlar hangi araca ait olduğu bilinmeden gösterilir.
 */
export function deriveVfEvidence(s: VfRawSnapshot): VfEvidenceResult {
  const missing: VfMissingSource[] = [];
  let present = 0;

  if (s.identity) present++;
  else missing.push({
    key: 'kimlik', source: SRC.store,
    reason: 'Kayıtlı araç parmak izi yok — handshake henüz kimlik üretmedi.',
  });

  if (s.ecuAddressTotal !== null) present++;
  else missing.push({
    key: 'ECU adresleri', source: SRC.store,
    reason: 'Kimlik kaydı olmadan ECU listesi okunamaz.',
  });

  if (s.supportedPidTotal !== null) present++;
  else missing.push({
    key: 'desteklenen PID', source: SRC.pids,
    reason: 'PID keşfi hiç çalışmadı (getSupportedPids() null).',
  });

  if (s.recordTotal !== null) present++;
  else missing.push({
    key: 'keşif deposu', source: SRC.repo,
    reason: 'VIN özeti üretilemediği için depo anahtarı yok (araca sorgu GÖNDERİLMEZ).',
  });

  const totalSources = 4;
  let status: VfEvidenceHealth;
  if (present === 0)            status = 'NO_SOURCE';
  else if (!s.identity)         status = 'PARTIAL';   // kimlik yoksa ASLA HAZIR
  else if (present < totalSources) status = 'PARTIAL';
  else                          status = 'READY';

  return { status, presentCount: present, totalSources, missing };
}

/** Tüm bölümler, sabit sırada. */
export function buildVfSections(s: VfRawSnapshot): VfSection[] {
  const health = deriveVfEvidence(s);
  return [
    _identitySection(s),
    _ecuSection(s),
    _dataSection(s),
    _evidenceSection(health),
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _bound(section: VfSection): VfSection {
  if (!section || !Array.isArray(section.fields)) return section;
  if (section.fields.length <= MAX_FIELDS_PER_VF_SECTION) return section;
  return { ...section, fields: section.fields.slice(0, MAX_FIELDS_PER_VF_SECTION) };
}

/** Sınıf başına alan sayısı (özet rozetleri). */
export function countByVfClass(sections: readonly VfSection[]): Record<Observability, number> {
  const out: Record<Observability, number> = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
  if (!Array.isArray(sections)) return out;
  for (const s of sections) {
    if (!s || !Array.isArray(s.fields)) continue;
    for (const f of s.fields as readonly InspectorField[]) {
      if (f && Object.prototype.hasOwnProperty.call(out, f.klass)) out[f.klass] += 1;
    }
  }
  return out;
}
