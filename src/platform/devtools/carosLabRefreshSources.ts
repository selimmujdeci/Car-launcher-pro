/**
 * carosLabRefreshSources — "TÜMÜNÜ YENİLE" için bölüm başına TEK okuma katmanı.
 *
 * ── PAZARLIKSIZ SINIRLAR ────────────────────────────────────────────────────
 *  · YALNIZ MEVCUT okuma çağrıları tetiklenir. Yeni motor · yeni abonelik ·
 *    yeni timer · yeni global durum KURULMAZ.
 *  · Native çağrılar SALT SAYAÇ okumasıdır (`getObdExtendedPollEvidence`,
 *    `getObdExtendedElimination`, `getKwpRecoveryEvidence`): araca komut
 *    GÖNDERMEZ, poll/handshake/Deep Scan TETİKLEMEZ, kuyruk boşaltmaz.
 *  · BAĞLANTI KURMAZ / YENİDEN BAĞLANMAZ. "TAZE bağlantı" ve araca yazan
 *    ekranlar (H-A deneyi vb.) KAPSAM DIŞIDIR — bilinçli kullanıcı eylemidir.
 *  · Her prob kendi try/catch'i içindedir; patlarsa `FAILED` döner ve sessizce
 *    ATLANMAZ ("boş ≠ veri yoktu").
 *  · GİZLİLİK (kural 6): koordinat · adres metni · hedef adı · VIN · ham
 *    komut/transkript bu katmandan GEÇMEZ. Yalnız adet · sınıf · yaş · süre.
 */

import {
  refreshExtendedPollEvidence, getExtendedPollEvidence, getPollEvidenceCacheState,
} from '../obd/extendedPollEvidence';
import {
  refreshExtendedElimination, getExtendedElimination, getExtendedEliminationState,
} from '../obd/extendedElimination';
import {
  refreshKwpRecoveryEvidence, getKwpRecoveryEvidence,
} from '../obd/kwpRecoveryEvidence';
import { readSchedRawSnapshot } from './runtimeSchedulingSources';
import { readLocationEngineSnapshot } from '../location/locationEngineRuntime';
import { getFixAgeLedger } from '../gpsService';
import { getEtaJumpLedger } from '../navigationService';
import { readNavigationCoreSnapshot } from './navigationCoreSources';
import { readAddressSearchSnapshot, readProviderStatus } from './addressSearchSources';
import { ETA_JUMP_TRIGGER_LABEL } from '../navigation/core/etaJumpLedger';
import type {
  CarosLabRefreshProbe, CarosLabRefreshSectionId,
} from './carosLabRefreshModel';

/** Bilinmeyen sayı → sahte 0 yerine dürüst metin. */
function _n(v: number | null | undefined): string {
  return typeof v === 'number' && Number.isFinite(v) ? String(Math.round(v)) : 'BİLİNMİYOR';
}

function _ok(detail: string): CarosLabRefreshProbe {
  return { status: 'REFRESHED', detail };
}
function _none(detail: string): CarosLabRefreshProbe {
  return { status: 'UNAVAILABLE', detail };
}

/* ── 1 · Native extended poll sayacı (#523) ──────────────────────────────── */

async function probeNativePollEvidence(): Promise<CarosLabRefreshProbe> {
  await refreshExtendedPollEvidence();
  const state = getPollEvidenceCacheState();
  if (state === 'unsupported') {
    return _none('Native sayaç metodu yok (web modu / eski APK) — kanıt üretilemez.');
  }
  if (state === 'error') {
    return { status: 'FAILED', detail: 'Native sayaç çağrısı hata döndü.' };
  }
  const ev = getExtendedPollEvidence();
  if (!ev.present || ev.counters === null) {
    return _none(`Native yanıt verdi ama sayaç kanıtı YOK — ${ev.decision.label}`);
  }
  const c = ev.counters;
  return _ok(
    `denenen ${_n(c.attempted)} · başarılı ${_n(c.success)} · ` +
    `yapılandırılan PID ${_n(ev.configuredPidCount)} · ${ev.decision.label}`,
  );
}

