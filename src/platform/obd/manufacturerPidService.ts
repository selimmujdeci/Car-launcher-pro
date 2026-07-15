/**
 * manufacturerPidService — Patch 12B: üretici-özel UDS DID okuma katmanı.
 *
 * extendedPidService'in KARDEŞİ, AYNI felsefe: talep-güdümlü, izleyici YOKKEN sıfır maliyet.
 * Farklı nokta: extendedPidService native'in KENDİ sürekli poll turuna PID ekleyip event dinler;
 * bu servis native'in TEK-SEFERLİK request/response API'sini (`readObdDid`) KENDİ seyrek
 * zamanlayıcısıyla (round-robin, tek DID/tur) çağırır — üretici DID'leri (yağ sıcaklığı,
 * şanzıman verisi…) saniyeler mertebesinde değişir, sürekli poll turuna eklenmesine gerek yok.
 *
 * MALİ-400 KURALI: izleyici YOKKEN zamanlayıcı hiç KURULMAZ (setInterval açılmaz) — boşta
 * bağlantıda dahi sıfır ek trafik/CPU. Son izleyici bırakınca zamanlayıcı DURDURULUR.
 *
 * 7F-31/33 (requestOutOfRange/securityAccessDenied) DID'ler KALICI "desteklenmiyor" işaretlenir
 * (native ayrımı — bkz. ElmProtocol.readDid) — bir daha sorulmaz, ELM327'yi boğmaz.
 * Bağlantı yokken (native reject) fail-soft: değer güncellenmez, dürüst "henüz yok" (undefined) kalır.
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import { logError } from '../crashLogger';
import { recordDiag } from '../obdDiagnosticRecorder';
import { getHandshakeVin } from '../safety/vinContext';
import {
  validateVehicleDidProfile,
  compileVehicleDidProfile,
  decodeCompiledDid,
} from './vehicleDidProfile';
import type { CompiledDidDef, VehicleDidValue } from './vehicleDidProfile';
import { getActiveProtocolClass } from './activeProtocol';
import type { ProtocolClass } from './protocolProfile';

/** Round-robin zamanlayıcı aralığı (ms) — üretici verileri yavaş değişir, 2-5s yeter. */
export const MANUFACTURER_POLL_INTERVAL_MS = 3000;

export interface ManufacturerDidValue {
  /** Patch 12C: sayısal (fiziksel ölçüm) VEYA metin (VIN/parça no gibi kimlik DID'i). */
  value: VehicleDidValue;
  def: CompiledDidDef;
  updatedAt: number;
}

type Watcher = (v: ManufacturerDidValue) => void;

/* ── Modül durumu ─────────────────────────────────────────────────────────── */
let _profile: ReadonlyMap<string, CompiledDidDef> | null = null;
/** PR-OBD-KWP-1: profilin protokol kısıtı (null = kısıt yok). Tick, aktif protokol sınıfı
 *  bu listede DEĞİLSE sorgu yapmaz — CAN header'lı profili KWP hattına göndermek
 *  COMM_ERROR fırtınasıdır (Trafic sahasındaki "Mode 22 başarısız" kök nedenlerinden biri). */
let _profileProtocols: ProtocolClass[] | null = null;
const _watchers = new Map<string, Set<Watcher>>();
const _values = new Map<string, ManufacturerDidValue>();
const _unsupported = new Set<string>(); // 7F-31/33 → KALICI desteklenmiyor
let _timer: ReturnType<typeof setInterval> | null = null;
let _rrIndex = 0;
let _inFlight = false; // önceki tur bitmeden yenisi başlamaz (yavaş ECU/pending zinciri)

/* ── PR-OBD-DATA-1: Mode-22 acquisition KANITI (bounded, fail-closed, provenance) ──
 * "Trafic'te Mode-22'den gerçek değer mi geliyor yoksa fail-closed 'desteklenmiyor/kanıt
 * yok' mu" sorusunu tek raporla yanıtlar (DIAG-3'ün DID-yolu karşılığı). Her _tick sonucu
 * (SUPPORTED/UNSUPPORTED/NO_DATA/DECODE_FAIL/COMM_ERROR) sayaca + son-8 halkasına işlenir.
 * SAHTE DEĞER ÜRETİLMEZ: yalnız native readObdDid gerçekliği kaydedilir. PII yok (DID/ECU
 * header enum'dur; değer GÖVDESİ saklanmaz, yalnız valuePresent bayrağı). */
