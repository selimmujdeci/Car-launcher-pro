/**
 * companionFoundationSources.ts — Companion Foundation'ın LAB okuma katmanı (P1-PREP).
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ SENKRON, YAN ETKİSİZ okuma. `await` YOK, timer YOK, abonelik YOK.
 *  · Oturum BAŞLATMAZ · taşıma AÇMAZ · mesaj GÖNDERMEZ · mock senaryo ÇALIŞTIRMAZ.
 *    Bu katman yalnızca ZATEN KALICI OLAN kaydı okur.
 *  · Her kaynak AYRI try/catch → biri patlarsa diğerleri okunur.
 *
 * ── NE GÖSTERİR (DÜRÜST BEYAN) ──────────────────────────────────────────────
 * Companion runtime'ı bu fazda SystemBoot'a BAĞLANMAMIŞTIR (bilinçli — gerçek
 * bağlantı P1-A'nın işi). Bu yüzden ekranda "canlı oturum" beklenmez: temiz bir
 * kurulumda oturum KAYNAK YOK görünür ve bu bir arıza DEĞİLDİR. Ekran, sözleşme
 * gerçeklerini (hangi taşıma uygulandı, hangi protokol, hangi olaylar kayıtlı) ve
 * varsa DİSKTEKİ son oturum/telemetri kaydını gösterir.
 */

import {
  assessFoundation, dumpCapabilities, dumpSession, dumpTelemetry,
  companionStorageHealth, loadCompanionSession, loadCompanionTelemetryRaw,
  createCompanionTelemetry, createUnimplementedTransport, dumpTransport,
  createMockTransport,
  COMPANION_EVENT_NAMES, COMPANION_ACTIONS, COMPANION_PROTOCOL_VERSION,
  COMPANION_MIN_PROTOCOL_VERSION, IMPLEMENTED_TRANSPORT_TYPES,
  LOCALLY_SUPPORTED_CAPABILITIES, COMPANION_CAPABILITIES,
  type CapabilitiesDump, type CompanionStorageHealth, type FoundationVerdict,
  type SessionDump, type TelemetryDump, type TransportDump,
} from '../companion';

function _safe<T>(fn: () => T, fallback: T): T {
  try {
    const v = fn();
    return v === undefined || v === null ? fallback : v;
  } catch {
    return fallback;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sözleşme gerçekleri (koddan okunur — kalıcı kayıttan bağımsız)
 * ════════════════════════════════════════════════════════════════════════ */

export interface CompanionContractFacts {
  readonly protocolVersion: number;
  readonly minProtocolVersion: number;
  readonly implementedTransports: readonly string[];
  readonly declaredTransportCount: number;
  readonly eventCount: number;
  readonly actionCount: number;
  /** Yürütücüsü olan eylem sayısı — bu fazda BİLİNÇLİ olarak 0. */
  readonly executableActionCount: number;
  readonly capabilityCount: number;
  /** Yerelde DESTEKLENEN yetenek sayısı — bu fazda BİLİNÇLİ olarak 0. */
  readonly locallySupportedCapabilityCount: number;
}

export function readCompanionContractFacts(): CompanionContractFacts {
  return {
    protocolVersion: COMPANION_PROTOCOL_VERSION,
    minProtocolVersion: COMPANION_MIN_PROTOCOL_VERSION,
    implementedTransports: IMPLEMENTED_TRANSPORT_TYPES,
    declaredTransportCount: 9,
    eventCount: COMPANION_EVENT_NAMES.length,
    actionCount: COMPANION_ACTIONS.length,
    executableActionCount: 0,
    capabilityCount: COMPANION_CAPABILITIES.length,
    locallySupportedCapabilityCount: LOCALLY_SUPPORTED_CAPABILITIES.length,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Birleşik anlık görüntü
 * ════════════════════════════════════════════════════════════════════════ */

export interface CompanionFoundationSnapshot {
  readonly readAt: number;
  readonly contract: CompanionContractFacts;
  readonly storage: CompanionStorageHealth;
  readonly session: SessionDump;
  readonly capabilities: CapabilitiesDump;
  readonly transport: TransportDump;
  readonly telemetry: TelemetryDump;
  readonly verdict: FoundationVerdict;
  /** Canlı runtime var mı — bu fazda DAİMA false (SystemBoot wiring yok). */
  readonly liveRuntimeAttached: boolean;
}

/**
 * Tek atışlık salt-okunur görünüm.
 *
 * Taşıma bölümü için: canlı bir adapter YOKTUR. Bunun yerine SÖZLEŞMENİN durumu
 * gösterilir — mock adapter uygulanmış (implemented:true) ama HİÇ AÇILMAMIŞ
 * (link CLOSED). Böylece ekran "bağlı" izlenimi vermez ama sözleşmenin gerçekten
 * var olduğu görünür.
 */
export function readCompanionFoundationSnapshot(): CompanionFoundationSnapshot {
  const readAt = Date.now();

  const storage = _safe(() => companionStorageHealth(), {
    sessionPresent: false, knownDeviceCount: 0, capabilityCacheCount: 0,
    telemetryPresent: false, schemaVersion: 1,
  });

  const persistedSession = _safe(() => loadCompanionSession(), null);
  const session = dumpSession(persistedSession, readAt);

  /* Yetenek anlaşması RUNTIME'da olur; kalıcı önbellek yalnız İPUCUDUR ve
     `granted` sayılmaz → anlaşma yoksa dürüstçe "KAYNAK YOK" gösterilir. */
  const capabilities = dumpCapabilities(null);

  const telemetrySnapshot = _safe(() => {
    const raw = loadCompanionTelemetryRaw();
    if (raw === null) return null;
    const t = createCompanionTelemetry();
    t.restore(raw);
    return t.snapshot();
  }, null);
  const telemetry = dumpTelemetry(telemetrySnapshot);

  /* Taşıma: kapalı bir MOCK adapter'ın sözleşmesi okunur (açılmaz, gönderilmez). */
  const transport = _safe(() => {
    const mock = createMockTransport({ adapterId: 'lab-observe' });
    return dumpTransport(mock.describe(), mock.status());
  }, dumpTransport(
    createUnimplementedTransport('UNKNOWN').describe(),
    createUnimplementedTransport('UNKNOWN').status(),
  ));

  const verdict = assessFoundation({ session, capabilities, transport, telemetry });

  return {
    readAt,
    contract: readCompanionContractFacts(),
    storage,
    session,
    capabilities,
    transport,
    telemetry,
    verdict,
    liveRuntimeAttached: false,
  };
}
