/**
 * pidDidExplorerModel.ts — PID/DID Explorer'ın DÜRÜST durum modeli (SAF).
 *
 * NEDEN VAR: panel açılıyor ve keşif koordinatörü GERÇEK — ama keşfin çıktısı henüz
 * hiçbir tüketiciye BAĞLI DEĞİL. Kullanıcıya "aktif" izlenimi vermek YASAK (görev §E):
 * ekran neyin bağlı, neyin bağlı OLMADIĞINI satır satır yazar.
 *
 * Türetilebilen durum ÖLÇÜLÜR (native DID okuma kanalı); türetilemeyen durum
 * (henüz yazılmamış wiring) sabit NOT_WIRED olarak beyan edilir — belirsiz
 * "yakında" ifadesi kullanılmaz.
 */

export type PidDidWiringState = 'WIRED' | 'NOT_WIRED' | 'UNAVAILABLE';

export interface PidDidWiringRow {
  readonly id:    string;
  readonly label: string;
  readonly state: PidDidWiringState;
  readonly note:  string;
}

export interface PidDidWiringInput {
  /** Native `readObdDid` köprüsü bu cihazda var mı (Capacitor native + plugin metodu). */
  readonly nativeDidChannel: boolean;
}

/** Ekranın genel dürüst durumu. */
export type PidDidOverallStatus = 'FOUNDATION_ONLY' | 'WIRED';

/**
 * Wiring satırları. Sıra sabittir (deterministik render).
 */
export function describePidDidWiring(input: PidDidWiringInput): PidDidWiringRow[] {
  const native = input?.nativeDidChannel === true;
  return [
    {
      id: 'did-read-channel',
      label: 'Native DID okuma kanalı (readObdDid)',
      state: native ? 'WIRED' : 'UNAVAILABLE',
      note: native
        ? 'Native köprü mevcut — aday DID okuması gerçek araçtan yapılır.'
        : 'Bu ortamda native köprü yok (tarayıcı/emülatör). Keşif başlatılsa bile DID okunamaz.',
    },
    {
      id: 'discovery-coordinator',
      label: 'Keşif koordinatörü (discoveryLive)',
      state: 'WIRED',
      note: 'Tekil canlı koordinatör bağlı; başlatma/iptal bu ekrandan çalışır.',
    },
    {
      id: 'capture-observations',
      label: 'Gözlem yakalama → Discovery Database',
      state: 'WIRED',
      note: 'Keşfedilen sinyaller mevcut capture servisine akar; Developer → Discovery Database ekranında görünür.',
    },
    {
      id: 'apply-verified-consumer',
      label: 'applyVerified → canlı polling tüketicisi',
      state: 'NOT_WIRED',
      note: 'Doğrulanan DID\'ler canlı poll listesine UYGULANMIYOR. Bu tur kapsam dışı (Faz A2).',
    },
    {
      id: 'mavi-action-wiring',
      label: 'Mavi action wiring (vehicle.discovery.*)',
      state: 'NOT_WIRED',
      note: 'Sesli/otomatik tetikleme bağlı değil. Keşif yalnız bu ekrandan elle başlatılır.',
    },
  ];
}

/** Herhangi bir satır NOT_WIRED ise ekran FOUNDATION_ONLY'dir. */
export function pidDidOverallStatus(rows: readonly PidDidWiringRow[]): PidDidOverallStatus {
  if (!Array.isArray(rows)) return 'FOUNDATION_ONLY';
  return rows.some((r) => r && r.state === 'NOT_WIRED') ? 'FOUNDATION_ONLY' : 'WIRED';
}