type M22Outcome = 'SUPPORTED' | 'UNSUPPORTED' | 'NO_DATA' | 'DECODE_FAIL' | 'COMM_ERROR';
const M22_RING_CAP = 8;
const _m22 = {
  probed: 0, supported: 0, unsupported: 0, noData: 0, decodeFail: 0, commError: 0,
  lastOutcome: null as M22Outcome | null,
  lastDid: null as string | null,
  lastSupportedDid: null as string | null,
  lastAt: 0,
  ring: [] as { did: string; outcome: M22Outcome; tx: string; rx: string; valuePresent: boolean }[],
};
const _m22Sat = (n: number): number => (n >= 1_000_000_000 ? n : n + 1);
function _recordM22(def: CompiledDidDef, outcome: M22Outcome, valuePresent: boolean): void {
  _m22.probed = _m22Sat(_m22.probed);
  switch (outcome) {
    case 'SUPPORTED':   _m22.supported = _m22Sat(_m22.supported); _m22.lastSupportedDid = def.did; break;
    case 'UNSUPPORTED': _m22.unsupported = _m22Sat(_m22.unsupported); break;
    case 'NO_DATA':     _m22.noData = _m22Sat(_m22.noData); break;
    case 'DECODE_FAIL': _m22.decodeFail = _m22Sat(_m22.decodeFail); break;
    case 'COMM_ERROR':  _m22.commError = _m22Sat(_m22.commError); break;
  }
  _m22.lastOutcome = outcome;
  _m22.lastDid = def.did;
  _m22.lastAt = Date.now();
  if (_m22.ring.length >= M22_RING_CAP) _m22.ring.shift();
  _m22.ring.push({ did: def.did, outcome, tx: def.tx, rx: def.rx, valuePresent });
}

/* ── Profil yönetimi ──────────────────────────────────────────────────────── */

/**
 * Profil yükler — şema doğrulaması BAŞARISIZSA profil YÜKLENMEZ, dürüst hata listesi döner
 * (önceki yüklü profil varsa DOKUNULMAZ). Başarılıysa yeni profil eskisini TAMAMEN değiştirir
 * (önbellek/desteklenmiyor işaretleri sıfırlanır — farklı araca takılan adaptör senaryosu).
 */
export function loadProfile(rawProfile: unknown): { ok: true } | { ok: false; errors: string[] } {
  const result = validateVehicleDidProfile(rawProfile);
  if (!result.valid) return { ok: false, errors: result.errors };
  _profile = compileVehicleDidProfile(result.profile);
  _profileProtocols = result.profile.protocols ? [...result.profile.protocols] as ProtocolClass[] : null;
  _unsupported.clear();
  _values.clear();
  _rrIndex = 0;
  _resetM22(); // PR-OBD-DATA-1: yeni profil = yeni acquisition oturumu
  _syncTimer();
  return { ok: true };
}

/** Profili kaldırır — izleyici kalmışsa bile zamanlayıcı durur (profilsiz okunacak DID yok). */
export function unloadProfile(): void {
  _profile = null;
  _profileProtocols = null;
  _unsupported.clear();
  _values.clear();
  _resetM22(); // PR-OBD-DATA-1: profil kaldırıldı → kanıt sıfırlanır
  _syncTimer();
}

/**
 * PR-OBD-KWP-1: profil bu protokolde uygulanabilir mi? true = sorgu serbest.
 * Kısıt yoksa VEYA aktif protokol BİLİNMİYORSA (null) serbest — bilinmeyen protokolde
 * sorguyu kesmek yanlış-negatif üretirdi; kanıt katmanı sonucu zaten dürüst kaydeder.
 */
function _protocolAllowed(): boolean {
  if (_profileProtocols === null) return true;
  const active = getActiveProtocolClass();
  if (active === null) return true;
  return _profileProtocols.includes(active);
}

/** Yüklü profil var mı. */
export function hasProfile(): boolean {
  return _profile !== null;
}

