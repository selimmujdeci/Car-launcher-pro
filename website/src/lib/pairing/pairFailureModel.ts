/**
 * pairFailureModel — eşleştirme hatasının SINIFLANDIRMASI (SAF, I/O YOK).
 *
 * ── NEDEN (SAHA 2026-08-19, kullanıcı ekran görüntüsü) ─────────────────────
 * Telefon **5G · tam sinyal** ile çevrimiçiyken PWA eşleştirme ekranı
 * *"Çevrimdışısınız."* yazıyor ve talepler kuyrukta birikiyordu. Kök:
 * `pairVehicle` sunucudan gelen 5xx/429'u `offline: true` diye işaretliyordu
 * (tekrar denenebilirlik için DOĞRU) ama ekran bu bayrağı "cihaz çevrimdışı"
 * diye okuyup KULLANICIYI suçluyordu. `fetch` throw ettiğinde de sebep
 * ölçülmeden "internetinizi kontrol edin" deniyordu — oysa DNS/TLS/sunucu da
 * aynı yola çıkar (ölçümde `www.carospro.com` sertifikası alan adını
 * KAPSAMIYORDU: SEC_E_WRONG_PRINCIPAL).
 *
 * SÖZLEŞME
 *   · "Tekrar denenebilir mi?" ile "SEBEBİ ne?" AYRI sorulardır. İlki kuyruğu,
 *     ikincisi kullanıcıya söylenen cümleyi belirler.
 *   · Sunucu YANIT VERDİYSE cihaz çevrimiçidir — çevrimdışı İLAN EDİLMEZ.
 *   · İstek hiç tamamlanmadıysa ve tarayıcı "ağ kapalı" DEMİYORSA sebep
 *     BİLİNMİYOR (`NETWORK_FAILED`) — uydurulmaz.
 */

export type PairFailureReason =
  /** Tarayıcı ağın kapalı olduğunu bildiriyor (cihaz gerçekten çevrimdışı). */
  | 'DEVICE_OFFLINE'
  /** Sunucu YANIT VERDİ ama geçici hata (5xx/429) — cihaz çevrimiçi. */
  | 'SERVER_TRANSIENT'
  /** İstek hiç tamamlanamadı (DNS/TLS/kesinti) — cihaz mı sunucu mu BELİRSİZ. */
  | 'NETWORK_FAILED';

export interface PairFailureVerdict {
  /** Kuyruğa alınıp yeniden denenmeli mi (kalıcı red DEĞİL). */
  readonly retryable: boolean;
  /** Sebep; kalıcı redde `null` (sebep üretmeye gerek yok, sunucu mesajı var). */
  readonly reason: PairFailureReason | null;
}

/** Sunucu YANIT VERDİ: yalnız 5xx ve 429 geçicidir; kalan 4xx KALICI reddir. */
export function classifyHttpFailure(status: number): PairFailureVerdict {
  const transient = status >= 500 || status === 429;
  return { retryable: transient, reason: transient ? 'SERVER_TRANSIENT' : null };
}

/** İstek TAMAMLANMADI: sebep yalnız tarayıcının ağ bildirimi kadar bilinir. */
export function classifyRequestFailure(browserOnline: boolean): PairFailureVerdict {
  return { retryable: true, reason: browserOnline ? 'NETWORK_FAILED' : 'DEVICE_OFFLINE' };
}

/**
 * Kullanıcıya gösterilecek cümle — TEK kaynak. Her dalda "Araç HENÜZ eşleşmedi"
 * korunur: kuyruğa yazmak sahiplik ÜRETMEZ (#631/#632 dersi).
 */
export function pairFailureNotice(reason: PairFailureReason, httpStatus?: number): string {
  const tail = ' Talebiniz cihazınıza kaydedildi ve otomatik yeniden denenecek. '
             + 'Araç HENÜZ eşleşmedi.';
  switch (reason) {
    case 'DEVICE_OFFLINE':
      return 'Cihazınız çevrimdışı.' + tail;
    case 'SERVER_TRANSIENT':
      return `Sunucu şu an yanıt veremiyor${httpStatus ? ` (HTTP ${httpStatus})` : ''}.` + tail;
    case 'NETWORK_FAILED':
      return 'Sunucuya ulaşılamadı — istek tamamlanmadı (ağ, DNS veya sertifika).' + tail;
  }
}
