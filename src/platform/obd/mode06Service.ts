/**
 * mode06Service — P0-OBD-05 · SERVİS 06 TALEP-GÜDÜMLÜ OKUMA KATMANI.
 *
 * ── SÖZLEŞME (pazarlıksız) ────────────────────────────────────────────────
 *  · SALT-OKUNUR. Yazma · aktüatör · servis rutini · oturum değiştirme YOK.
 *  · TALEP-GÜDÜMLÜ. Hiçbir timer kurmaz, kendiliğinden çalışmaz. Yalnız
 *    `runMode06Scan()` çağrılınca hatta çıkar (LAB düğmesi). Mode 01 sıcak
 *    poll'u ve hız/devir akıcılığı ETKİLENMEZ — tarama arka planda tek seferlik
 *    ve düşük öncelikli bir dizi okumadır.
 *  · KEŞİF ZORUNLU. Önce `06 00/20/40/60/80/A0` bitmask zinciri okunur; YALNIZ
 *    ECU'nun DESTEKLİ bildirdiği MID'ler sorgulanır. Desteklenmeyen MID
 *    UYDURULMAZ ve sorulmaz (ELM327'de her desteksiz sorgu ~200 ms bekletir).
 *  · PROVENANCE. Her sonuç hangi ECU'dan geldiğini taşır ve ECU'lar arasında
 *    KARIŞTIRILMAZ (native `withEcuHeader` atomik header yönetir).
 *  · NO DATA / bozuk / zaman aşımı ASLA "PASS" ya da "NORMAL" DEĞİLDİR — ayrı
 *    durum kodlarıyla taşınır.
 *  · OTURUM DİSİPLİNİ. Sonuçlar OBD oturum numarasıyla damgalanır; yeniden
 *    bağlanıldığında (adaptör başka araca takılmış olabilir) eski sonuç
 *    OTOMATİK GEÇERSİZLEŞİR ve "bayat" olarak işaretlenir.
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import { logError } from '../crashLogger';
import { getObdSessionEpoch } from '../obdService';
import { discoverEcus } from './multiEcuScan';
import { lookupEcuIdentity } from './ecuIdentityService';
import type { EcuRole, EcuRoleEvidence } from './ecuRoleModel';
import {
  parseMode06SupportedMids, parseMode06Body, mode06MonitorFamily,
  type Mode06Test,
} from './mode06';

/** Bitmask keşif zinciri — Mode 01 PID 00 ile AYNI desen. */
const DISCOVERY_MIDS = ['00', '20', '40', '60', '80', 'A0'] as const;

/**
 * Bir ECU'da sorgulanacak azami MID sayısı.
 *
 * BÜTÇE: her MID bir ISO-TP çok-çerçeve alışverişidir (~0,3-1,5 sn). 32 MID ×
 * 8 ECU tavanı, en kötü durumda dakikalar sürer. Tavan taramayı ÖNGÖRÜLEBİLİR
 * tutar; kesilen kuyruk `truncated` ile DÜRÜSTÇE bildirilir (sessiz kırpma YOK).
 */
export const MAX_MIDS_PER_ECU = 32;

/** Taranacak azami ECU sayısı — `multiEcuScan.MAX_SCAN_ECUS` ile aynı bütçe felsefesi. */
export const MAX_MODE06_ECUS = 4;

/* ── Sonuç türleri ────────────────────────────────────────────────────────── */

/**
 * Bir MID okumasının SONUCU. `no_data` ve `malformed` KESİNLİKLE `ok` DEĞİLDİR;
 * ayrı tutulmaları bu katmanın varlık sebebidir.
 */
export type Mode06MidStatus = 'ok' | 'no_data' | 'malformed' | 'unsupported' | 'error';

export interface Mode06MidResult {
  readonly mid: string;
  /** Standart aile adı; üretici/tanımsız MID'de `null` (ad UYDURULMAZ). */
  readonly family: string | null;
  readonly status: Mode06MidStatus;
  readonly tests: readonly Mode06Test[];
  /** Ham gövde (hex) — LAB doğruluk denetimi için; `null` = yanıt yok. */
  readonly raw: string | null;
}

