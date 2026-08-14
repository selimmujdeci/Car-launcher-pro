/**
 * guardianEnforcementPolicy — denetim noktası uyarısının SAF politikası.
 *
 * `guardianVehicleHealthPolicy` ile aynı rolü oynar: eşikler ve severity
 * eşlemesi TEK yerde, isimli sabitler hâlinde durur; kural dosyasında gömülü
 * sihirli sayı YOKTUR. Bu dosya saftır — I/O · timer · `Date.now` yok.
 *
 * ── UYARI YARIÇAPI NEDEN 700 m ──────────────────────────────────────────────
 * Uyarının işe yaraması için sürücünün yavaşlayacak zamanı olmalı. 90 km/h
 * (25 m/s) hızda 700 m ≈ **28 s** önceden haber demektir. Daha uzun bir yarıçap
 * şehir içinde alakasız noktaları da toplar; daha kısası otoyolda geç kalır.
 *
 * ── KONUM BELİRSİZLİĞİ KAPISI — ÖZELLİĞİN CAN DAMARI (kütük #508) ───────────
 * Sahada ölçülen GPS fix yaşı **p50 19,5 s**'tir. 94 km/h'te bu ~509 m konum
 * hatası demektir. Böyle bir hatayla 700 m'lik bir yarıçapta uyarı vermek,
 * uyarının **denetim noktasının üstünde ya da çok sonrasında** çalması demektir.
 *
 * Bu yüzden kapı YAŞA değil, **KONUM BELİRSİZLİĞİNE** kurulur:
 *     belirsizlik ≈ fix doğruluğu + hız × fix yaşı
 * Belirsizlik `GUARDIAN_ENFORCEMENT_MAX_POSITION_UNCERTAINTY_M`yi aşarsa uyarı
 * ÜRETİLMEZ ve düşüş SAYILIR. Sonuç dürüsttür: G1 (bayat fix) düzelene kadar
 * özellik şehir içinde çalışır, otoyolda SESSİZ kalır — ve bu sessizlik CAROS
 * LAB'da sayı olarak GÖRÜNÜR. Sessizce yanlış uyarmaktansa sessiz kalmak.
 *
 * ── YÖN KAPISI ──────────────────────────────────────────────────────────────
 * Paketin yalnız %31'inde serbest metin yön ipucu var ve bu metin dereceye
 * ÇEVRİLEMEZ. Elde kalan tek gerçek yön bilgisi ARACIN gidiş yönüdür: noktanın
 * kerterizi aracın yönünden `±GUARDIAN_ENFORCEMENT_AHEAD_HALF_ANGLE_DEG`den
 * fazla sapıyorsa nokta ARKADA sayılır ve uyarı verilmez. Yön bilinmiyorsa
 * (durağan araç / heading yok) uyarı verilmez — fail-closed.
 */

import type { SpeedCameraSeverityByCameraType } from '../rules/speedCameraWarningRule';

/** Uyarı yarıçapı (metre) — bunun dışındaki nokta değerlendirilmez. */
export const GUARDIAN_ENFORCEMENT_RADIUS_M = 700;

/** Kabul edilen en büyük konum belirsizliği (metre). Yarıçapın ~%21'i. */
export const GUARDIAN_ENFORCEMENT_MAX_POSITION_UNCERTAINTY_M = 150;

/** "İleride" konisinin yarı açısı (derece). */
export const GUARDIAN_ENFORCEMENT_AHEAD_HALF_ANGLE_DEG = 60;

/**
 * Yönün güvenilir sayıldığı en düşük hız (m/s). Bunun altında GPS heading
 * gürültüdür (durağan araçta rastgele döner) → uyarı verilmez.
 * 5 m/s = 18 km/h.
 */
export const GUARDIAN_ENFORCEMENT_MIN_HEADING_SPEED_MPS = 5;

/**
 * Fix yaşının kabul edilen mutlak tavanı (ms). Belirsizlik kapısı zaten
 * hız×yaş üzerinden çalışır; bu tavan **durağan araçta** yaşın sınırsız
 * büyümesini engeller (hız 0 iken belirsizlik büyümez ama fix ölmüş olabilir).
 */
export const GUARDIAN_ENFORCEMENT_MAX_FIX_AGE_MS = 30_000;

/** Kural için minimum güven eşiği — belirsizlikten türeyen güvene uygulanır. */
export const GUARDIAN_ENFORCEMENT_MIN_CONFIDENCE = 0.3;

/** Guardian olaylarında kullanılan kaynak etiketi (atıf zinciri — karar K6). */
export const GUARDIAN_ENFORCEMENT_SOURCE_ID = 'EGM_EDS_MAP';

/**
 * Kategorik severity haritası. `unspecified` — türü bilinmeyen nokta — bilinçli
 * olarak DÜŞÜK tutulur: varlığı gözlendi ama ne olduğu bilinmiyor; yüksek
 * severity vermek bilinmeyen bir şeye ağırlık atfetmek olurdu.
 */
export const GUARDIAN_ENFORCEMENT_SEVERITY: Readonly<SpeedCameraSeverityByCameraType> = Object.freeze({
  fixed_speed:   'MEDIUM',
  average_speed: 'MEDIUM',
  mobile_speed:  'MEDIUM',
  traffic_light: 'LOW',
  combined:      'MEDIUM',
  unspecified:   'LOW',
});
