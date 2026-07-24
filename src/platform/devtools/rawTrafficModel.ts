/**
 * rawTrafficModel.ts — Raw OBD Traffic Inspector'ın SAF görünüm modeli (Faz A2).
 *
 * ═══ GERÇEK VERİ MODELİ (uydurma YOK) ═══════════════════════════════════════
 * Native `obdTraffic` olayı (CarLauncherPlugin.onObdTraffic + BleObdManager.emitBleTraffic)
 * TAM OLARAK dört alan taşır: `{ cmd, resp, ms, ts }`.
 *
 *  ✔ VAR : ts (epoch) · cmd (gönderilen) · resp (ham yanıt, '⚠ ' öneki = hata) · ms (süre)
 *  ✘ YOK : yön alanı · protokol · oturum kimliği · transport/kaynak etiketi
 *          (Classic RfcommChannel ve BLE AYNI olayı AYNI dört alanla yayar →
 *           kayıttan transport bile ayırt EDİLEMEZ)
 *
 * Bu yüzden:
 *  - "Yön" bir ALAN değildir. Her kayıt bir komut→yanıt ÇİFTİdir; TX ve RX o çiftin
 *    iki YARISIDIR. Model kaydı iki görünüm satırına AÇAR — bu türetmedir, uydurma
 *    değil (metin gerçekten kayıtta vardır).
 *  - Protokol/oturum/kaynak SÜTUNU YOKTUR ve FİLTRESİ YOKTUR. Anlık protokol yalnız
 *    oturum düzeyinde bilinir; geçmiş satırlara iliştirmek TELEMETRİ UYDURMAK olurdu.
 *  - `ms` yalnız YANIT satırında gösterilir (komut→yanıt süresi orada anlamlıdır).
 *
 * SAF: I/O yok, timer yok, modül durumu yok, import yan etkisizdir.
 */

import type { ObdTrafficEntry } from '../debug';
import { maskObdTrafficEntry } from './obdTrafficMask';

/* ══════════════════════════════════════════════════════════════════════════
 * Sınırlar (low-end / Mali-400 bütçesi)
 * ════════════════════════════════════════════════════════════════════════ */

/** Görünümde render edilecek AZAMİ satır (kaynak tampon 500 kayıt × 2 yarı). */
export const MAX_VIEW_ROWS = 400;
/** Tek satırda gösterilecek AZAMİ karakter. */
export const MAX_ROW_CHARS = 240;

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Satır sınıfı — YALNIZ gerçek veriden türer:
 *  - SYSTEM : `AT*` adaptör komutu/yanıtı (ELM327 kurulumu; araç veri yolu DEĞİL)
 *  - ERROR  : yanıt hata işareti taşıyor ('⚠', ERROR, UNABLE, STOPPED, BUS INIT)
 *  - TX     : araca giden istek (AT olmayan komut)
 *  - RX     : araçtan gelen yanıt (hata değil)
 */
export type RawTrafficKind = 'TX' | 'RX' | 'SYSTEM' | 'ERROR';

export const RAW_TRAFFIC_KINDS: readonly RawTrafficKind[] = ['TX', 'RX', 'SYSTEM', 'ERROR'] as const;

