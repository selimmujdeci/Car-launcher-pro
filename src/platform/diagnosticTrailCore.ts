/**
 * diagnosticTrailCore — olay izinin YAZMA çekirdeği (bağımlılıksız).
 *
 * NEDEN AYRI (SAHA 2026-07-06): `pushTrail` her yerden çağrılır (voiceService,
 * carosMediaLayer, …). Yazma yolu AĞIR bağımlılık (obdService/store/crashLogger)
 * TAŞIMAMALI — yoksa her üretici o zinciri modül grafiğine sokar (6 voice testi
 * `performanceMode` mock'u eksik kalınca kırıldı). Bu çekirdek yalnız halka
 * tamponunu + pushTrail'i tutar; okuma/harmanlama (obd/store/hata birleştirme)
 * ağır tarafta (`diagnosticTrail.ts`) kalır ve yalnız boot/snapshot'ta yüklenir.
 *
 * PII yok: yalnız olay türü + kısa etiket.
 */

/* ── Tipler ──────────────────────────────────────────────────── */

export type TrailKind =
  | 'boot' | 'mode' | 'screen' | 'obd' | 'action' | 'error' | 'modal';

export interface TrailEvent {
  ts:     number;     // Date.now (kronolojik harman + panel görüntü)
  kind:   TrailKind;
  label:  string;     // kısa insan-okur (PII'siz)
  detail?: string;
}

/* ── Halka tamponu ──────────────────────────────────────────── */

const MAX_OWN = 80;   // kendi tamponu (boot/mode/screen/action)
const _own: TrailEvent[] = [];

/** Dahili: kendi tamponuna yaz (ağır taraf da kullanır). */
export function pushOwn(kind: TrailKind, label: string, detail?: string): void {
  _own.push({ ts: Date.now(), kind, label, detail });
  if (_own.length > MAX_OWN) _own.shift();
}

/** Public: manuel breadcrumb — herhangi bir üretici tek satırla ize ekler. */
export function pushTrail(kind: TrailKind, label: string, detail?: string): void {
  pushOwn(kind, label, detail);
}

/** Kendi tamponunun kopyası (ağır taraf harmanlamada kullanır). */
export function getOwnTrail(): TrailEvent[] {
  return [..._own];
}

/** Tamponu temizle (cleanup / test). */
export function resetOwnTrail(): void {
  _own.length = 0;
}
