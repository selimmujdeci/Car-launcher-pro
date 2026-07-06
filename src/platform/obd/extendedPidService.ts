/**
 * extendedPidService — Patch 8C (OBD Core v2): talep-güdümlü genişletilmiş PID katmanı.
 *
 * OS entegrasyon yüzeyi: dashboard widget'ı / teşhis ekranı / sesli asistan bir PID'i
 * `watchPid()` ile izler; servis izlenen listeyi native EXTENDED poll grubuna iletir
 * (turda 1 PID round-robin, POLL_SLOW). Ham hex native'den `obdExtendedData` ile gelir,
 * çözümleme StandardPidRegistry'de yapılır (tek doğruluk kaynağı, test edilebilir).
 *
 * MALİ-400 KURALI (tam sözleşme):
 *  - İzleyici YOKKEN native'e BOŞ liste gider → poll turu tek ek komut bile çalıştırmaz.
 *  - Keşif (desteklenen-PID bitmask) YALNIZCA ilk izleyici geldiğinde başlar — boşta
 *    bağlantıda dahi sıfır ek trafik.
 *  - İzlenen liste TS tavanı ELM_WATCH_CAP (16) ile sınırlı (native tavanı 32 ayrıca var).
 *  - Değer bildirimleri zaten ≤1 olay/poll-turu — UI thread'e yük binmez.
 *
 * KEŞİF: SAE J1979 Mode 01 PID 00/20/40/60 bitmask'leri AYNI extended kanaldan okunur
 * (ekstra native API yok). Zincirleme: 00 → (0x20 destekliyse) 20 → 40 → 60.
 * Keşif tamamlanınca desteklenmeyen izlenen PID'ler native listeden çıkarılır
 * (ELM327'de her desteklenmeyen sorgu ~200ms NO-DATA bekletir — obdPidConfig dersi).
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import type { PluginListenerHandle } from '@capacitor/core';
import { STANDARD_PID_MAP, decodeStandardPid } from './StandardPidRegistry';
import type { StandardPidDef } from './StandardPidRegistry';
import { logError } from '../crashLogger';

/** İzlenebilir PID sayısı TS tavanı — rotasyon gecikmesi makul kalsın (16 PID ≈ 16 tur). */
export const ELM_WATCH_CAP = 16;

/** BURST modu (Canlı Test) tavanı — tüm çekirdek-olmayan PID'ler izlenebilsin. */
export const ELM_WATCH_CAP_BURST = 48;

/** Bitmask keşif PID'leri — sırayla zincirlenir. */
const DISCOVERY_PIDS = ['00', '20', '40', '60'] as const;

export interface ExtendedPidValue {
  /** Çözülmüş fiziksel değer (valid=false ise NaN). */
  value: number;
  /** Kayıt tanımı (ad/birim/kategori). */
  def: StandardPidDef;
  /** Değerin alındığı an (ms, monotonik değil — UI gösterimi için yeterli). */
  updatedAt: number;
  /** Ham data hex (mode/pid başlığı soyulmuş) — Canlı Test doğruluk denetimi için. */
  raw: string;
}

type Watcher = (v: ExtendedPidValue) => void;

/* ── Modül durumu ─────────────────────────────────────────────────────────── */
const _watchers = new Map<string, Set<Watcher>>();      // pid → callback'ler
const _values = new Map<string, ExtendedPidValue>();    // pid → son değer
let _supported: Set<string> | null = null;              // null = keşif tamamlanmadı
let _discoveryQueue: string[] = [];                     // bekleyen bitmask PID'leri
let _listenerHandle: PluginListenerHandle | null = null;
let _listenerStarting = false;
let _burst = false;                                     // Canlı Test burst modu (cap+native hız)

/* ── Bitmask çözümleme (saf — test edilebilir) ────────────────────────────── */

/**
 * Mode 01 desteklenen-PID bitmask'ini çözer. `basePid` '00'/'20'/'40'/'60',
 * dataHex başlığı soyulmuş ≥4 bayt. Bit 7/bayt0 → base+1 … bit 0/bayt3 → base+32.
 * @returns desteklenen PID'ler (2 hane büyük-harf hex).
 */
