/**
 * PhoneHubFieldValidationScreen — CAROS LAB · İletişim · Phone Hub Saha Doğrulama (P0.8).
 *
 * BU EKRAN BİR ÖLÇÜM DEFTERİDİR, BİR KONTROL DÜZLEMİ DEĞİLDİR. Hiçbir davranış
 * üretmez: eşleştirme YAPMAZ · keşif/tarama BAŞLATMAZ · BLE scan YAPMAZ · RFCOMM
 * AÇMAZ · adapter aç-kapat YAPMAZ · SCO BAŞLATMAZ · ses yolu/modu DEĞİŞTİRMEZ ·
 * medya veya transport komutu GÖNDERMEZ · çağrı BAŞLATMAZ · SMS GÖNDERMEZ · izin
 * İSTEMEZ · vendor servisine BIND OLMAZ · OBD davranışına DOKUNMAZ.
 *
 * P0.5 "Phone Hub Hardware Probe" ekranı SİLİNMEDİ — bu AYRI bir araçtır.
 *
 * ZAMANLAYICI YOK: her ölçüm KULLANICI tarafından elle başlatılır (CAROS LAB deseni).
 *
 * GİZLİLİK: MAC · telefon numarası · kişi adı · mesaj/bildirim içeriği · parça/
 * sanatçı/albüm adı · paket adı · ham build fingerprint bu ekrana HİÇ GELMEZ.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import {
  RefreshCw, ShieldCheck, AlertTriangle, Smartphone, Car, HelpCircle,
  Bluetooth, Music, Phone, Cable, Download, RotateCcw, Play, Plus, HardDriveDownload,
  Link2,
} from 'lucide-react';
import { readPhoneHubFieldSnapshot } from '../../../platform/devtools/phoneHubFieldSources';
import { refreshPhoneHubFieldProbe } from '../../../platform/phoneHub/phoneHubFieldProbe';
import { refreshPhoneHubProbe } from '../../../platform/phoneHub/phoneHubHardwareProbe';
import {
  loadOrCreateFieldSession, saveFieldSession, deleteFieldSession,
} from '../../../platform/devtools/phoneHubFieldStore';
import {
  buildFieldSummary, withIdentity, withScenarioCapture, withScenarioReset,
  withUserAffirmation, withStaleness, createSession, buildFieldExport,
  blockerText, isCriticalBlocker, isSessionStale,
  SCENARIO_ORDER, SCENARIO_TITLE, SCENARIO_INSTRUCTION, SCENARIO_STATUS_LABEL,
  DEVICE_ROLE_LABEL, CONFIDENCE_LABEL, READINESS_LABEL, AUTHORITY_KEY_LABEL,
  AUTHORITY_VALUE_LABEL, COEXISTENCE_LABEL, PHONE_LOCK_MESSAGE, PH_FIELD_BLOCKERS,
  type PhoneHubFieldValidationSession, type ScenarioId, type ScenarioStatus,
  type DeviceRole, type Confidence, type Readiness, type AuthorityDecision,
  type CoexistenceResult,
} from '../../../platform/devtools/phoneHubFieldModel';
import { formatAge, OBSERVABILITY_LABEL } from '../../../platform/devtools/sessionInspectorModel';
import type { Observability } from '../../../platform/devtools/sessionInspectorModel';
import {
  readCompanionFoundationSnapshot,
  type CompanionFoundationSnapshot,
} from '../../../platform/devtools/companionFoundationSources';

/* ══════════════════════════════════════════════════════════════════════════
 * Stiller — RENK TEK BAŞINA ANLAM TAŞIMAZ: her rozette METİN + İKON vardır
 * ════════════════════════════════════════════════════════════════════════ */

const ROLE_STYLE: Record<DeviceRole, string> = {
  HEAD_UNIT_CONFIRMED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  PHONE_CONFIRMED:        'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  ANDROID_DEVICE_UNKNOWN: 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  UNAVAILABLE:            'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
};

const READINESS_STYLE: Record<Readiness, string> = {
  READY_FOR_P1_A:          'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  READY_FOR_MORE_EVIDENCE: 'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  NOT_READY:               'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
};

const CONF_STYLE: Record<Confidence, string> = {
  HIGH:   'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  MEDIUM: 'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  LOW:    'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  NONE:   'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const STATUS_STYLE: Record<ScenarioStatus, string> = {
  CAPTURED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  CAPTURING:   'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  READY:       'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
  BLOCKED:     'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  FAILED:      'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  NOT_STARTED: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
};

const CLASS_STYLE: Record<Observability, string> = {
  OBSERVED:    'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  DERIVED:     'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  UNAVAILABLE: 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-3)]',
  STALE:       'border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] text-[var(--oem-warn)]',
};

const COEX_STYLE: Record<CoexistenceResult, string> = {
  COEXISTENCE_OBSERVED: 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]',
  COEXISTENCE_DERIVED:  'border-[var(--oem-info)] bg-[var(--oem-info-soft)] text-[var(--oem-info)]',
  CONFLICT_RISK:        'border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] text-[var(--oem-danger)]',
  UNKNOWN:              'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]',
};