/* ── 2 · Extended PID eleme sayacı (#524) ────────────────────────────────── */

async function probeNativeElimination(): Promise<CarosLabRefreshProbe> {
  await refreshExtendedElimination();
  const state = getExtendedEliminationState();
  if (state === 'unsupported') {
    return _none('Native eleme metodu yok (web modu / eski APK).');
  }
  if (state === 'error') {
    return { status: 'FAILED', detail: 'Native eleme çağrısı hata döndü.' };
  }
  const e = getExtendedElimination();
  if (e === null) return _none('Eleme anlık görüntüsü OKUNMADI (eleme YOK anlamına GELMEZ).');
  return _ok(
    `izlenen ${_n(e.watchedCount)} · kalıcı elenen ${_n(e.permanentCount)} · ` +
    `duraklatılan ${_n(e.pausedCount)} · tur ${_n(e.cycle)}` +
    (e.stabilizing ? ' · STABİLİZASYON penceresi açık' : ''),
  );
}

/* ── 3 · KWP kurtarma sayacı ─────────────────────────────────────────────── */

async function probeKwpRecovery(): Promise<CarosLabRefreshProbe> {
  await refreshKwpRecoveryEvidence();
  const k = getKwpRecoveryEvidence();
  if (k === null) {
    return _none('KWP kurtarma sayacı okunamadı (native yok / bu protokol kullanılmıyor).');
  }
  return _ok(
    `durum ${k.status} · kurtarma ${_n(k.recoveryCount)}/${_n(k.maxPerSession)} · ` +
    `NO_DATA serisi ${_n(k.coreNoDataStreak)}/${_n(k.threshold)}`,
  );
}

/* ── 4 · Poll zamanlayıcı / kanal anlık görüntüsü ────────────────────────── */

function probePollScheduler(): CarosLabRefreshProbe {
  const s = readSchedRawSnapshot();
  const gate = s.extGate;
  const sess = s.sessionHealth;
  const parts: string[] = [];
  if (gate) {
    parts.push(`izlenen ${_n(gate.watchedCount)} · kapıda ${_n(gate.gatedCount)} · ` +
      `desteklenen ${gate.supportedKnown ? _n(gate.supportedCount) : 'BİLİNMİYOR'}`);
  } else {
    parts.push('sorgu kapısı okunamadı');
  }
  parts.push(sess
    ? `poll ${sess.pollingActive ? 'AKTİF' : 'PASİF'} · veri ${sess.dataFresh ? 'TAZE' : 'BAYAT'}`
    : 'oturum sağlığı okunamadı');
  return _ok(parts.join(' · '));
}

/* ── 5 · Konum motoru (hakem) ────────────────────────────────────────────── */

function probeLocationEngine(): CarosLabRefreshProbe {
  const e = readLocationEngineSnapshot();
  if (e.activeProvider === null && e.sample === null) {
    return _none('Konum motoru henüz hiç fix üretmedi (aktif sağlayıcı YOK).');
  }
  const accM = e.sample?.accuracyM;
  return _ok(
    `durum ${e.state} · sağlayıcı ${e.activeProvider ?? 'YOK'} · ` +
    `güven ${e.sample?.confidence ?? 'UNKNOWN'} · ` +
    `doğruluk ${typeof accM === 'number' ? `±${Math.round(accM)} m` : 'BİLİNMİYOR'} · ` +
    `geçiş ${_n(e.switchCount)} · geri düşme ${_n(e.fallbackCount)}`,
  );
}

/* ── 6 · GPS fix yaşı defteri (#508) ─────────────────────────────────────── */