/* ── Zamanlayıcı (Mali-400: izleyici yokken hiç kurulmaz) ────────────────── */

function _syncTimer(): void {
  const shouldRun = _profile !== null && _watchers.size > 0 && Capacitor.isNativePlatform();
  if (shouldRun && !_timer) {
    _timer = setInterval(() => { void _tick(); }, MANUFACTURER_POLL_INTERVAL_MS);
  } else if (!shouldRun && _timer) {
    clearInterval(_timer);
    _timer = null;
  }
}

function _watchedDids(): string[] {
  const out: string[] = [];
  for (const did of _watchers.keys()) {
    if (_unsupported.has(did)) continue;
    if (!_profile?.has(did)) continue;
    out.push(did);
  }
  return out;
}

async function _tick(): Promise<void> {
  if (_inFlight) return; // önceki tur hâlâ sürüyor — üst üste binme
  const profile = _profile;
  if (!profile) return;
  // PR-OBD-KWP-1: protokol kapısı — CAN-kısıtlı profil KWP hattında SORGULANMAZ
  // (COMM_ERROR fırtınası yerine dürüst "protokol uyumsuz"; getMode22Evidence raporlar).
  if (!_protocolAllowed()) return;
  const dids = _watchedDids();
  if (dids.length === 0 || !CarLauncher.readObdDid) return;

  const did = dids[_rrIndex % dids.length]!;
  _rrIndex++;
  const def = profile.get(did);
  if (!def) return;

  _inFlight = true;
  try {
    const r = await CarLauncher.readObdDid({ tx: def.tx, rx: def.rx, did: def.did, service: def.service });
    if (!r.supported) {
      _unsupported.add(did); // KALICI — bir daha sorulmaz
      _recordM22(def, 'UNSUPPORTED', false); // PR-OBD-DATA-1: fail-closed kanıt (7F)
      return;
    }
    if (!r.data) { _recordM22(def, 'NO_DATA', false); return; } // fail-soft: veri yok ama 7F de değil
    const value = decodeCompiledDid(def, r.data);
    // NaN yalnız sayısal daldan gelir (metin dalı boş string yerine NaN döner) — type guard
    // `typeof value === 'string'` durumunda Number.isNaN çağrısını atlar (TS + doğruluk).
    if (typeof value === 'number' && Number.isNaN(value)) { _recordM22(def, 'DECODE_FAIL', false); return; } // sınır dışı/bozuk
    const entry: ManufacturerDidValue = { value, def, updatedAt: Date.now() };
    _values.set(did, entry);
    _recordM22(def, 'SUPPORTED', true); // PR-OBD-DATA-1: gerçek manufacturer value okundu (provenance)
    _watchers.get(did)?.forEach((cb) => {
      try { cb(entry); } catch (e) { logError('OBD:ManufacturerDidWatcher', e); }
    });
  } catch (e) {
    // Bağlantı yok / geçici iletişim hatası — fail-soft, dürüst boş kalır (değer güncellenmez).
    _recordM22(def, 'COMM_ERROR', false); // PR-OBD-DATA-1: link/adresleme hatası (KWP uyumsuzluğu işareti)
    logError('OBD:ManufacturerDidRead', e);
  } finally {
    _inFlight = false;
  }
}

/* ── Genel API (extendedPidService ile aynı imza ailesi) ─────────────────── */

/**
 * Bir DID'i izlemeye başla. İlk izleyici zamanlayıcıyı başlatır; son izleyici ayrılınca durur
 * (sıfır maliyete dönüş). Önbellekte değer varsa anında verilir (UI boş beklemesin).
 */
export function watchDid(did: string, cb: Watcher): () => void {
  const key = did.toUpperCase();
  let set = _watchers.get(key);
  if (!set) { set = new Set(); _watchers.set(key, set); }
  set.add(cb);
  _syncTimer();

  const cached = _values.get(key);
  if (cached) { try { cb(cached); } catch { /* watcher hatası yoksayılır */ } }

  return () => {
    const s = _watchers.get(key);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) _watchers.delete(key);
    _syncTimer();
  };
}

/** Son bilinen çözülmüş değer (yoksa undefined — dürüst "henüz yok"). */
export function getDidValue(did: string): ManufacturerDidValue | undefined {
  return _values.get(did.toUpperCase());
}