export interface RawTrafficRow {
  /** Kararlı satır kimliği (React key). */
  readonly id:        string;
  /** Görünüm sıra numarası — kaynak tampondaki kayıt sırası (1'den başlar). */
  readonly seq:       number;
  /** Kaydın zaman damgası (native epoch). TX ve RX yarıları AYNI damgayı taşır —
   *  ham veride ikinci bir zaman YOKTUR, uydurulmaz. */
  readonly ts:        number;
  readonly kind:      RawTrafficKind;
  /** Maskelenmiş içerik (bounded). */
  readonly text:      string;
  /** Komut→yanıt süresi; YALNIZ yanıt satırında (gerçek ölçüm). Aksi hâlde null. */
  readonly elapsedMs: number | null;
  /** Bu satırda kimlik taşıyan yük gizlendi mi. */
  readonly masked:    boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sınıflandırma (saf)
 * ════════════════════════════════════════════════════════════════════════ */

function _compact(s: string): string {
  return s.replace(/[\s>\r\n]/g, '').toUpperCase();
}

/** `AT…` / `ST…` adaptör komutu mu (araç veri yolu değil, ELM327 kurulumu)? */
export function isAdapterCommand(cmd: unknown): boolean {
  if (typeof cmd !== 'string') return false;
  const c = _compact(cmd);
  return c.startsWith('AT') || c.startsWith('ST');
}

const ERROR_MARKERS: readonly string[] = [
  'ERROR', 'UNABLE', 'STOPPED', 'BUSINIT', 'BUSBUSY', 'CANERROR', 'FBERROR', 'DATAERROR',
];

/**
 * Yanıt hata mı? '⚠' öneki native tarafın hata/timeout işaretidir.
 * NOT: `NO DATA` HATA DEĞİLDİR — geçerli bir olumsuz yanıttır (RX kalır).
 */
export function isErrorResponse(resp: unknown): boolean {
  if (typeof resp !== 'string' || resp.length === 0) return false;
  if (resp.startsWith('⚠')) return true;
  const r = _compact(resp);
  return ERROR_MARKERS.some((m) => r.includes(m));
}

/** Komut yarısının sınıfı. */
export function classifyCommand(cmd: unknown): RawTrafficKind {
  return isAdapterCommand(cmd) ? 'SYSTEM' : 'TX';
}

/** Yanıt yarısının sınıfı. Hata her şeyi ezer (güvenlik/teşhis önceliği). */
export function classifyResponse(cmd: unknown, resp: unknown): RawTrafficKind {
  if (isErrorResponse(resp)) return 'ERROR';
  return isAdapterCommand(cmd) ? 'SYSTEM' : 'RX';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Görünüm tamponu temizleme (YEREL — global tampona DOKUNMAZ)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * "Görünümü temizle" işareti: temizleme anındaki SON kaydın kendisi (referans).
 * Halka tamponu her push'ta YENİ dizi üretir ama ELEMAN referansları kararlıdır →
 * indeks kayması olmadan kesin kesim yapılabilir.
 */
export type ViewClearMarker = ObdTrafficEntry | null;

/** İşaretten SONRAKİ kayıtlar. İşaret tampondan düştüyse hepsi görünür (fail-soft). */
export function applyViewClear(
  log: readonly ObdTrafficEntry[],
  marker: ViewClearMarker,
): readonly ObdTrafficEntry[] {
  if (!Array.isArray(log) || log.length === 0) return [];
  if (!marker) return log;
  const idx = log.indexOf(marker);
  if (idx < 0) return log;              // işaret halkadan düşmüş → kesme yok
  return log.slice(idx + 1);
}

/** Temizleme işareti üret (mevcut son kayıt). */
export function makeViewClearMarker(log: readonly ObdTrafficEntry[]): ViewClearMarker {
  return Array.isArray(log) && log.length > 0 ? log[log.length - 1] : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Açma (kayıt → görünüm satırları)
 * ════════════════════════════════════════════════════════════════════════ */

function _clamp(s: string): string {
  return s.length > MAX_ROW_CHARS ? s.slice(0, MAX_ROW_CHARS) + '…' : s;
}

export interface ExpandOptions {
  /** Azami satır (varsayılan MAX_VIEW_ROWS). En YENİ satırlar korunur. */
  readonly maxRows?: number;
  /** Sıra numarasının başlangıç ofseti (kayan tamponda süreklilik için). */
  readonly seqOffset?: number;
}

/**
 * Her kaydı en fazla iki görünüm satırına açar (komut yarısı + yanıt yarısı).
 * Yanıt boşsa yalnız komut satırı üretilir (yanıt UYDURULMAZ).
 * Bozuk kayıt (cmd/resp string değil) ATLANIR — fail-soft.
 */
export function expandTrafficRows(
  log: readonly ObdTrafficEntry[],
  opts: ExpandOptions = {},
): RawTrafficRow[] {
  const max = typeof opts.maxRows === 'number' && opts.maxRows > 0
    ? Math.floor(opts.maxRows) : MAX_VIEW_ROWS;
  const seqOffset = typeof opts.seqOffset === 'number' && opts.seqOffset > 0 ? opts.seqOffset : 0;

  const rows: RawTrafficRow[] = [];
  if (!Array.isArray(log)) return rows;

  for (let i = 0; i < log.length; i++) {
    const e = log[i];
    if (!e || typeof e.cmd !== 'string') continue;
    const seq = seqOffset + i + 1;
    const ts = typeof e.ts === 'number' ? e.ts : 0;
    const view = maskObdTrafficEntry(e.cmd, e.resp);

    rows.push({
      id:        `${seq}-tx`,
      seq,
      ts,
      kind:      classifyCommand(e.cmd),
      text:      _clamp(view.cmd),
      elapsedMs: null,
      masked:    view.masked,
    });

    const rawResp = typeof e.resp === 'string' ? e.resp : '';
    if (rawResp.length > 0) {
      rows.push({
        id:        `${seq}-rx`,
        seq,
        ts,
        kind:      classifyResponse(e.cmd, rawResp),
        text:      _clamp(view.resp),
        elapsedMs: typeof e.ms === 'number' && Number.isFinite(e.ms) ? e.ms : null,
        masked:    view.masked,
      });
    }
  }

  // Bounded: en YENİ satırlar korunur.
  return rows.length > max ? rows.slice(rows.length - max) : rows;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Filtreleme (saf)
 * ════════════════════════════════════════════════════════════════════════ */

export interface RawTrafficFilter {
  /** Görünür sınıflar. Boş küme → hiçbiri. */
  readonly kinds: ReadonlySet<RawTrafficKind>;
  /** Serbest metin araması (büyük/küçük harf duyarsız). Boş → filtre yok. */
  readonly query: string;
}

export const ALL_KINDS: ReadonlySet<RawTrafficKind> = new Set<RawTrafficKind>(RAW_TRAFFIC_KINDS);

/** Sınıf + metin filtresi. Sonuç da bounded'dır (girdi zaten bounded). */
export function filterTrafficRows(
  rows: readonly RawTrafficRow[],
  filter: RawTrafficFilter,
): RawTrafficRow[] {
  if (!Array.isArray(rows)) return [];
  const kinds = filter?.kinds ?? ALL_KINDS;
  const q = typeof filter?.query === 'string' ? filter.query.trim().toLowerCase() : '';

  const out: RawTrafficRow[] = [];
  for (const r of rows) {
    if (!r || !kinds.has(r.kind)) continue;
    if (q && !r.text.toLowerCase().includes(q)) continue;
    out.push(r);
  }
  return out;
}

/** Sınıf başına satır sayısı (rozet sayaçları). */
export function countByKind(rows: readonly RawTrafficRow[]): Record<RawTrafficKind, number> {
  const out: Record<RawTrafficKind, number> = { TX: 0, RX: 0, SYSTEM: 0, ERROR: 0 };
  if (!Array.isArray(rows)) return out;
  for (const r of rows as readonly RawTrafficRow[]) {
    if (r && Object.prototype.hasOwnProperty.call(out, r.kind)) out[r.kind]++;
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Dürüst boş durum
 * ════════════════════════════════════════════════════════════════════════ */

export type EmptyReason =
  | 'not-native'        // tarayıcı/emülatör — native yakalama kanalı yok
  | 'not-connected'     // OBD bağlı değil
  | 'connected-idle'    // bağlı ama bu ekran açıldığından beri trafik geçmedi
  | 'view-cleared';     // kullanıcı görünümü temizledi

export interface EmptyStateInput {
  readonly isNative:        boolean;
  readonly connectionState: string;
  readonly viewCleared:     boolean;
  readonly bufferSize:      number;
}

/**
 * Boş durumun GERÇEK nedeni. "Çalışıyor" varsayımı YOK — bağlantı durumu neyse o
 * söylenir. Yakalama kanalı yoksa bu açıkça belirtilir.
 */
export function describeEmptyState(input: EmptyStateInput): EmptyReason {
  if (input?.isNative !== true) return 'not-native';
  if (input.viewCleared === true && input.bufferSize > 0) return 'view-cleared';
  const st = typeof input.connectionState === 'string' ? input.connectionState : '';
  if (st !== 'connected') return 'not-connected';
  return 'connected-idle';
}

export const EMPTY_REASON_TEXT: Readonly<Record<EmptyReason, string>> = {
  'not-native':
    'Native yakalama kanalı yok (tarayıcı/emülatör). Ham trafik yalnız cihazda, ELM327/BLE bağlıyken akar.',
  'not-connected':
    'OBD bağlı değil — yakalanacak trafik yok. Adaptör bağlanınca komut/yanıt çiftleri burada akmaya başlar.',
  'connected-idle':
    'OBD bağlı; bu ekran açıldığından beri henüz komut/yanıt çifti yakalanmadı. Bu ekran trafik ÜRETMEZ, yalnız mevcut akışı dinler.',
  'view-cleared':
    'Görünüm temizlendi. Global tampon ve DebugPanel verisi korunuyor; yeni trafik buradan itibaren görünür.',
} as const;