function probeFixAgeLedger(): CarosLabRefreshProbe {
  const { summary } = getFixAgeLedger();
  if (summary.count === 0) {
    return _none('Defterde örnek YOK — bu oturumda konum kanıtı hiç okunmadı.');
  }
  return _ok(
    `örnek ${_n(summary.count)} · p50 ${_n(summary.p50Ms)} ms · p95 ${_n(summary.p95Ms)} ms · ` +
    `hüküm ${summary.verdict}`,
  );
}

/* ── 7 · Navigasyon çekirdeği ────────────────────────────────────────────── */

function probeNavigationCore(): CarosLabRefreshProbe {
  const s = readNavigationCoreSnapshot();
  return _ok(
    `durum ${s.navStatus} · seyir ${s.isNavigating ? 'AKTİF' : 'PASİF'}` +
    (s.isRerouting ? ' · YENİDEN ROTA' : '') +
    ` · konum fix yaşı ${_n(s.locationFixAgeMs)} ms` +
    (s.locationStale ? ' (BAYAT)' : '') +
    ` · kaynak ${s.locationSource}`,
  );
}

/* ── 8 · ETA sıçrama defteri (#530) ──────────────────────────────────────── */

function probeEtaJumpLedger(): CarosLabRefreshProbe {
  const { records, summary } = getEtaJumpLedger();
  if (records.length === 0) {
    return _none('Defterde kayıt YOK — bu oturumda ETA sıçraması gözlenmedi.');
  }
  return _ok(
    `sıçrama ${_n(summary.total)} · en büyük ${_n(summary.maxAbsDeltaS)} sn · ` +
    `baskın ${summary.dominant === null ? 'BELİRSİZ' : ETA_JUMP_TRIGGER_LABEL[summary.dominant]}`,
  );
}

/* ── 9 · Adres arama kanıtı ──────────────────────────────────────────────── */

async function probeAddressSearch(): Promise<CarosLabRefreshProbe> {
  const snap = readAddressSearchSnapshot();
  /* Sağlayıcı durumu ASENKRON (Keystore). Hata/erişilemezlik → null; sahte
     "anahtar yok" ÜRETİLMEZ ("yok" ile "bilinmiyor" farklı şeylerdir). */
  const provider = await readProviderStatus();
  const providerText = provider === null
    ? 'sağlayıcı BİLİNMİYOR'
    : `sağlayıcı ${provider.name} · anahtar ${provider.hasKey ? 'VAR' : 'YOK'}`;

  if (!snap.ledgerReadable) {
    return { status: 'FAILED', detail: `Arama defteri okunamadı · ${providerText}` };
  }
  if (snap.records.length === 0) {
    return _none(`Defterde deneme YOK — bu oturumda hiç adres araması yapılmadı · ${providerText}`);
  }
  const su = snap.summary;
  return _ok(
    `deneme ${_n(snap.records.length)}` +
    (su ? ` · çözülen ${_n(su.resolvedCount)} · başarısız ${_n(su.failedCount)}` : '') +
    ` · ${providerText}`,
  );
}

/* ── Dağıtıcı ────────────────────────────────────────────────────────────── */

/**
 * Bölümü tazeler. HER ÇAĞRI try/catch içindedir: patlayan bölüm `FAILED` döner,
 * tur DURMAZ ve diğer bölümler yine okunur.
 */
export async function probeRefreshSection(
  id: CarosLabRefreshSectionId,
): Promise<CarosLabRefreshProbe> {
  try {
    switch (id) {
      case 'native-poll-evidence': return await probeNativePollEvidence();
      case 'native-elimination':   return await probeNativeElimination();
      case 'kwp-recovery':         return await probeKwpRecovery();
      case 'poll-scheduler':       return probePollScheduler();
      case 'location-engine':      return probeLocationEngine();
      case 'fix-age-ledger':       return probeFixAgeLedger();
      case 'navigation-core':      return probeNavigationCore();
      case 'eta-jump-ledger':      return probeEtaJumpLedger();
      case 'address-search':       return await probeAddressSearch();
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { status: 'FAILED', detail: `Okuma hata verdi: ${msg.slice(0, 120)}` };
  }
}