export function parseSupportedBitmask(basePid: string, dataHex: string): Set<string> {
  const out = new Set<string>();
  const clean = dataHex.replace(/[^0-9A-Fa-f]/g, '');
  if (clean.length < 8) return out;
  const base = parseInt(basePid, 16);
  if (Number.isNaN(base)) return out;
  for (let byteIdx = 0; byteIdx < 4; byteIdx++) {
    const byte = parseInt(clean.substring(byteIdx * 2, byteIdx * 2 + 2), 16);
    if (Number.isNaN(byte)) continue;
    for (let bit = 7; bit >= 0; bit--) {
      if (byte & (1 << bit)) {
        const pidNum = base + byteIdx * 8 + (8 - bit);
        out.add(pidNum.toString(16).toUpperCase().padStart(2, '0'));
      }
    }
  }
  return out;
}

/* ── Native senkronizasyon ────────────────────────────────────────────────── */

/** Native'e gidecek güncel liste: keşif kuyruğu + (destek filtresi uygulanmış) izlenenler. */
function _buildNativeList(): string[] {
  const watched: string[] = [];
  for (const pid of _watchers.keys()) {
    if (!STANDARD_PID_MAP.has(pid)) continue;              // tanımsız PID sorgulanmaz
    if (STANDARD_PID_MAP.get(pid)!.core) continue;         // core zaten ana yoldan akıyor
    if (_supported !== null && !_supported.has(pid)) continue; // araç desteklemiyor
    watched.push(pid);
    if (watched.length >= (_burst ? ELM_WATCH_CAP_BURST : ELM_WATCH_CAP)) break;
  }
  return [..._discoveryQueue, ...watched];
}

function _pushToNative(): void {
  if (!Capacitor.isNativePlatform() || !CarLauncher.setObdExtendedPids) return;
  void CarLauncher.setObdExtendedPids({ pids: _buildNativeList() })
    .catch(() => { /* eski APK / köprü hatası → fail-soft, native liste değişmez */ });
}

/* ── Olay işleme ──────────────────────────────────────────────────────────── */

function _onExtendedData(event: { pid: string; data: string }): void {
  try {
    const pid = (event.pid ?? '').toUpperCase();

    // Keşif yanıtı mı?
    if (_discoveryQueue.includes(pid)) {
      _discoveryQueue = _discoveryQueue.filter((p) => p !== pid);
      const found = parseSupportedBitmask(pid, event.data);
      if (_supported === null) _supported = new Set<string>();
      found.forEach((p) => _supported!.add(p));
      // Zincir: bir sonraki aralığın bitmask PID'i destekliyse kuyruğa ekle.
      const idx = DISCOVERY_PIDS.indexOf(pid as (typeof DISCOVERY_PIDS)[number]);
      const next = idx >= 0 ? DISCOVERY_PIDS[idx + 1] : undefined;
      if (next && found.has(next) && !_discoveryQueue.includes(next)) {
        _discoveryQueue.push(next);
      }
      _pushToNative(); // kuyruk değişti → native listeyi tazele
      return;
    }

    // Normal PID değeri
    const def = STANDARD_PID_MAP.get(pid);
    if (!def) return;
    const value = decodeStandardPid(pid, event.data);
    if (Number.isNaN(value)) return; // bozuk/sınır dışı — sessizce atla (fail-soft, eski sözleşme)
    // raw: ham data hex de saklanır — Canlı Test ekranı doğruluk denetimi için gösterir.
    const entry: ExtendedPidValue = {
      value,
      def,
      updatedAt: Date.now(),
      raw: (event.data ?? '').trim(),
    };
    _values.set(pid, entry);
    _watchers.get(pid)?.forEach((cb) => {
      try { cb(entry); } catch (e) { logError('OBD:ExtPidWatcher', e); }
    });
  } catch (e) {
    logError('OBD:ExtPidData', e);
  }
}

/** Tek seferlik olay dinleyicisi — İLK izleyicide kurulur (boşta sıfır maliyet). */
function _ensureListener(): void {
  if (_listenerHandle || _listenerStarting || !Capacitor.isNativePlatform()) return;
  _listenerStarting = true;
  void CarLauncher.addListener('obdExtendedData', _onExtendedData)
    .then((h) => { _listenerHandle = h; _listenerStarting = false; })
    .catch((e) => { _listenerStarting = false; logError('OBD:ExtPidListen', e); });
}

