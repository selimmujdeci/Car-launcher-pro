/**
 * deepScanBreakdownModel — derin tarama sonucunun "yeni / zaten kayıtlı" KIRILIMI (SAF).
 *
 * NEDEN AYRI DOSYA: panel içinde hesaplanınca kırılım OTURUM KAPSAMINI KAYBEDİYORDU.
 * `discoveryCaptureService.getObservations()` uygulama ömrü boyunca BİRİKİR (başka
 * kaynaklardan gelen PID gözlemleri ve ÖNCEKİ taramalar dâhil); bu birikimi tek bir
 * taramanın `standardPids.length` sayısıyla yan yana yazmak "25 bulundu · bunlardan
 * 40 tanesi zaten kayıtlı" gibi TOPLAMI TUTMAYAN bir cümle üretebilirdi. Bu, kullanıcı
 * için sayısal bir YALANDIR (kanıtsız bilgi üretme yasağı).
 *
 * SÖZLEŞME: kırılım YALNIZ bu taramanın döndürdüğü PID'ler üzerinden yapılır ve
 * `known + fresh + unclassified === standardPids.length` HER ZAMAN sağlanır.
 *
 * İKİNCİ OTORİTE YOK: "yeni mi / biliniyor mu" kararı yeniden hesaplanmaz; yakalama
 * servisinin KENDİ kararı (`DiscoveryObservation.status`) okunur. Gözlemi bulunamayan
 * PID tahmin edilmez → `unclassified` (UNKNOWN dürüstlüğü; sahte "yeni" sayılmaz).
 *
 * SAF: React/native/zaman importu YOK — kök vitest paketinden test edilebilir.
 */

import type { DiscoveryObservation } from '../../platform/obd/discovery/DiscoveryCaptureService';
import { normalizeHex } from '../../platform/obd/discovery/discoveryModel';

export interface DeepScanPidBreakdown {
  /** Katalogda ZATEN VAR — yakalanmadı (`captured:false, reason:'known'`). */
  known: number;
  /** Katalog dışı — keşif kuyruğuna girdi. */
  fresh: number;
  /** Gözlem kaydı bulunamadı → sınıflandırılamadı (tahmin YOK). */
  unclassified: number;
}

/**
 * Bu taramanın PID'lerini gözlem kayıtlarıyla eşleyip kırılımı üretir.
 *
 * @param standardPids Taramanın döndürdüğü PID'ler (yalnız `pid` alanı kullanılır).
 * @param observations Yakalama servisinin salt-okunur gözlemleri (ömür boyu birikim).
 */
export function computeDeepScanPidBreakdown(
  standardPids: ReadonlyArray<{ readonly pid: string }>,
  observations: ReadonlyArray<DiscoveryObservation>,
): DeepScanPidBreakdown {
  // PID gözlemlerini normalize kimliğe indeksle (aynı PID birden çok ECU'dan gelebilir;
  // biri bile "yeni" ise o PID bu tarama için yenidir — kaybolan keşif göstermemek için).
  const statusByPid = new Map<string, 'new' | 'known'>();
  for (const o of observations) {
    if (o.record.discoverySource !== 'PID') continue;
    const key = normalizeHex(o.record.pidOrDid);
    if (o.status === 'new' || !statusByPid.has(key)) statusByPid.set(key, o.status);
  }

  const out: DeepScanPidBreakdown = { known: 0, fresh: 0, unclassified: 0 };
  for (const p of standardPids) {
    const status = statusByPid.get(normalizeHex(p.pid));
    if (status === 'known') out.known += 1;
    else if (status === 'new') out.fresh += 1;
    else out.unclassified += 1;
  }
  return out;
}
