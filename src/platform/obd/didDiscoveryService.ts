/**
 * didDiscoveryService — Patch 12C: saha DID keşif aracı.
 *
 * Car Scanner tarzı kitle-kaynaklı marka veritabanı KOPYALANAMAZ (ticari lisans kuralı,
 * CLAUDE.md) — bu yüzden kendi profillerimizi KENDİ keşfimizle büyütürüz: kullanıcı bir
 * ECU (tx/rx) + DID aralığı seçer (ör. 7E0, 2200-22FF), araç sırayla taranır, POZİTİF
 * yanıtlar (ham hex) kaydedilir. Sonuç, bilinen gösterge değerleriyle eşleştirilerek
 * `profiles/*.ts` dosyalarına GERÇEK DID'ler olarak eklenir.
 *
 * Native'e DOKUNMAZ — yalnız CarLauncher.readObdDid (Patch 12A) çağrılır, USER kuyruğu
 * üzerinden standart polling ile aynı önceliktedir (ekstra duraklatma eklenmez — polling
 * zaten araya girer). DID'ler arası ~150ms bekleme yalnız ECU'yu ardışık sorgularla
 * boğmamak içindir (DoS gibi davranmasın). İptal edilebilir (standart AbortSignal) ve
 * bağlantı koparsa (native reject) KISMİ sonuçla dürüst durur — hata yutulmaz, loglanır.
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';
import { logError } from '../crashLogger';

/** DID'ler arası bekleme (ms) — ECU'yu ardışık sorgularla boğmamak için. */
export const DISCOVERY_INTER_DID_DELAY_MS = 150;

export interface DidDiscoveryResult {
  /** 4 hex haneli DID, büyük harf (ör. 'F190'). */
  did: string;
  /** Ham yanıt data'sı (mode/DID başlığı soyulmuş), hex string. */
  dataHex: string;
  /** `dataHex`'in bayt dizisi hâli — profil yazarken hızlı okuma için. */
  bytes: number[];
}

export type DidDiscoveryStopReason =
  | 'completed'          // aralık sonuna kadar tarandı
  | 'aborted'            // kullanıcı iptal etti (signal.aborted)
  | 'connection_lost'    // native reject (bağlantı koptu) — kısmi sonuç
  | 'plugin_unavailable'; // native platform değil / eski plugin sürümü (readObdDid yok)

export interface DidDiscoverySummary {
  /** Gerçekten sorgulanan (yanıt alınan VEYA hatayla kesilen) DID sayısı. */
  scanned: number;
  /** Pozitif yanıt (supported && data) — `results`'ta listelenir. */
  positive: number;
  /** 7F / desteklenmiyor (supported:false) — SAYILIR ama listelenmez. */
  negative: number;
  stopReason: DidDiscoveryStopReason;
}

export interface DidDiscoveryOutcome {
  results: DidDiscoveryResult[];
  summary: DidDiscoverySummary;
}

export interface DidDiscoveryProgress {
  did: string;
  /** 0 tabanlı sıra. */
  index: number;
  total: number;
}

export interface StartDiscoveryOptions {
  /** İstek header'ı hex (ör. '7E0'); PR-OBD-KWP-1: '' = varsayılan oturum (header'a dokunulmaz). */
  tx: string;
  /** Yanıt filtre adresi hex (ör. '7E8'); tx boşsa boş bırakılır. */
  rx: string;
  /** Aralık başlangıcı — servis 22: 4 hane (ör. '2200'); servis 21: 2 hane (ör. '00'). */
  from: string;
  /** Aralık sonu (DAHİL) — servis 22: 4 hane; servis 21: 2 hane (ör. 'FF'). */
  to: string;
  /** PR-OBD-KWP-1: taranacak veri servisi — '22' (UDS DID, varsayılan) | '21' (KWP LID).
   *  Servis 21 SALT-OKUMADIR (ReadDataByLocalIdentifier) — ECU'ya yazmaz; tarama yine de
   *  yalnız kullanıcı tetiklemesiyle çalışır ve DID'ler arası bekleme uygulanır. */
  service?: '22' | '21';
  onProgress?: (p: DidDiscoveryProgress) => void;
  /** İptal — standart AbortController.signal. */
  signal?: AbortSignal;
}