/** DID KALICI olarak desteklenmiyor mu (7F-31/33)? null = henüz bilinmiyor (sorgulanmadı). */
export function isDidSupported(did: string): boolean | null {
  const key = did.toUpperCase();
  if (_unsupported.has(key)) return false;
  if (_values.has(key)) return true;
  return null;
}

/** Yüklü profildeki TÜM DID tanımları (kopya) — UI/keşif ekranı + sensorQueryService köprüsü için. */
export function getSupportedDids(): CompiledDidDef[] {
  return _profile ? [..._profile.values()] : [];
}

/* ── PR-OBD-DATA-1: Mode-22 acquisition kanıtı (fail-closed karar) ─────────── */

export type Mode22Decision =
  | 'NO_PROFILE'        // üretici DID profili yüklü değil → kanıt yok (fail-closed)
  | 'PROTOCOL_MISMATCH' // PR-OBD-KWP-1: profil bu protokol sınıfında uygulanamaz → hiç sorgulanmadı
  | 'NOT_PROBED'        // profil var ama henüz DID sorgulanmadı (izleyici yok / yeni)
  | 'HAS_REAL_VALUE'    // en az bir gerçek manufacturer value okundu
  | 'ALL_UNSUPPORTED'   // sorgulandı, tümü 7F → araç bu DID'leri DESTEKLEMİYOR (fail-closed)
  | 'COMM_FAILING'      // sorgulandı, değer yok + iletişim hatası baskın (KWP adresleme/flaky link)
  | 'INCONCLUSIVE';     // karışık/eksik — kanıt tam değil

export interface Mode22Evidence {
  profileLoaded: boolean;
  /** PR-OBD-KWP-1: true = profil aktif protokol sınıfıyla uyumsuz (sorgu kapalı). */
  protocolGated: boolean;
  watchedCount: number;
  probed: number; supported: number; unsupported: number; noData: number;
  decodeFail: number; commError: number;
  lastOutcome: M22Outcome | null;
  lastDid: string | null;
  lastSupportedDid: string | null;
  lastAt: number;
  lastAttempts: { did: string; outcome: M22Outcome; tx: string; rx: string; valuePresent: boolean }[];
  decision: Mode22Decision;
  evidenceComplete: boolean;
}

/** Fail-closed karar — SAHTE değer yok; yalnız native gerçekliğinden türetilir. */
export function classifyMode22(e: {
  profileLoaded: boolean; watchedCount: number; probed: number; supported: number;
  unsupported: number; commError: number; protocolGated?: boolean;
}): Mode22Decision {
  if (!e.profileLoaded) return 'NO_PROFILE';
  // PR-OBD-KWP-1: sorgu hiç yapılmadıysa VE nedeni protokol kapısıysa bunu söyle —
  // "NOT_PROBED" (izleyici yok) ile "profil bu araçta uygulanamaz" farklı teşhislerdir.
  if (e.protocolGated && e.probed === 0) return 'PROTOCOL_MISMATCH';
  if (e.probed === 0) return 'NOT_PROBED';
  if (e.supported > 0) return 'HAS_REAL_VALUE';
  if (e.unsupported > 0 && e.commError === 0) return 'ALL_UNSUPPORTED';
  if (e.commError > 0) return 'COMM_FAILING';
  return 'INCONCLUSIVE';
}

/** Bounded Mode-22 acquisition kanıtı — Tanı Gönder (obdDeep.mode22) için. */
export function getMode22Evidence(): Mode22Evidence {
  const profileLoaded = _profile !== null;
  const protocolGated = profileLoaded && !_protocolAllowed();
  const watchedCount = _watchers.size;
  const base = {
    profileLoaded, protocolGated, watchedCount,
    probed: _m22.probed, supported: _m22.supported, unsupported: _m22.unsupported,
    commError: _m22.commError,
  };
  const decision = classifyMode22(base);
  return {
    profileLoaded, protocolGated, watchedCount,
    probed: _m22.probed, supported: _m22.supported, unsupported: _m22.unsupported,
    noData: _m22.noData, decodeFail: _m22.decodeFail, commError: _m22.commError,
    lastOutcome: _m22.lastOutcome, lastDid: _m22.lastDid, lastSupportedDid: _m22.lastSupportedDid,
    lastAt: _m22.lastAt, lastAttempts: [..._m22.ring],
    decision,
    // Kanıt "tam" sayılır: karar belirsiz değil VE (probe olduysa) sayaç tutarlı.
    evidenceComplete: decision !== 'INCONCLUSIVE'
      && (_m22.probed === 0
        || _m22.probed === _m22.supported + _m22.unsupported + _m22.noData + _m22.decodeFail + _m22.commError),
  };
}