const SCENARIO_ICON: Record<ScenarioId, typeof Bluetooth> = {
  BASELINE_HEAD_UNIT:      ShieldCheck,
  PHONE_CONNECTED:         Smartphone,
  PHONE_MEDIA_ACTIVE:      Music,
  OBD_CONNECTED:           Cable,
  PHONE_AND_OBD_CONNECTED: Bluetooth,
};

const AUTHORITY_ICON = { bluetooth: Bluetooth, audio: Music, call: Phone, media: Music } as const;

const ROLE_ICON: Record<DeviceRole, typeof Car> = {
  HEAD_UNIT_CONFIRMED:    Car,
  PHONE_CONFIRMED:        Smartphone,
  ANDROID_DEVICE_UNKNOWN: HelpCircle,
  UNAVAILABLE:            HelpCircle,
};

/** Blocker Ekle listesi — SERBEST METİN YOK (PII riski + sabit kod sözleşmesi). */
const MANUAL_BLOCKER_CODES: readonly string[] = [
  'BASELINE_NOT_CLEAN', 'DISCOVERY_ACTIVE_DURING_CAPTURE',
  'OBD_DATA_NOT_FRESH_WITH_PHONE', 'BLUETOOTH_STATE_UNREADABLE',
  'MEDIA_SESSION_ACCESS_DENIED', 'PROFILE_PROXY_NOT_USED',
];

let _sessionCounter = 0;
function _newSessionId(nowMs: number): string {
  _sessionCounter += 1;
  return `phf-${nowMs}-${_sessionCounter}`;
}

/**
 * COMPANION FOUNDATION bölümü (P1-PREP) — SALT GÖZLEM.
 *
 * Bu bölüm hiçbir oturum BAŞLATMAZ, taşıma AÇMAZ, mesaj GÖNDERMEZ ve mock
 * senaryo ÇALIŞTIRMAZ; yalnız sözleşme gerçeklerini ve varsa DİSKTEKİ son kaydı
 * okur. Companion runtime'ı SystemBoot'a BAĞLANMAMIŞTIR (bilinçli) → temiz
 * kurulumda oturum KAYNAK YOK görünür ve bu arıza DEĞİLDİR.
 */