/** Keşfi başlat (idempotent) — yalnız izleyici varken çağrılır. */
function _ensureDiscovery(): void {
  if (_supported !== null || _discoveryQueue.length > 0) return;
  _discoveryQueue = [DISCOVERY_PIDS[0]];
}

/* ── Genel API ────────────────────────────────────────────────────────────── */

/**
 * Bir standart PID'i izlemeye başla. İlk izleyici keşfi + native polling'i tetikler;
 * son izleyici ayrıldığında native liste boşalır (sıfır maliyete dönüş).
 *
 * @returns unsubscribe fonksiyonu.
 */
export function watchPid(pid: string, cb: Watcher): () => void {
  const key = pid.toUpperCase();
  let set = _watchers.get(key);
  if (!set) { set = new Set(); _watchers.set(key, set); }
  set.add(cb);

  _ensureListener();
  _ensureDiscovery();
  _pushToNative();

  // Önbellekte değer varsa anında ver (UI boş beklemesin).
  const cached = _values.get(key);
  if (cached) { try { cb(cached); } catch { /* watcher hatası yoksayılır */ } }

  return () => {
    const s = _watchers.get(key);
    if (!s) return;
    s.delete(cb);
    if (s.size === 0) _watchers.delete(key);
    _pushToNative(); // izleyici kalmadıysa native liste küçülür/boşalır
  };
}

/** Son bilinen çözülmüş değer (yoksa undefined). */
export function getPidValue(pid: string): ExtendedPidValue | undefined {
  return _values.get(pid.toUpperCase());
}

/** Araç bu PID'i destekliyor mu? null = keşif henüz tamamlanmadı/başlamadı. */
export function isPidSupported(pid: string): boolean | null {
  if (_supported === null) return null;
  return _supported.has(pid.toUpperCase());
}

/** Keşfedilen desteklenen PID seti (kopya); null = keşif yapılmadı. */
export function getSupportedPids(): Set<string> | null {
  return _supported ? new Set(_supported) : null;
}

/**
 * obdService bağlantı kancası — bağlantı kurulunca çağrılır: izleyici varsa native
 * listeyi tazeler ve (gerekiyorsa) keşfi yeniden başlatır. İzleyici yoksa NO-OP
 * (boş liste zaten native varsayılanı).
 */
export function notifyObdConnected(): void {
  if (_watchers.size === 0) return;
  // Yeni bağlantı = muhtemelen aynı araç ama garanti değil; keşif sonucu YENİDEN
  // doğrulanır (farklı araca takılan adaptör senaryosu).
  _supported = null;
  _discoveryQueue = [DISCOVERY_PIDS[0]];
  _ensureListener();
  _pushToNative();
}

/**
 * Teşhis BURST modunu aç/kapat (OBD Canlı Test ekranı görünürlüğüne bağlı). Açıkken:
 *  - TS tavanı ELM_WATCH_CAP_BURST'e yükselir (tüm çekirdek-olmayan PID izlenebilir),
 *  - native pollLoop EXTENDED grubunu her turda TÜMÜYLE okur (setObdDiagnosticBurst).
 * Kapanınca eski düşük-yük rotasyonuna döner (Malı-400 sıfır-maliyet sözleşmesi).
 */
export function setDiagnosticBurst(on: boolean): void {
  if (_burst === on) return;
  _burst = on;
  if (Capacitor.isNativePlatform() && CarLauncher.setObdDiagnosticBurst) {
    void CarLauncher.setObdDiagnosticBurst({ enable: on })
      .catch(() => { /* eski APK / köprü hatası → fail-soft */ });
  }
  _pushToNative(); // cap değişti → native izlenen liste büyür/küçülür
}

/** Test yardımcıları — üretim kodu çağırmaz. */
export const _internals = {
  reset(): void {
    _watchers.clear();
    _values.clear();
    _supported = null;
    _discoveryQueue = [];
    _listenerHandle = null;
    _listenerStarting = false;
    _burst = false;
  },
  onExtendedData: _onExtendedData,
  buildNativeList: _buildNativeList,
  getDiscoveryQueue: () => [..._discoveryQueue],
};