export type Mode06EcuStatus = 'ok' | 'unsupported' | 'failed';

export interface Mode06EcuResult {
  /** Provenance — sonucun geldiği ECU. */
  readonly ecuLabel: string;
  readonly ecuTx: string;
  readonly ecuRx: string;
  /**
   * P0-OBD-08 — ECU kimliği. Envanter varsa rol ve kararlı anahtar TAŞINIR;
   * yoksa `unknown`/`null` kalır (uydurma rol YOK). Sonucun hangi sisteme ait
   * olduğu, sonuçtan AYRI bir ekranda aranmak zorunda kalmaz.
   */
  readonly ecuRole: EcuRole;
  readonly ecuRoleEvidence: EcuRoleEvidence;
  readonly ecuKey: string | null;
  readonly status: Mode06EcuStatus;
  /** Keşifte DESTEKLİ bildirilen MID adedi (sorgulanan değil). */
  readonly supportedCount: number;
  /** Bütçe tavanı yüzünden sorgulanMAYAN MID adedi — sessiz kırpma YOK. */
  readonly truncated: number;
  readonly mids: readonly Mode06MidResult[];
}

export interface Mode06Scan {
  /** Taramanın ait olduğu OBD oturumu — epoch değişince sonuç BAYATLAR. */
  readonly epoch: number;
  /** Tarama bitiş anı (Unix ms). */
  readonly atMs: number;
  readonly ecus: readonly Mode06EcuResult[];
  /** Native köprü yok (eski APK) → tarama HİÇ yapılamadı. */
  readonly bridgeMissing: boolean;
}

/* ── Modül durumu (tek anlık görüntü, sınırlı) ────────────────────────────── */

let _scan: Mode06Scan | null = null;
let _running = false;
let _lastError: string | null = null;
let _runs = 0;

/** Tarama şu an sürüyor mu (LAB düğmeyi kilitler). */
export function isMode06ScanRunning(): boolean { return _running; }

/**
 * Son tarama — YOKSA `null`. Oturum değiştiyse sonuç DÖNDÜRÜLÜR ama `stale`
 * bayrağıyla; çağıran onu canlı sanamaz.
 */
export function getMode06Scan(): { scan: Mode06Scan | null; stale: boolean; lastError: string | null; runs: number } {
  let epoch = -1;
  try { epoch = getObdSessionEpoch(); } catch { /* fail-soft */ }
  return {
    scan: _scan,
    stale: _scan !== null && _scan.epoch !== epoch,
    lastError: _lastError,
    runs: _runs,
  };
}

/** @internal — testler arası izolasyon. */
export function _resetMode06ForTest(): void {
  _scan = null; _running = false; _lastError = null; _runs = 0;
}

/* ── Native köprü sarmalayıcısı ───────────────────────────────────────────── */

interface RawRead { data: string | null; kind: string }

async function _readMid(tx: string, rx: string, mid: string): Promise<RawRead> {
  const fn = CarLauncher.readMode06;
  if (!fn) return { data: null, kind: 'BRIDGE_MISSING' };
  try {
    const r = await fn.call(CarLauncher, { tx, rx, mid });
    return { data: r?.data ?? null, kind: typeof r?.kind === 'string' ? r.kind : 'ERROR' };
  } catch (e) {
    /* Hat hatası ARAÇ YETENEĞİ HAKKINDA KANIT DEĞİLDİR — 'unsupported' demeyiz. */
    logError('OBD:Mode06Read', e);
    return { data: null, kind: 'ERROR' };
  }
}

/* ── Tarama ───────────────────────────────────────────────────────────────── */