const CompanionFoundationSection = memo(function CompanionFoundationSection(
  { snap }: { snap: CompanionFoundationSnapshot },
) {
  const ready = snap.verdict.readiness === 'READY';
  return (
    <div
      data-testid="phf-section-companion"
      className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
        <span className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          <Link2 size={12} /> 9 · Companion Foundation
        </span>
        <span
          data-testid="companion-readiness"
          data-readiness={snap.verdict.readiness}
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${
            ready
              ? 'border-[var(--oem-good)] bg-[var(--oem-good-soft)] text-[var(--oem-good)]'
              : 'border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] text-[var(--oem-ink-2)]'
          }`}
        >
          {ready ? 'READY' : 'NOT READY'}
        </span>
        <span className="flex items-center gap-1 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-1.5 py-0.5 font-mono text-[9px] text-[var(--oem-warn)]">
          <AlertTriangle size={10} /> GERÇEK BAĞLANTI HAZIR DEĞİL
        </span>
      </div>

      {/* SESSION */}
      <div className="border-b border-[var(--oem-line)] px-3 py-2">
        <div className="mb-1 font-mono text-[10px] uppercase text-[var(--oem-ink-2)]">SESSION</div>
        {snap.session.present ? (
          <div className="grid gap-x-4 gap-y-0.5 font-mono text-[10px] sm:grid-cols-2">
            <div data-testid="companion-session-status">
              durum: <span className="text-[var(--oem-ink)]">{snap.session.status}</span>
            </div>
            <div>nesil: <span className="text-[var(--oem-ink)]">{snap.session.generation}</span></div>
            <div>
              protokol: <span className="text-[var(--oem-ink)]">
                {snap.session.protocolVersion ?? '— (anlaşılmadı)'}
              </span>
            </div>
            <div>taşıma: <span className="text-[var(--oem-ink)]">{snap.session.transportType}</span></div>
            <div>karşı rol: <span className="text-[var(--oem-ink)]">{snap.session.deviceRole}</span></div>
            <div>
              kalp atışı: <span className="text-[var(--oem-ink)]">
                {snap.session.heartbeat}
                {snap.session.lastSeenAgeMs !== null ? ` (${snap.session.lastSeenAgeMs} ms)` : ''}
              </span>
            </div>
          </div>
        ) : (
          <div data-testid="companion-session-absent" className="font-mono text-[10px] text-[var(--oem-ink-3)]">
            KAYNAK YOK — kalıcı oturum kaydı yok. Companion runtime SystemBoot'a
            bağlanmamıştır (bilinçli); bu bir arıza değildir.
          </div>
        )}
      </div>

      {/* TRANSPORT */}
      <div className="border-b border-[var(--oem-line)] px-3 py-2">
        <div className="mb-1 font-mono text-[10px] uppercase text-[var(--oem-ink-2)]">TRANSPORT</div>
        <div className="grid gap-x-4 gap-y-0.5 font-mono text-[10px] sm:grid-cols-2">
          <div data-testid="companion-transport-type">
            adapter: <span className="text-[var(--oem-ink)]">{snap.transport.type} / {snap.transport.adapterId}</span>
          </div>
          <div>bağ durumu: <span className="text-[var(--oem-ink)]">{snap.transport.link}</span></div>
          <div>
            uygulanmış taşıma: <span className="text-[var(--oem-ink)]">
              {snap.contract.implementedTransports.join(', ')} / {snap.contract.declaredTransportCount} beyan
            </span>
          </div>
          <div>gönderilebilir: <span className="text-[var(--oem-ink)]">{snap.transport.writable ? 'EVET' : 'HAYIR'}</span></div>
          <div>
            protokol aralığı: <span className="text-[var(--oem-ink)]">
              {snap.contract.minProtocolVersion}–{snap.contract.protocolVersion}
            </span>
          </div>
          <div>
            olay / eylem: <span className="text-[var(--oem-ink)]">
              {snap.contract.eventCount} / {snap.contract.actionCount} (yürütülebilir {snap.contract.executableActionCount})
            </span>
          </div>
        </div>
        <div className="mt-1 font-mono text-[9px] text-[var(--oem-ink-3)]">
          sınırlar: {snap.transport.limitations.join(' · ')}
        </div>
      </div>

      {/* Kalıcı katman + karşılanmayan koşullar */}
      <div className="px-3 py-2">
        <div className="grid gap-x-4 gap-y-0.5 font-mono text-[10px] sm:grid-cols-2">
          <div>bilinen cihaz: <span className="text-[var(--oem-ink)]">{snap.storage.knownDeviceCount}</span></div>
          <div>yetenek önbelleği: <span className="text-[var(--oem-ink)]">{snap.storage.capabilityCacheCount}</span></div>
          <div>
            bağlantı denemesi: <span className="text-[var(--oem-ink)]">
              {snap.telemetry.present ? snap.telemetry.connectionAttempts : '— (kayıt yok)'}
            </span>
          </div>
          <div>
            yerel destekli yetenek: <span className="text-[var(--oem-ink)]">
              {snap.contract.locallySupportedCapabilityCount} / {snap.contract.capabilityCount}
            </span>
          </div>
        </div>
        <ul className="mt-1 space-y-0.5 font-mono text-[9px] text-[var(--oem-ink-2)]">
          {snap.verdict.unmet.map((u) => (
            <li key={u} data-testid={`companion-unmet-${u}`}>· {u}</li>
          ))}
          {snap.verdict.unmet.length === 0 && <li>· altyapı koşulları sağlandı</li>}
        </ul>
        <p className="mt-1 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          READY burada "gerçek telefona bağlanabiliriz" DEMEK DEĞİLDİR; "iskelet
          uçtan uca çalışıyor" demektir. Uygulanmış tek taşıma MOCK'tur; BLE ·
          RFCOMM · USB · Wi-Fi Direct · TCP · vendor servisi · MCU köprüsü için
          yalnız SÖZLEŞME vardır. Yerel destekli yetenek sayısı bilinçli olarak
          sıfırdır → hiçbir yetenek "anlaşıldı" olamaz (fail-closed).
        </p>
      </div>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * Alt bileşenler
 * ════════════════════════════════════════════════════════════════════════ */

const Badge = memo(function Badge(
  { label, value, style, testId, dataAttr }:
  { label: string; value: string; style: string; testId: string; dataAttr?: string },
) {
  return (
    <span
      data-testid={testId}
      data-value={dataAttr ?? value}
      className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${style}`}
    >
      {label}: {value}
    </span>
  );
});

