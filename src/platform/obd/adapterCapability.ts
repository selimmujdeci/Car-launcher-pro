/**
 * adapterCapability — Adaptör kimliği & yetenek sınıflandırması (OBD-OS-F3-5).
 *
 * NEDEN: "ELM327 v1.5" yazan adaptörlerin ÇOĞU klondur. Gerçek v1.5/v2.x özelliklerini
 * (ATCP 29-bit öncelik, ATCFC flow-control, yüksek throughput) TAŞIMAZLAR ama etikette
 * öyle yazar. Klonu gerçek sanmak → desteklemediği komutu göndeririz → sessiz başarısızlık.
 *
 * ZERO-TRUST: yeteneği ETİKETTEN değil, DAVRANIŞTAN çıkarırız. `AT@1` ve `STDI` yanıtları
 * KANITTIR; yanıt yoksa yetenek VARSAYILMAZ (yokmuş gibi davranırız — fail-closed).
 *
 * SAF: modül-durumu yok, I/O yok — tam test edilebilir.
 */

/** Adaptörün gerçek sınıfı (kanıta dayalı). */
export type AdapterKind =
  | 'stn'      // STN11xx/STN22xx (OBDLink) — STDI yanıt verdi: en yetenekli
  | 'elm327'   // Gerçek ELM327 (AT@1 anlamlı cihaz tanımı döndü)
  | 'clone'    // ELM327 taklidi — sürüm iddia ediyor ama kimlik komutlarına yanıt yok
  | 'unknown'; // Kimlik okunamadı → hiçbir şey VARSAYMA (fail-closed)

export interface AdapterCapabilities {
  kind: AdapterKind;
  /** Ham ATI yanıtı (etiket sürümü — İDDİA, kanıt değil). */
  identity: string;
  /** 29-bit genişletilmiş adresleme (ATCP) güvenilir mi? */
  extendedAddressing: boolean;
  /** Flow-control ayarı (ATCFC/ATFC) güvenilir mi — uzun ISO-TP yanıtları için kritik. */
  flowControl: boolean;
  /** İnsan-okunur TR açıklama (teşhis raporu / UI). */
  summary: string;
}

/**
 * Native `probeAdapterIdentityRaw()` çıktısını ("ATI|AT@1|STDI") sınıflandırır.
 *
 * KARAR SIRASI (kanıt gücüne göre):
 *  1. STDI anlamlı yanıt verdi → STN (gerçek ELM327 bu komutu bilmez, '?' döner).
 *  2. AT@1 anlamlı cihaz tanımı döndü → gerçek ELM327.
 *  3. ATI "ELM327" diyor ama kimlik komutları sessiz/'?' → KLON (etiket yalan söylüyor).
 *  4. Hiçbiri okunamadı → unknown (yetenek VARSAYILMAZ).
 */
export function classifyAdapter(raw: string): AdapterCapabilities {
  const parts = (raw ?? '').split('|');
  const ati  = (parts[0] ?? '').trim();
  const at1  = (parts[1] ?? '').trim();
  const stdi = (parts[2] ?? '').trim();

  const meaningful = (s: string): boolean =>
    s.length > 0 && !s.includes('?') && !/^(NO\s*DATA|ERROR|STOPPED)$/i.test(s);

  if (meaningful(stdi)) {
    return {
      kind: 'stn',
      identity: ati,
      extendedAddressing: true,
      flowControl: true,
      summary: `STN tabanlı adaptör (${stdi}) — 29-bit adresleme ve flow-control güvenilir.`,
    };
  }

  if (meaningful(at1)) {
    return {
      kind: 'elm327',
      identity: ati,
      extendedAddressing: true,
      flowControl: true,
      summary: `Gerçek ELM327 (${ati || 'sürüm okunamadı'}) — genişletilmiş komutlar destekleniyor.`,
    };
  }

  if (/ELM/i.test(ati)) {
    // Etikette ELM327 yazıyor ama kimlik komutlarına yanıt YOK → klon.
    // FAIL-CLOSED: yeteneği "var" saymayız; 29-bit/flow-control komutları sessizce
    // başarısız olabilir → çağıran bunlara GÜVENMEMELİ.
    return {
      kind: 'clone',
      identity: ati,
      extendedAddressing: false,
      flowControl: false,
      summary: `Klon adaptör şüphesi (${ati}) — kimlik komutlarına yanıt yok; 29-bit ve flow-control güvenilmez.`,
    };
  }

  return {
    kind: 'unknown',
    identity: ati,
    extendedAddressing: false,
    flowControl: false,
    summary: 'Adaptör kimliği okunamadı — gelişmiş yetenekler varsayılmıyor.',
  };
}