/** Yeni oturum/profil değişiminde Mode-22 kanıtını sıfırla. */
function _resetM22(): void {
  _m22.probed = _m22.supported = _m22.unsupported = _m22.noData = _m22.decodeFail = _m22.commError = 0;
  _m22.lastOutcome = null; _m22.lastDid = null; _m22.lastSupportedDid = null; _m22.lastAt = 0;
  _m22.ring = [];
}

/* ── VIN çapraz doğrulama (Patch 12C) ────────────────────────────────────── */

export interface VinCrossCheckResult {
  /** null = karşılaştırma yapılamadı (F190 henüz okunmadı veya Mode 09 VIN yok — dürüst
   *  "bilinmiyor", sahte eşleşme/uyuşmazlık İDDİA EDİLMEZ). */
  matched: boolean | null;
  f190Vin: string | null;
  mode09Vin: string | null;
}

/**
 * F190 (UDS ReadDataByIdentifier VIN) DID'ini mevcut el sıkışma VIN'iyle (Mode 09 —
 * buildHandshakeResult → persistHandshakeVin → vinContext yolu) karşılaştırır. Boru hattının
 * uçtan uca kanıtı: iki farklı OBD modu AYNI VIN'i okuyorsa header/ECU adresleme doğrudur.
 *
 * F190 henüz okunmamışsa (profil yüklü değil / DID desteklenmiyor / watchDid ile henüz
 * sorgulanmadı) veya Mode 09 VIN yoksa (el sıkışma başarısız/simülasyon modu) dürüstçe
 * `matched:null` döner — karşılaştırma YAPILMADI demektir, "eşleşmiyor" değil.
 *
 * Eşleşme/uyuşmazlık teşhis zaman çizelgesine (`obdDiagnosticRecorder`) kaydedilir; uyuşmazlık
 * UYARI (`status:'warn'`) — header sızıntısı veya yanlış ECU'ya sorulmuş olabileceğinin işareti.
 */
export function verifyVinAgainstMode09(): VinCrossCheckResult {
  const f190 = getDidValue('F190');
  const f190Vin = typeof f190?.value === 'string' && f190.value.length > 0
    ? f190.value.trim().toUpperCase()
    : null;
  const mode09Raw = getHandshakeVin();
  const mode09Vin = mode09Raw && mode09Raw.trim().length > 0 ? mode09Raw.trim().toUpperCase() : null;

  if (!f190Vin || !mode09Vin) {
    return { matched: null, f190Vin, mode09Vin };
  }

  const matched = f190Vin === mode09Vin;
  recordDiag({
    stage: 'ecuQuery',
    status: matched ? 'success' : 'warn',
    command: '22F190',
    response: f190Vin,
    userMessage: matched
      ? 'VIN doğrulandı: UDS F190, Mode 09 ile eşleşiyor.'
      : 'VIN uyuşmazlığı: UDS F190, Mode 09 VIN\'inden farklı (header sızıntısı veya yanlış ECU işareti olabilir).',
    technicalMessage: `F190=${f190Vin} Mode09=${mode09Vin}`,
  });
  return { matched, f190Vin, mode09Vin };
}

/** Test yardımcıları — üretim kodu çağırmaz. */
export const _internals = {
  reset(): void {
    if (_timer) { clearInterval(_timer); _timer = null; }
    _profile = null;
    _watchers.clear();
    _values.clear();
    _unsupported.clear();
    _rrIndex = 0;
    _inFlight = false;
    _resetM22();
  },
  tick: (): Promise<void> => _tick(),
  hasTimer: (): boolean => _timer !== null,
};
