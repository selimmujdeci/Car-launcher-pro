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
import { discoveryCaptureService } from './discovery';

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
const _watchers = new Map<string, Set<Watcher>>();
const _values = new Map<string, ManufacturerDidValue>();
const _unsupported = new Set<string>(); // 7F-31/33 → KALICI desteklenmiyor
let _timer: ReturnType<typeof setInterval> | null = null;
let _rrIndex = 0;
let _inFlight = false; // önceki tur bitmeden yenisi başlamaz (yavaş ECU/pending zinciri)

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
  // PR-DISC-2: profildeki DID'ler = "katalog" → keşif yakalayıcı bunları "yeni" saymasın.
  discoveryCaptureService.setKnownDids(_profile.keys());
  _unsupported.clear();
  _values.clear();
  _rrIndex = 0;
  _syncTimer();
  return { ok: true };
}

/** Profili kaldırır — izleyici kalmışsa bile zamanlayıcı durur (profilsiz okunacak DID yok). */
export function unloadProfile(): void {
  _profile = null;
  discoveryCaptureService.setKnownDids([]); // katalog boşaldı
  _unsupported.clear();
  _values.clear();
  _syncTimer();
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
  const dids = _watchedDids();
  if (dids.length === 0 || !CarLauncher.readObdDid) return;

  const did = dids[_rrIndex % dids.length]!;
  _rrIndex++;
  const def = profile.get(did);
  if (!def) return;

  _inFlight = true;
  try {
    const r = await CarLauncher.readObdDid({ tx: def.tx, rx: def.rx, did: def.did });
    if (!r.supported) {
      _unsupported.add(did); // KALICI — bir daha sorulmaz
      return;
    }
    if (!r.data) return; // fail-soft: veri yok ama açıkça "desteklenmiyor" da değil
    const value = decodeCompiledDid(def, r.data);
    // NaN yalnız sayısal daldan gelir (metin dalı boş string yerine NaN döner) — type guard
    // `typeof value === 'string'` durumunda Number.isNaN çağrısını atlar (TS + doğruluk).
    if (typeof value === 'number' && Number.isNaN(value)) return; // sınır dışı/bozuk — sessizce atla

    // PR-DISC-2: manufacturer çözümlemesinde KATALOG DIŞI DID varsa keşif hattına düşür.
    // Profildeki (katalog) DID'ler setKnownDids ile "bilinir" işaretli → DiscoveryCaptureService
    // onları ELER (tekrar kaydetmez); yalnız katalog dışı bir DID okunursa yakalanır. Fail-soft.
    try {
      discoveryCaptureService.capture({
        discoverySource: 'DID',
        mode:            '22',
        ecuAddress:      def.rx,
        pidOrDid:        def.did,
        request:         `22${def.did}`,
        rawResponse:     r.data,
        supported:       true,
        decodedValue:    value,
      });
    } catch (e) { logError('OBD:DiscoveryCaptureManufacturerDid', e); }

    const entry: ManufacturerDidValue = { value, def, updatedAt: Date.now() };
    _values.set(did, entry);
    _watchers.get(did)?.forEach((cb) => {
      try { cb(entry); } catch (e) { logError('OBD:ManufacturerDidWatcher', e); }
    });
  } catch (e) {
    // Bağlantı yok / geçici iletişim hatası — fail-soft, dürüst boş kalır (değer güncellenmez).
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
  },
  tick: (): Promise<void> => _tick(),
  hasTimer: (): boolean => _timer !== null,
};