/** `from`..`to` (dahil) arasındaki tüm kimlikleri sıralı, büyük harf üretir
 *  (servis 22 → 4 hane DID, servis 21 → 2 hane LID). */
function hexToRange(from: string, to: string, digits: 2 | 4): string[] {
  const start = parseInt(from, 16);
  const end = parseInt(to, 16);
  const out: string[] = [];
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return out;
  for (let v = start; v <= end; v++) {
    out.push(v.toString(16).toUpperCase().padStart(digits, '0'));
  }
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function hexToBytes(dataHex: string): number[] {
  const clean = dataHex.replace(/[^0-9A-Fa-f]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i + 2 <= clean.length; i += 2) {
    bytes.push(parseInt(clean.substring(i, i + 2), 16));
  }
  return bytes;
}

/**
 * DID aralığını sırayla tarar. Yalnız POZİTİF yanıtlar (`supported:true` + veri) `results`'a
 * girer; 7F/desteklenmiyor (`supported:false`) sayaçta sayılır ama listelenmez. İptal
 * edilebilir (AbortSignal — döngü başında VE her DID sonrası bekleme öncesi kontrol edilir).
 * Bağlantı koparsa (native reject) KISMİ sonuçla dürüst durur, hata `logError` ile kaydedilir.
 */
export async function startDiscovery(opts: StartDiscoveryOptions): Promise<DidDiscoveryOutcome> {
  const { tx, rx, from, to, onProgress, signal } = opts;
  const service = opts.service ?? '22';
  const results: DidDiscoveryResult[] = [];
  let positive = 0;
  let negative = 0;
  let scanned = 0;

  if (!Capacitor.isNativePlatform() || !CarLauncher.readObdDid) {
    return { results, summary: { scanned: 0, positive: 0, negative: 0, stopReason: 'plugin_unavailable' } };
  }

  const dids = hexToRange(from, to, service === '21' ? 2 : 4);
  const total = dids.length;

  for (let i = 0; i < total; i++) {
    if (signal?.aborted) {
      return { results, summary: { scanned, positive, negative, stopReason: 'aborted' } };
    }

    const did = dids[i]!;
    onProgress?.({ did, index: i, total });

    try {
      const r = await CarLauncher.readObdDid({ tx, rx, did, service });
      scanned++;
      if (r.supported && r.data) {
        results.push({ did, dataHex: r.data, bytes: hexToBytes(r.data) });
        positive++;
      } else {
        negative++; // 7F / desteklenmiyor — sayılır, listeye GİRMEZ
      }
    } catch (e) {
      // Bağlantı koptu (native reject) — KISMİ sonuçla dürüst dur, hatayı yutma.
      logError('OBD:DidDiscovery', e);
      return { results, summary: { scanned, positive, negative, stopReason: 'connection_lost' } };
    }

    // Son DID'den sonra beklemeye gerek yok.
    if (i < total - 1) {
      if (signal?.aborted) {
        return { results, summary: { scanned, positive, negative, stopReason: 'aborted' } };
      }
      await delay(DISCOVERY_INTER_DID_DELAY_MS);
    }
  }

  return { results, summary: { scanned, positive, negative, stopReason: 'completed' } };
}

/**
 * Sonucu dışa aktarılabilir JSON metnine çevirir — T507 gibi adb'siz cihazlarda cihaz
 * ÜSTÜNDEN dışa aktarmanın (panoya kopyala / seçilebilir metin) tek yolu budur.
 */
export function exportDiscoveryResultsAsJson(
  ecu: { tx: string; rx: string },
  outcome: DidDiscoveryOutcome,
): string {
  return JSON.stringify(
    {
      ecu,
      generatedAt: new Date().toISOString(),
      summary: outcome.summary,
      results: outcome.results,
    },
    null,
    2,
  );
}