/** Bir ECU'nun desteklediği MID'leri keşfeder (bitmask zinciri). */
async function _discoverMids(tx: string, rx: string): Promise<{ mids: string[]; reachable: boolean }> {
  const supported = new Set<string>();
  let reachable = false;

  for (let i = 0; i < DISCOVERY_MIDS.length; i++) {
    const base = DISCOVERY_MIDS[i]!;
    const r = await _readMid(tx, rx, base);
    if (r.kind === 'BRIDGE_MISSING') return { mids: [], reachable: false };
    if (r.kind !== 'OK' || r.data === null) break;   // ECU zinciri burada bitiyor
    reachable = true;

    /* Bitmask yanıtı da 46+MID soyulmuş gelir; gövde 4 bayttır (9'un katı DEĞİL),
       bu yüzden kayıt çözücüsünden GEÇİRİLMEZ — ayrı biçimdir. */
    const found = parseMode06SupportedMids(base, r.data);
    found.forEach((m) => supported.add(m));

    /* Zincir yalnız bir sonraki taban DESTEKLİ bildirildiyse ilerler (boşa sorgu yok). */
    const next = DISCOVERY_MIDS[i + 1];
    if (!next || !found.has(next)) break;
  }

  /* Taban MID'lerin kendileri VERİ DEĞİL, bayraktır — sorgulanacak listeden çıkar. */
  for (const b of DISCOVERY_MIDS) supported.delete(b);
  return { mids: [...supported].sort(), reachable };
}

/**
 * ECU kimliğini envanterden alır. Envanter yoksa/bayatsa `unknown` döner —
 * bayat bir rolü sonuca yapıştırmak, başka aracın kimliğini bu araca yazmaktır.
 */
function _identityFor(rx: string, bits: 11 | 29): {
  ecuRole: EcuRole; ecuRoleEvidence: EcuRoleEvidence; ecuKey: string | null;
} {
  try {
    const id = lookupEcuIdentity(rx, bits);
    if (id !== null) return { ecuRole: id.role, ecuRoleEvidence: id.evidence, ecuKey: id.identityKey };
  } catch { /* fail-soft */ }
  return { ecuRole: 'unknown', ecuRoleEvidence: 'none', ecuKey: null };
}

async function _scanEcu(ecuLabel: string, tx: string, rx: string): Promise<Mode06EcuResult> {
  const ident = _identityFor(rx, rx.length === 8 ? 29 : 11);
  const { mids, reachable } = await _discoverMids(tx, rx);

  if (!reachable) {
    /* ECU Mode 06'ya HİÇ yanıt vermedi. Bu "test yok" DEĞİL "sorulamadı"dır. */
    return {
      ecuLabel, ecuTx: tx, ecuRx: rx, ...ident,
      status: 'unsupported', supportedCount: 0, truncated: 0, mids: [],
    };
  }

  const budgeted = mids.slice(0, MAX_MIDS_PER_ECU);
  const truncated = mids.length - budgeted.length;
  const out: Mode06MidResult[] = [];

  for (const mid of budgeted) {
    const r = await _readMid(tx, rx, mid);
    const family = mode06MonitorFamily(parseInt(mid, 16));

    if (r.kind === 'NO_DATA') {
      out.push({ mid, family, status: 'no_data', tests: [], raw: null });
      continue;
    }
    if (r.kind !== 'OK' || r.data === null || r.data.length === 0) {
      out.push({ mid, family, status: 'error', tests: [], raw: r.data });
      continue;
    }
    const parsed = parseMode06Body(r.data);
    if (parsed.tests.length === 0) {
      /* Yanıt geldi ama tek TAM kayıt çıkmadı → bozuk. "Test yok" SAYILMAZ. */
      out.push({ mid, family, status: 'malformed', tests: [], raw: r.data });
      continue;
    }
    out.push({
      mid, family,
      status: parsed.malformed ? 'malformed' : 'ok',
      tests: parsed.tests,
      raw: r.data,
    });
  }

  return {
    ecuLabel, ecuTx: tx, ecuRx: rx, ...ident,
    status: 'ok', supportedCount: mids.length, truncated, mids: out,
  };
}

/**
 * Mode 06 taramasını ÇALIŞTIRIR. Talep-güdümlü: yalnız kullanıcı/LAB tetikler.
 *
 * İdempotent koruma: tarama sürerken ikinci çağrı NO-OP (hat iki kez meşgul
 * edilmez). Fail-soft: bir ECU düşerse tarama DURMAZ, o ECU `failed` işaretlenir.
 */
