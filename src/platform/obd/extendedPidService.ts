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
 * KEŞİF: SAE J1979 Mode 01 PID 00/20/40/60/80/A0/C0/E0 bitmask'leri AYNI extended
 * kanaldan okunur (ekstra native API yok). Zincirleme: 00 → (destekliyse) 20 → 40 →
 * 60 → 80 → A0 → C0 → E0; her adım yalnız önceki bitmask sonraki bayrağı set ettiyse.
 * Keşif tamamlanınca desteklenmeyen izlenen PID'ler native listeden çıkarılır
 * (ELM327'de her desteklenmeyen sorgu ~200ms NO-DATA bekletir — obdPidConfig dersi).
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import type { PluginListenerHandle } from '@capacitor/core';
import { STANDARD_PID_MAP, decodeStandardPid } from './StandardPidRegistry';
import type { StandardPidDef } from './StandardPidRegistry';
import {
  recordExtendedTimelineSample, resetExtendedTimeline,
} from './extendedPollTimeline';
import { logError } from '../crashLogger';

/** İzlenebilir PID sayısı TS tavanı — rotasyon gecikmesi makul kalsın (16 PID ≈ 16 tur). */
export const ELM_WATCH_CAP = 16;

/** BURST modu (Canlı Test) tavanı — tüm çekirdek-olmayan PID'ler izlenebilsin. */
export const ELM_WATCH_CAP_BURST = 48;

/**
 * Bitmask keşif PID'leri — sırayla zincirlenir. Her 0x_0 PID, bir sonraki 32'lik
 * aralığın "desteklenen-PID" bayrağıdır; zincir yalnız bir önceki bitmask o bayrağı
 * set ettiyse ilerler (araç desteklemiyorsa boşa sorgu yok — Mali-400 kuralı).
 * PR-PID-1: dizel/emisyon PID'leri (0x64-0x98) 0x60/0x80 bloklarında yaşadığından
 * keşif aralığı 0x80/0xA0/0xC0/0xE0 bloklarına genişletildi.
 */
const DISCOVERY_PIDS = ['00', '20', '40', '60', '80', 'A0', 'C0', 'E0'] as const;

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
/** PR-OBD-KWP-1: native'in oturum-içi demote ettiği PID'ler (ardışık NO_DATA/7F) —
 *  "araç bu PID'i VERMİYOR" gerçek nedeni. Bitmap-destekli ama veri gelmeyen PID
 *  (Trafic 39/39 NO_DATA vakası) artık UI'da dürüstçe etiketlenebilir. */
const _unavailable = new Map<string, string>();          // pid → neden ('no_data')
let _listenerHandle: PluginListenerHandle | null = null;
let _listenerStarting = false;
let _burst = false;                                     // Canlı Test burst modu (cap+native hız)

/* PR-OBD-DIAG-3: JS-tarafı akış sayaçları — native "callbackEmitted" ile birlikte H3'ü
 * (native başarılı ama JS/store'a değer akmadı) köprü-kaybı mı decode-kaybı mı ayırır.
 * Oturumluk (notifyObdConnected'da sıfırlanır); saf sayaç, davranış değiştirmez. */
let _jsEventsReceived = 0;   // bilinen PID için native'den değer olayı geldi
let _jsDecodeFailures = 0;   // olay geldi ama decodeStandardPid NaN döndü (saklanamadı)
let _jsValuesStored = 0;     // başarıyla _values'e yazıldı (→ sample adayı)

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

/**
 * Native'e gidecek güncel liste: keşif kuyruğu + (destek filtresi uygulanmış) izlenenler.
 *
 * S1 FAIL-CLOSED (#503): `_supported === null` iken izlenen PID'ler native'e **GİTMEZ**.
 *
 * ESKİ KUSUR: filtre `_supported !== null && …` yazıyordu → destek kanıtı YOKKEN kapı
 * SESSİZCE AÇILIYORDU. `notifyObdConnected()` her yeniden bağlanmada `_supported`ı null'a
 * çekiyor ama izleyicileri (obdService `_extraPidUnsubs` · SensorPanel · Canlı Test)
 * BIRAKMIYOR — `_clearExtraPidWatches()` yalnız `stopOBD`'de koşar. Sonuç: reconnect'te
 * 16 (burst'te ≤48) PID'in TAMAMI filtresiz native'e gidiyordu; ELM327'de her desteksiz
 * sorgu ~200 ms NO-DATA bekletir → tam olarak `seedSupportedPids`in önlemek için yazıldığı
 * NO-DATA fırtınası (bkz. o fonksiyonun docstring'i).
 *
 * NEDEN "izleyicileri de bırak" DEĞİL: izleyicilerin sahibi bu modül değildir; unsubscribe
 * fonksiyonlarını çağıranlar tutar ve reconnect'te yeniden kurmazlar → panel açıkken sinyal
 * SESSİZCE ölürdü. Kanıt yokken sorgu göndermemek hem fail-closed hem geri dönüşlüdür:
 * keşif (`_discoveryQueue`) ya da handshake tohumu (`seedSupportedPids`) `_supported`ı
 * doldurur doldurmaz `_pushToNative()` yeniden çağrılır ve izlenenler tek turda akmaya başlar.
 */
function _buildNativeList(): string[] {
  const watched: string[] = [];
  // Kanıt yoksa sorgu yok — keşif kuyruğu (bitmask) tek başına gider ve kapıyı o açar.
  if (_supported !== null) {
    for (const pid of _watchers.keys()) {
      if (!STANDARD_PID_MAP.has(pid)) continue;            // tanımsız PID sorgulanmaz
      if (STANDARD_PID_MAP.get(pid)!.core) continue;       // core zaten ana yoldan akıyor
      if (!_supported.has(pid)) continue;                  // araç desteklemiyor
      watched.push(pid);
      if (watched.length >= (_burst ? ELM_WATCH_CAP_BURST : ELM_WATCH_CAP)) break;
    }
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
    _jsEventsReceived++; // PR-OBD-DIAG-3: bilinen PID için değer olayı JS'e ulaştı
    const value = decodeStandardPid(pid, event.data);
    if (Number.isNaN(value)) { _jsDecodeFailures++; return; } // bozuk/sınır dışı — fail-soft (eski sözleşme)
    // raw: ham data hex de saklanır — Canlı Test ekranı doğruluk denetimi için gösterir.
    const entry: ExtendedPidValue = {
      value,
      def,
      updatedAt: Date.now(),
      raw: (event.data ?? '').trim(),
    };
    _values.set(pid, entry);
    _jsValuesStored++; // PR-OBD-DIAG-3: değer saklandı → obdDeep.extended.samples adayı
    _sampleTimeline(entry.updatedAt);   // #512: eleme ↔ tazelik zaman ekseni
    _watchers.get(pid)?.forEach((cb) => {
      try { cb(entry); } catch (e) { logError('OBD:ExtPidWatcher', e); }
    });
  } catch (e) {
    logError('OBD:ExtPidData', e);
  }
}

/* ── Zaman ekseni örneklemesi (kütük #512 · saha hipotezi 2) ────────────────
 * Eleme ↔ tazelik ilişkisini ölçmek için ZATEN olan iki olaya iliştirilir:
 * değer geldiğinde ve bir PID elendiğinde. YENİ TIMER KURULMAZ — kanal
 * sustuğunda örnekleme de durur, ki bu bulgunun kendisidir (boşluk uydurulmaz). */
function _sampleTimeline(nowMs: number): void {
  try {
    const ages: number[] = [];
    for (const v of _values.values()) {
      const age = nowMs - v.updatedAt;
      if (Number.isFinite(age) && age >= 0) ages.push(age);
    }
    recordExtendedTimelineSample({
      atMs:      nowMs,
      watched:   _watchers.size,
      demoted:   _unavailable.size,
      valued:    _values.size,
      ageMsList: ages,
    });
  } catch { /* fail-soft: gözlem ürünü ASLA düşürmez */ }
}

/** PR-OBD-KWP-1: native demote bildirimi — PID turdan düşürüldü (ardışık NO_DATA/7F). */
function _onExtendedPidStatus(event: { pid: string; status: string }): void {
  try {
    const pid = (event.pid ?? '').toUpperCase();
    if (!pid) return;
    _unavailable.set(pid, event.status || 'no_data');
    /* Eleme ANI throttle'dan MUAF kaydedilir — geçişin tam noktası en değerli örnek. */
    _sampleTimeline(Date.now());
    // Değer önbelleği bilinçli KORUNUR: daha önce gerçek değer geldiyse UI onu
    // "bayat + artık akmıyor" olarak gösterebilir (silmek kanıt kaybı olur).
  } catch (e) {
    logError('OBD:ExtPidStatus', e);
  }
}

/** Tek seferlik olay dinleyicisi — İLK izleyicide kurulur (boşta sıfır maliyet). */
function _ensureListener(): void {
  if (_listenerHandle || _listenerStarting || !Capacitor.isNativePlatform()) return;
  _listenerStarting = true;
  void CarLauncher.addListener('obdExtendedData', _onExtendedData)
    .then((h) => { _listenerHandle = h; _listenerStarting = false; })
    .catch((e) => { _listenerStarting = false; logError('OBD:ExtPidListen', e); });
  // PR-OBD-KWP-1: demote bildirimi ayrı kanal — eski APK'da olay hiç gelmez (fail-soft).
  // Handle saklanmaz: dinleyici modül ömrü boyunca yaşar (obdExtendedData ile aynı ömür).
  void CarLauncher.addListener('obdExtendedPidStatus', _onExtendedPidStatus)
    .catch(() => { /* eski plugin — durum bilgisi yok, davranış değişmez */ });
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

/* ── #506: SESSİZLİĞİN SEBEBİ (S1 fail-closed'ın gözlem yüzeyi) ───────────── */

/**
 * Extended sorgu KAPISININ durumu — "neden hiçbir şey sorulmuyor" sorusunun cevabı.
 *
 * NEDEN VAR: #503 ile gürültüyü (NO-DATA fırtınası) SESSİZLİKLE takas ettik. Kapı
 * kapalıyken sistem doğru davranır ama DIŞARIDAN "poll ölü" ile ayırt edilemez —
 * `configuredPidCount: 0/1` hem "kimse izlemiyor" hem "16 PID kanıt bekliyor"
 * anlamına gelebilirdi. Bu getter ikisini AYIRIR.
 *
 * Saf sayım; yan etkisi YOK (native'e hiçbir şey göndermez, durum değiştirmez).
 */
export interface ExtendedGateState {
  /** Destek kanıtı var mı — `false` iken KAPI KAPALIDIR (fail-closed). */
  supportedKnown: boolean;
  /** Kanıtlı destekli PID sayısı (kanıt yoksa 0 — "yok" değil "bilinmiyor" demektir). */
  supportedCount: number;
  /** Kaç PID için izleyici var (core/tanımsız dahil ham izleyici sayısı). */
  watchedCount: number;
  /**
   * Sorgulanabilir OLDUĞU HÂLDE gitmeyen PID sayısı = "beklemede".
   *  · kanıt yokken: tüm çözülebilir non-core izlenenler (kapı kapalı),
   *  · kanıt varken: bitmap'in desteklemediği izlenenler (kalıcı olarak elendi).
   */
  gatedCount: number;
  /** Beklemede olan PID'ler (bounded ≤16) — hangi sinyalin sustuğu görünsün. */
  gatedPids: string[];
  /** Bekleyen bitmask keşif sorgusu sayısı (kapıyı açacak olan iş). */
  discoveryPending: number;
  /** Şu an native'e gitmekte olan liste boyutu (keşif + izlenen). */
  nativeListCount: number;
  /** Tanı BURST modu açık mı (cap'i etkiler). */
  burst: boolean;
}

export function getExtendedGateState(): ExtendedGateState {
  const gatedPids: string[] = [];
  let gatedCount = 0;
  for (const pid of _watchers.keys()) {
    const def = STANDARD_PID_MAP.get(pid);
    if (!def || def.core) continue;                      // zaten sorgulanabilir aday değil
    if (_supported !== null && _supported.has(pid)) continue; // gidiyor
    gatedCount++;                                        // GERÇEK sayı (kırpılmaz)
    if (gatedPids.length < ELM_WATCH_CAP) gatedPids.push(pid); // liste bounded
  }
  return {
    supportedKnown: _supported !== null,
    supportedCount: _supported ? _supported.size : 0,
    watchedCount: _watchers.size,
    gatedCount,
    gatedPids,
    discoveryPending: _discoveryQueue.length,
    nativeListCount: _buildNativeList().length,
    burst: _burst,
  };
}

/* ── PR-OBD-KWP-1: per-PID gerçek durum (tek veri gerçeği için) ───────────── */

export type ExtendedPidStatus =
  | 'live'         // taze değer var (< staleMs)
  | 'stale'        // değer var ama eski
  | 'no_data'      // bitmap destekli görünüyor ama ECU vermiyor (native demote kanıtı)
  | 'unsupported'  // keşif bitmap'i bu PID'i desteklemiyor diyor
  | 'probing';     // henüz kanıt yok (keşif/ilk sorgu sürüyor)

/** Bir extended PID'in GERÇEK durumu — UI "neden okunamıyor"u bununla gösterir.
 *  Fail-closed sıra: gerçek değer kanıtı > native no-data kanıtı > bitmap kanıtı > bilinmiyor. */
export function getPidStatus(pid: string, staleMs = 15_000): ExtendedPidStatus {
  const key = pid.toUpperCase();
  const v = _values.get(key);
  if (v && !_unavailable.has(key)) {
    return Date.now() - v.updatedAt <= staleMs ? 'live' : 'stale';
  }
  if (_unavailable.has(key)) return 'no_data';
  if (_supported !== null && !_supported.has(key)) return 'unsupported';
  return 'probing';
}

/** Native'in demote ettiği PID'ler (kopya) — teşhis raporu/UI listesi için. */
export function getUnavailablePids(): ReadonlyMap<string, string> {
  return new Map(_unavailable);
}

/**
 * Native Handshake keşif sonucunu (tek doğruluk kaynağı) extended katmana TOHUMLAR —
 * extended kanaldan YENİDEN bitmask keşfi beklemeye gerek kalmaz.
 *
 * NEDEN (gerçek araç blocker'ı): `_supported === null` iken `_buildNativeList` destek
 * filtresi uygulayamaz → izlenen TÜM PID'ler (burst'te ≤48) native'e gider; araç
 * desteklemeyen her biri ELM327'de ~200 ms NO-DATA bekletir → poll turu tıkanır
 * (Canlı Test ekranında "araç desteği keşfediliyor"da kalıcı takılma). Handshake bitmap'i
 * blok 00–A0'ı (PID 1–160) kapsar; `StandardPidRegistry`'nin en yüksek PID'i 0x8E (142) →
 * TÜM çözülebilir PID'ler kapsam içindedir (C0/E0 blokları yalnız kayıtta OLMAYAN
 * PID 193+ taşır → yanlış-negatif riski YOK). Yalnız EKLER (hiçbir PID'i "desteksiz"e
 * çevirmez); mevcut extended keşif yanıtları geldikçe UNION'lanmaya devam eder (idempotent).
 *
 * @param supportedPidNums Handshake'ten desteklenen PID numaraları (ör. 0x2F=47).
 */
export function seedSupportedPids(supportedPidNums: Iterable<number>): void {
  const seed = _supported ?? new Set<string>();
  let added = 0;
  for (const n of supportedPidNums) {
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 255) continue;
    const key = n.toString(16).toUpperCase().padStart(2, '0');
    if (!seed.has(key)) { seed.add(key); added++; }
  }
  // Kanıt yoksa dokunma (fail-soft): boş seed + zaten null ise keşif yolu bozulmasın.
  if (seed.size === 0) return;
  _supported = seed;
  if (added > 0 || _watchers.size > 0) _pushToNative(); // destek daraldı → NO-DATA fırtınası biter
}

/**
 * obdService bağlantı kancası — bağlantı kurulunca çağrılır: izleyici varsa native
 * listeyi tazeler ve (gerekiyorsa) keşfi yeniden başlatır. İzleyici yoksa NO-OP
 * (boş liste zaten native varsayılanı).
 */
export function notifyObdConnected(): void {
  // PR-OBD-DIAG-3: yeni bağlantı = yeni oturum → JS akış sayaçları sıfırlanır (native
  // ExtendedPollEvidence.reset ile hizalı). İzleyici olmasa bile sıfırla (kanıt temiz başlasın).
  _jsEventsReceived = 0;
  _jsDecodeFailures = 0;
  _jsValuesStored = 0;
  // PR-OBD-KWP-1: yeni bağlantı = native NO_DATA öğrenmesi de sıfırlandı (ExtendedNoDataTracker
  // reset) → TS aynası da sıfırlanır (farklı araç 'no_data' damgasını miras almasın).
  _unavailable.clear();
  resetExtendedTimeline();   // #512: zaman ekseni de yeni oturuma ait olmalı
  if (_watchers.size === 0) return;
  // Yeni bağlantı = muhtemelen aynı araç ama garanti değil; keşif sonucu YENİDEN
  // doğrulanır (farklı araca takılan adaptör senaryosu).
  //
  // S1 (#503): `_supported = null` artık "filtre kapandı" DEĞİL, "kanıt geçersizleşti"
  // demektir — `_buildNativeList` fail-closed olduğu için bu satır izlenen PID'leri
  // native listeden ÇIKARIR (aşağıdaki _pushToNative yalnız keşif kuyruğunu gönderir).
  // İzleyiciler bilinçli olarak YAŞATILIR: sahipleri onları yeniden kurmaz; keşif/tohum
  // `_supported`ı doldurunca aynı izleyiciler tek turda yeniden akmaya başlar.
  _supported = null;
  _discoveryQueue = [DISCOVERY_PIDS[0]];
  _ensureListener();
  _pushToNative();
}

/**
 * PR-OBD-DIAG-3: JS-tarafı extended akış sayaçları (native kanıtla birleştirilir —
 * bkz. extendedPollEvidence.ts). eventsReceived vs valuesStored, H3'ün köprü-kaybı mı
 * decode-kaybı mı olduğunu ayırır; valuesCached = anlık _values boyutu.
 */
export function getExtendedJsCounters(): {
  eventsReceived: number; decodeFailures: number; valuesStored: number; valuesCached: number;
} {
  return {
    eventsReceived: _jsEventsReceived,
    decodeFailures: _jsDecodeFailures,
    valuesStored: _jsValuesStored,
    valuesCached: _values.size,
  };
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
    _unavailable.clear();
    resetExtendedTimeline();
    _listenerHandle = null;
    _listenerStarting = false;
    _burst = false;
    _jsEventsReceived = 0;
    _jsDecodeFailures = 0;
    _jsValuesStored = 0;
  },
  onExtendedData: _onExtendedData,
  onExtendedPidStatus: _onExtendedPidStatus,
  buildNativeList: _buildNativeList,
  getDiscoveryQueue: () => [..._discoveryQueue],
};