const AuthorityCard = memo(function AuthorityCard({ d }: { d: AuthorityDecision }) {
  const Icon = AUTHORITY_ICON[d.key];
  return (
    <div
      data-testid={`phf-authority-${d.key}`}
      data-value={d.value}
      data-confidence={d.confidence}
      data-class={d.classification}
      className="rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex items-center gap-1 font-mono text-[11px] text-[var(--oem-info)]">
          <Icon size={12} /> {AUTHORITY_KEY_LABEL[d.key]}
        </span>
        <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${CONF_STYLE[d.confidence]}`}>
          {AUTHORITY_VALUE_LABEL[d.value]}
        </span>
        <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${CLASS_STYLE[d.classification]}`}>
          {OBSERVABILITY_LABEL[d.classification]}
        </span>
        <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${CONF_STYLE[d.confidence]}`}>
          GÜVEN: {CONFIDENCE_LABEL[d.confidence]}
        </span>
      </div>
      <p className="mt-1 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        {d.architecturalConsequence}
      </p>
      <div className="mt-1 font-mono text-[9px] text-[var(--oem-ink-3)]">
        destekleyen kanıt: {d.supportingEvidenceIds.length} · çelişen kanıt: {d.conflictingEvidenceIds.length}
      </div>
    </div>
  );
});

/* ══════════════════════════════════════════════════════════════════════════
 * Ana ekran
 * ════════════════════════════════════════════════════════════════════════ */

export const PhoneHubFieldValidationScreen = memo(function PhoneHubFieldValidationScreen() {
  /* Açılışta tek senkron okuma: kalıcı oturum (yoksa yeni). TIMER/ABONELİK YOK. */
  const [session, setSession] = useState<PhoneHubFieldValidationSession>(() => {
    const now = Date.now();
    return loadOrCreateFieldSession(_newSessionId(now), now);
  });
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [busy, setBusy] = useState<ScenarioId | 'identity' | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [openScenario, setOpenScenario] = useState<ScenarioId | null>(null);
  const [pendingBlocker, setPendingBlocker] = useState<string>(MANUAL_BLOCKER_CODES[0]);
  /* Companion Foundation: açılışta TEK senkron okuma. Timer/abonelik YOK. */
  const [companion, setCompanion] = useState<CompanionFoundationSnapshot>(
    () => readCompanionFoundationSnapshot());

  /* Unmount sonrası setState YASAK (zero-leak) — native pull geri döndüğünde
     bileşen kapanmış olabilir. */
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  /** Oturumu diske yazar; başarısızlığı SESSİZ GEÇMEZ. */
  const persist = useCallback((next: PhoneHubFieldValidationSession) => {
    const ok = saveFieldSession(next);
    if (!ok && mountedRef.current) setMsg('Yerel kayıt başarısız — oturum diske yazılamadı.');
    return next;
  }, []);

  /**
   * Native SALT-OKUNUR gözlemleri tazeler (saha sondası + P0.5 donanım sondası),
   * sonra senkron okur. TEK ATIŞ — polling DEĞİL.
   */
  const pull = useCallback(async () => {
    try {
      await Promise.all([
        refreshPhoneHubFieldProbe().catch(() => { /* fail-soft */ }),
        refreshPhoneHubProbe().catch(() => { /* fail-soft */ }),
      ]);
    } catch { /* fail-soft: kanıt yok → UNAVAILABLE */ }
    return readPhoneHubFieldSnapshot();
  }, []);

  /** Cihaz kimliğini/rolünü tazele — ÖLÇÜM DEĞİL, yalnız kapı. */
  const refreshIdentity = useCallback(() => {
    setBusy('identity');
    void pull().then((raw) => {
      if (!mountedRef.current) return;
      const now = Date.now();
      setNowMs(now);
      setSession((prev) => persist(withIdentity(prev, raw, now)));
      setMsg(raw.fieldPresent ? null : 'Native saha sondası yok (eski APK) — kimlik okunamadı.');
      /* Companion gözlemi de tazelenir (salt-okunur; oturum/taşıma AÇILMAZ). */
      setCompanion(readCompanionFoundationSnapshot());
    }).finally(() => { if (mountedRef.current) setBusy(null); });
  }, [pull, persist]);

  /* Açılışta bir kez kimliği oku (tek atış, polling YOK). */
  useEffect(() => { refreshIdentity(); }, [refreshIdentity]);

  /** Senaryo ölçümü — KULLANICI tetikler. Hiçbir bağlantı kurulmaz. */
  const captureScenario = useCallback((id: ScenarioId) => {
    setBusy(id);
    void pull().then((raw) => {
      if (!mountedRef.current) return;
      const now = Date.now();
      setNowMs(now);
      setSession((prev) => {
        /* Kimlik her ölçümde tazelenir → rol kapısı bayat kalmaz. */
        const withId = withIdentity(prev, raw, now);
        return persist(withScenarioCapture(withId, id, raw, now));
      });
      setOpenScenario(id);
    }).finally(() => { if (mountedRef.current) setBusy(null); });
  }, [pull, persist]);

  const resetScenario = useCallback((id: ScenarioId) => {
    const now = Date.now();
    setNowMs(now);
    setSession((prev) => persist(withScenarioReset(prev, id, now)));
    setMsg('Senaryo yalnız LAB kaydından sıfırlandı — sistem/Bluetooth durumuna DOKUNULMADI.');
  }, [persist]);

  const addBlocker = useCallback((code: string) => {
    const now = Date.now();
    setSession((prev) => persist({
      ...prev,
      updatedAt: now,
      blockers: prev.blockers.includes(code) ? prev.blockers : [...prev.blockers, code],
    }));
  }, [persist]);

  const toggleAffirmation = useCallback(() => {
    setBusy('identity');
    void pull().then((raw) => {
      if (!mountedRef.current) return;
      const now = Date.now();
      setNowMs(now);
      setSession((prev) => persist(withUserAffirmation(prev, !prev.userAffirmedHeadUnit, raw, now)));
    }).finally(() => { if (mountedRef.current) setBusy(null); });
  }, [pull, persist]);

  const startNewSession = useCallback(() => {
    const now = Date.now();
    deleteFieldSession();
    setNowMs(now);
    setSession(persist(createSession(_newSessionId(now), now)));
    setMsg('Yeni saha oturumu açıldı (yalnız yerel kayıt silindi).');
    refreshIdentity();
  }, [persist, refreshIdentity]);

  /** PII'siz JSON dışa aktarma — fail-soft. */
  const exportJson = useCallback(async () => {
    const result = buildFieldExport(session, Date.now());
    const suffix = `${result.bytes} bayt${result.truncated ? ' (kırpıldı)' : ''}`;
    try {
      if (!Capacitor.isNativePlatform()) {
        const blob = new Blob([result.body], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = result.fileName; a.click();
        URL.revokeObjectURL(url);
        if (mountedRef.current) setMsg(`İndirilenler/${result.fileName} · ${suffix}`);
        return;
      }
      const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem');
      let savedPath: string;
      try {
        const res = await Filesystem.writeFile({
          path: result.fileName, data: result.body, directory: Directory.Documents,
          encoding: Encoding.UTF8, recursive: true,
        });
        savedPath = res.uri || `Documents/${result.fileName}`;
      } catch {
        const res = await Filesystem.writeFile({
          path: result.fileName, data: result.body, directory: Directory.External,
          encoding: Encoding.UTF8, recursive: true,
        });
        savedPath = res.uri || `External/${result.fileName}`;
      }
      if (mountedRef.current) setMsg(`${savedPath} · ${suffix}`);
    } catch {
      if (mountedRef.current) setMsg('Dosya kaydı başarısız — dışa aktarma yapılamadı.');
    }
  }, [session]);

  /* Bayatlık YALNIZ görünümde uygulanır (kalıcı kayıt bozulmaz). */
  const view    = useMemo(() => withStaleness(session, nowMs), [session, nowMs]);
  const summary = useMemo(() => buildFieldSummary(view), [view]);
  const sessionStale = useMemo(() => isSessionStale(view, nowMs), [view, nowMs]);
  const id = view.deviceIdentity;
  const RoleIcon = ROLE_ICON[view.deviceRole];

  return (
    <div className="flex h-full flex-col gap-2 overflow-y-auto" data-testid="phone-hub-field-validation">
      {/* ── Salt-okunur beyanı + ÜST ÖZET ────────────────────────────────── */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)] px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 font-mono text-[10px]">
          <span className="flex items-center gap-1 text-[11px] font-bold tracking-wide text-[var(--oem-info)]">
            <Car size={12} /> PHONE HUB SAHA DOĞRULAMA
          </span>
          <span className="flex items-center gap-1 rounded border border-[var(--oem-good)] bg-[var(--oem-good-soft)] px-1.5 py-0.5 text-[var(--oem-good)]">
            <ShieldCheck size={11} /> SALT OKUNUR — bağlantı/komut/izin isteği YOK
          </span>
          <button
            type="button"
            data-testid="phf-refresh-identity"
            onClick={refreshIdentity}
            disabled={busy !== null}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)] disabled:opacity-40"
          >
            <RefreshCw size={11} /> KİMLİĞİ TAZELE
          </button>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            data-testid="phf-device-role"
            data-role={view.deviceRole}
            className={`flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] ${ROLE_STYLE[view.deviceRole]}`}
          >
            <RoleIcon size={11} /> {DEVICE_ROLE_LABEL[view.deviceRole]}
          </span>
          <Badge
            testId="phf-role-confidence" label="ROL GÜVENİ"
            value={CONFIDENCE_LABEL[view.deviceRoleConfidence]}
            dataAttr={view.deviceRoleConfidence}
            style={CONF_STYLE[view.deviceRoleConfidence]}
          />
          <span
            data-testid="phf-readiness"
            data-readiness={summary.readiness}
            className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${READINESS_STYLE[summary.readiness]}`}
          >
            HAZIRLIK: {READINESS_LABEL[summary.readiness]}
          </span>
          <Badge
            testId="phf-control-confidence" label="KONTROL DÜZLEMİ GÜVENİ"
            value={CONFIDENCE_LABEL[summary.controlPlaneConfidence]}
            dataAttr={summary.controlPlaneConfidence}
            style={CONF_STYLE[summary.controlPlaneConfidence]}
          />
          <span
            data-testid="phf-open-blockers"
            data-count={summary.openBlockers.length}
            className="rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--oem-ink-2)]"
          >
            AÇIK ENGEL: {summary.openBlockers.length}
          </span>
          <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">
            ÖLÇÜLEN SENARYO {summary.capturedCount}/{SCENARIO_ORDER.length}
          </span>
        </div>

        {sessionStale && (
          <div
            data-testid="phf-session-stale"
            className="mt-2 rounded border border-[var(--oem-warn)] bg-[var(--oem-warn-soft)] px-2 py-1 font-mono text-[10px] text-[var(--oem-warn)]"
          >
            <AlertTriangle size={11} className="mr-1 inline" />
            BAYAT OTURUM — son güncelleme 24 saatten eski. Yeni oturum açmanız önerilir.
          </div>
        )}

        <p className="mt-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
          Bu araç araç geldiğinde saha doğrulamasını YÖNETİR; kendisi hiçbir bağlantı
          kurmaz. Her ölçüm elle başlatılır. UNKNOWN varsayılandır — kanıt yoksa
          hiçbir alan başarılı gösterilmez. Telefonda alınan ölçüm head unit sonucu
          SAYILMAZ. Periyodik yenileme YOKTUR.
        </p>
      </div>

      {/* ── Cihaz Kimliği ─────────────────────────────────────────────────── */}
      <div
        data-testid="phf-section-identity"
        className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
      >
        <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          1 · Cihaz Kimliği
        </div>
        <div className="grid gap-x-4 gap-y-1 px-3 py-2 font-mono text-[10px] sm:grid-cols-2">
          {id ? (
            <>
              <div>üretici: <span className="text-[var(--oem-ink)]">{id.manufacturer}</span></div>
              <div>model: <span className="text-[var(--oem-ink)]">{id.model}</span></div>
              <div>device: <span className="text-[var(--oem-ink)]">{id.device}</span></div>
              <div>product: <span className="text-[var(--oem-ink)]">{id.product}</span></div>
              <div>Android: <span className="text-[var(--oem-ink)]">{id.androidRelease} (SDK {id.sdkInt > 0 ? id.sdkInt : '—'})</span></div>
              <div>fingerprint özeti: <span className="text-[var(--oem-ink)]">{id.fingerprintSummary}</span></div>
              <div>fingerprint karması: <span className="text-[var(--oem-ink)]">{id.fingerprintHash}</span></div>
              <div>vendor ailesi: <span className="text-[var(--oem-ink)]">{id.vendorFamily}</span></div>
              <div data-testid="phf-automotive-feature">
                automotive özelliği: <span className="text-[var(--oem-ink)]">{id.automotiveFeature}</span>
              </div>
              <div>CarService: <span className="text-[var(--oem-ink)]">{id.carServicePresent}</span></div>
              <div>telephony: <span className="text-[var(--oem-ink)]">{id.telephonyFeature}</span></div>
              <div data-testid="phf-hu-markers">
                head unit işareti: <span className="text-[var(--oem-ink)]">{id.headUnitMarkerCount >= 0 ? id.headUnitMarkerCount : '— (okunamadı)'}</span>
              </div>
              <div>telefon OEM işareti: <span className="text-[var(--oem-ink)]">{id.phoneOemMarkerCount >= 0 ? id.phoneOemMarkerCount : '— (okunamadı)'}</span></div>
            </>
          ) : (
            <div data-testid="phf-identity-unavailable" className="text-[var(--oem-ink-3)]">
              KAYNAK YOK — native saha sondası kimlik döndürmedi. "Kimlik okunamadı"
              ile "head unit değil" AYRI şeylerdir; hiçbiri varsayılmaz.
            </div>
          )}
        </div>
        <div className="border-t border-[var(--oem-line)] px-3 py-2">
          <label className="flex flex-wrap items-center gap-2 font-mono text-[10px] text-[var(--oem-ink-2)]">
            <input
              type="checkbox"
              data-testid="phf-affirm-head-unit"
              checked={view.userAffirmedHeadUnit}
              onChange={toggleAffirmation}
              disabled={busy !== null}
              className="h-3.5 w-3.5"
            />
            Bu cihaz head unit (kullanıcı beyanı)
          </label>
          <p className="mt-1 text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
            Beyan YALNIZ bir kanıt kaydıdır ve teknik kanıtın YERİNE GEÇMEZ: sıfır
            teknik sinyalle rol HEAD UNIT DOĞRULANDI'ya yükselmez, cihaz telefon
            olarak teşhis edildiyse beyan bunu EZMEZ.
          </p>
        </div>
        {view.deviceRole === 'PHONE_CONFIRMED' && (
          <div
            data-testid="phf-phone-lock"
            className="border-t border-[var(--oem-danger)] bg-[var(--oem-danger-soft)] px-3 py-2 font-mono text-[11px] text-[var(--oem-danger)]"
          >
            <AlertTriangle size={12} className="mr-1 inline" />
            {PHONE_LOCK_MESSAGE} Saha aşamaları KİLİTLİ.
          </div>
        )}
      </div>

      {/* ── Senaryo kartları ──────────────────────────────────────────────── */}
      {SCENARIO_ORDER.map((sid) => {
        const rec = view.scenarios.find((s) => s.id === sid);
        if (!rec) return null;
        const Icon = SCENARIO_ICON[sid];
        const locked = summary.scenariosLocked;
        const started = rec.status === 'CAPTURED' || rec.status === 'STALE';
        return (
          <div
            key={sid}
            data-testid={`phf-scenario-${sid}`}
            data-status={rec.status}
            className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
          >
            <div className="flex flex-wrap items-center gap-2 border-b border-[var(--oem-line)] px-3 py-1.5">
              <span className="flex items-center gap-1 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
                <Icon size={12} /> {SCENARIO_TITLE[sid]}
              </span>
              <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] ${STATUS_STYLE[rec.status]}`}>
                {SCENARIO_STATUS_LABEL[rec.status]}
              </span>
              <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">
                {rec.capturedAt !== null
                  ? `son ölçüm: ${formatAge(rec.capturedAt, nowMs) || new Date(rec.capturedAt).toISOString()}`
                  : 'hiç ölçülmedi'}
              </span>
              <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">
                kanıt: {rec.evidence.length}
              </span>
            </div>

            <p className="px-3 pt-2 font-mono text-[10px] leading-relaxed text-[var(--oem-ink-2)]">
              {SCENARIO_INSTRUCTION[sid]}
            </p>

            <div className="flex flex-wrap items-center gap-2 px-3 py-2 font-mono text-[10px]">
              <button
                type="button"
                data-testid={`phf-capture-${sid}`}
                onClick={() => captureScenario(sid)}
                disabled={locked || busy !== null}
                title={locked ? PHONE_LOCK_MESSAGE : undefined}
                className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)] disabled:opacity-40"
              >
                {started ? <RefreshCw size={11} /> : <Play size={11} />}
                {started ? 'YENİDEN ÖLÇ' : 'ÖLÇÜMÜ BAŞLAT'}
              </button>
              <button
                type="button"
                data-testid={`phf-view-${sid}`}
                onClick={() => setOpenScenario(openScenario === sid ? null : sid)}
                className="rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
              >
                SONUCU GÖR
              </button>
              <button
                type="button"
                data-testid={`phf-reset-${sid}`}
                onClick={() => resetScenario(sid)}
                className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
              >
                <RotateCcw size={11} /> SENARYOYU SIFIRLA
              </button>
            </div>

            {openScenario === sid && (
              <div data-testid={`phf-result-${sid}`} className="border-t border-[var(--oem-line)] px-3 py-2">
                {rec.observations.length === 0 && (
                  <div className="font-mono text-[10px] text-[var(--oem-ink-3)]">
                    Bu senaryo henüz ölçülmedi — gözlem yok (boş liste "sorun yok" DEMEK DEĞİLDİR).
                  </div>
                )}
                {rec.observations.map((o) => (
                  <div
                    key={o.key}
                    data-testid={`phf-obs-${sid}-${o.key}`}
                    data-class={o.klass}
                    className="grid grid-cols-[1fr_auto] gap-x-3 border-b border-[var(--oem-line)] py-1 font-mono text-[10px] last:border-b-0"
                  >
                    <span className="text-[var(--oem-ink-2)]">
                      {o.key}: <span className="text-[var(--oem-ink)]">{o.value}</span>
                    </span>
                    <span className={`h-fit rounded border px-1.5 py-0.5 text-[9px] ${CLASS_STYLE[o.klass]}`}>
                      {OBSERVABILITY_LABEL[o.klass]}
                    </span>
                  </div>
                ))}
                {rec.blockers.length > 0 && (
                  <ul className="mt-2 list-inside list-disc space-y-0.5 text-[9px] leading-relaxed text-[var(--oem-warn)]">
                    {rec.blockers.map((b) => (
                      <li key={b} data-testid={`phf-scenario-blocker-${b}`}>{blockerText(b)}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* ── Authority kararları ───────────────────────────────────────────── */}
      <div className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]">
        <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          6 · Otorite Kararları
        </div>
        <div className="flex flex-col gap-2 p-2">
          {summary.authorities.map((d) => <AuthorityCard key={d.key} d={d} />)}

          <div
            data-testid="phf-coexistence"
            data-result={summary.coexistence.result}
            className={`rounded border px-3 py-2 font-mono text-[11px] ${COEX_STYLE[summary.coexistence.result]}`}
          >
            <span className="flex items-center gap-1">
              <Cable size={12} /> OBD EŞZAMANLILIĞI: {COEXISTENCE_LABEL[summary.coexistence.result]}
            </span>
            <div className="mt-1 text-[9px] opacity-80">
              {OBSERVABILITY_LABEL[summary.coexistence.classification]} · GÜVEN:{' '}
              {CONFIDENCE_LABEL[summary.coexistence.confidence]}
            </div>
            <ul className="mt-1 list-inside list-disc space-y-0.5 text-[9px] leading-relaxed opacity-80">
              {summary.coexistence.reasons.map((r) => (
                <li key={r} data-testid={`phf-coex-reason-${r}`}>{blockerText(r)}</li>
              ))}
              {summary.coexistence.reasons.length === 0
                && summary.coexistence.result !== 'COEXISTENCE_OBSERVED' && (
                <li>Gerekçe kaydı yok.</li>
              )}
            </ul>
          </div>
        </div>
      </div>

      {/* ── Blocker listesi ──────────────────────────────────────────────── */}
      <div
        data-testid="phf-section-blockers"
        className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
      >
        <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          7 · Engeller ve Karşılanmayan Koşullar
        </div>
        <ul className="space-y-1 px-3 py-2 text-[10px] leading-relaxed">
          {summary.openBlockers.map((b) => (
            <li
              key={b}
              data-testid={`phf-blocker-${b}`}
              data-critical={isCriticalBlocker(b) ? 'true' : 'false'}
              className={isCriticalBlocker(b) ? 'text-[var(--oem-danger)]' : 'text-[var(--oem-warn)]'}
            >
              {isCriticalBlocker(b) ? '[KRİTİK] ' : '[UYARI] '}{blockerText(b)}
            </li>
          ))}
          {summary.openBlockers.length === 0 && (
            <li className="text-[var(--oem-ink-3)]">Kayıtlı engel yok.</li>
          )}
        </ul>
        <div className="border-t border-[var(--oem-line)] px-3 py-2">
          <div className="mb-1 font-mono text-[9px] text-[var(--oem-ink-3)]">
            P1-A için karşılanmayan koşullar ({summary.unmet.length}):
          </div>
          <ul className="space-y-0.5 font-mono text-[9px] text-[var(--oem-ink-2)]">
            {summary.unmet.map((u) => (
              <li key={u} data-testid={`phf-unmet-${u}`}>· {u}</li>
            ))}
            {summary.unmet.length === 0 && <li>· yok — yedi koşulun tamamı sağlandı.</li>}
          </ul>
        </div>
        <div className="flex flex-wrap items-center gap-2 border-t border-[var(--oem-line)] px-3 py-2 font-mono text-[10px]">
          <select
            data-testid="phf-blocker-select"
            value={pendingBlocker}
            onChange={(e) => setPendingBlocker(e.target.value)}
            className="rounded border border-[var(--oem-line-strong)] bg-[var(--oem-surface-2)] px-1.5 py-1 text-[var(--oem-ink-2)]"
          >
            {MANUAL_BLOCKER_CODES.map((c) => (
              <option key={c} value={c} title={blockerText(c)}>
                {PH_FIELD_BLOCKERS[c]?.critical ? `[KRİTİK] ${c}` : c}
              </option>
            ))}
          </select>
          <button
            type="button"
            data-testid="phf-add-blocker"
            onClick={() => addBlocker(pendingBlocker)}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <Plus size={11} /> BLOCKER EKLE
          </button>
          <span className="text-[9px] text-[var(--oem-ink-3)]">
            Serbest metin YOK — yalnız sabit kod listesi (PII riski ve kod sözleşmesi).
          </span>
        </div>
      </div>

      {/* ── Kanıt dışa aktarma / oturum ──────────────────────────────────── */}
      <div
        data-testid="phf-section-export"
        className="shrink-0 rounded border border-[var(--oem-line)] bg-[var(--oem-surface-1)]"
      >
        <div className="border-b border-[var(--oem-line)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wide text-[var(--oem-info)]">
          8 · Kanıt Dışa Aktarma
        </div>
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 font-mono text-[10px]">
          <button
            type="button"
            data-testid="phf-export"
            onClick={() => { void exportJson(); }}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <Download size={11} /> PII'SİZ JSON DIŞA AKTAR
          </button>
          <button
            type="button"
            data-testid="phf-new-session"
            onClick={startNewSession}
            className="flex items-center gap-1 rounded border border-[var(--oem-line-strong)] px-2 py-1 text-[var(--oem-ink-2)] hover:bg-[var(--oem-surface-2)]"
          >
            <HardDriveDownload size={11} /> YENİ OTURUM
          </button>
          <span className="font-mono text-[9px] text-[var(--oem-ink-3)]">
            oturum: {view.sessionId} · şema v{view.schemaVersion}
          </span>
        </div>
        {msg && (
          <div data-testid="phf-message" className="px-3 pb-2 font-mono text-[10px] text-[var(--oem-ink-2)]">
            {msg}
          </div>
        )}
      </div>

      {/* ── Companion Foundation (P1-PREP) — SALT GÖZLEM ─────────────────── */}
      <CompanionFoundationSection snap={companion} />

      <p className="shrink-0 pb-2 font-mono text-[9px] leading-relaxed text-[var(--oem-ink-3)]">
        KANIT SINIRLARI: automotive özelliğinin bulunmaması cihazın head unit
        OLMADIĞINI kanıtlamaz (birleşik kanıt modeli kullanılır) · tek zayıf paket
        eşleşmesi otorite kanıtı SAYILMAZ · profil/servis VARLIĞI otorite kanıtı
        DEĞİLDİR · A2DP/HFP profil proxy'si bilinçli olarak AÇILMADI (bind sızıntısı
        riski — P0.5 BLOCKER-8 hâlâ açık) · MediaSession listesi etkin bir
        NotificationListener ister, bu fazda izin İSTENMEZ → çoğu cihazda KAYNAK YOK
        kalır · dışa aktarma yalnız YERELDİR, uzak sunucuya gönderim YOKTUR.
      </p>
    </div>
  );
});