export async function runMode06Scan(): Promise<Mode06Scan> {
  if (_running) return _scan ?? { epoch: -1, atMs: 0, ecus: [], bridgeMissing: false };
  _running = true;
  _lastError = null;

  let epoch = -1;
  try { epoch = getObdSessionEpoch(); } catch { /* fail-soft */ }

  try {
    if (!Capacitor.isNativePlatform() || !CarLauncher.readMode06) {
      _scan = { epoch, atMs: Date.now(), ecus: [], bridgeMissing: true };
      return _scan;
    }

    /* ECU listesi MEVCUT keşiften gelir — Mode 06 kendi ECU keşfini KURMAZ
       (ikinci topoloji otoritesi olurdu). Keşif yoksa varsayılan motor ECU'suyla
       tek deneme yapılır: bu bir UYDURMA DEĞİL, OBD-II'nin fonksiyonel
       adreslemesidir (boş header → native dokunmaz). */
    let targets: Array<{ label: string; tx: string; rx: string }> = [];
    try {
      const topo = await discoverEcus();
      targets = (topo?.ecus ?? [])
        .slice(0, MAX_MODE06_ECUS)
        .map((e) => ({ label: e.label, tx: e.txHeader, rx: e.rxHeader }));
    } catch { /* fail-soft: keşif okunamadı */ }
    if (targets.length === 0) targets = [{ label: 'Varsayılan (fonksiyonel)', tx: '', rx: '' }];

    const ecus: Mode06EcuResult[] = [];
    for (const t of targets) {
      try {
        ecus.push(await _scanEcu(t.label, t.tx, t.rx));
      } catch (e) {
        logError('OBD:Mode06Ecu', e);
        ecus.push({
          ecuLabel: t.label, ecuTx: t.tx, ecuRx: t.rx,
          ..._identityFor(t.rx, t.rx.length === 8 ? 29 : 11),
          status: 'failed', supportedCount: 0, truncated: 0, mids: [],
        });
      }
    }

    _scan = { epoch, atMs: Date.now(), ecus, bridgeMissing: false };
    _runs += 1;
    return _scan;
  } catch (e) {
    logError('OBD:Mode06Scan', e);
    _lastError = 'Tarama tamamlanamadı';
    _scan = { epoch, atMs: Date.now(), ecus: [], bridgeMissing: false };
    return _scan;
  } finally {
    _running = false;
  }
}

/* ── Özet (LAB ve raporlama için) ─────────────────────────────────────────── */

export interface Mode06Summary {
  readonly ecuCount: number;
  readonly midCount: number;
  readonly testCount: number;
  readonly pass: number;
  readonly fail: number;
  /** Ölçek kimliği tanınmadığı için HÜKÜM VERİLEMEYEN test adedi. */
  readonly unknown: number;
  /** ECU yanıt vermedi. */
  readonly noData: number;
  /** Yanıt geldi ama çözülemedi. */
  readonly malformed: number;
}

/** Saf özet — hüküm ÜRETMEZ, yalnız sayar. */
export function summarizeMode06(scan: Mode06Scan | null): Mode06Summary {
  const s: Mode06Summary = {
    ecuCount: 0, midCount: 0, testCount: 0,
    pass: 0, fail: 0, unknown: 0, noData: 0, malformed: 0,
  };
  if (scan === null) return s;
  let midCount = 0, testCount = 0, pass = 0, fail = 0, unknown = 0, noData = 0, malformed = 0;
  for (const e of scan.ecus) {
    for (const m of e.mids) {
      midCount++;
      if (m.status === 'no_data') noData++;
      if (m.status === 'malformed') malformed++;
      for (const t of m.tests) {
        testCount++;
        if (t.result === 'PASS') pass++;
        else if (t.result === 'FAIL') fail++;
        else unknown++;
      }
    }
  }
  return { ecuCount: scan.ecus.length, midCount, testCount, pass, fail, unknown, noData, malformed };
}
