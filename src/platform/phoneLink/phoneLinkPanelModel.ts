/**
 * phoneLinkPanelModel.ts — Ayarlar › Bağlantı › Telefon Bağlantısı metinleri (SAF).
 *
 * Ekran yalnız ÖLÇÜLENİ söyler: "bağlı" yalnız native oturum gerçekten
 * kurulduysa; Bluetooth'u Android'e kapalı ünitelerde "Bluetooth'u açın"
 * DENMEZ (açılacak bir şey yoktur) — Wi-Fi yolunun kullanılacağı söylenir.
 */
import type { PhoneHubLinkSnapshotRaw } from '../phoneHub/phoneHubLink';
import type { ClientPathState, PhoneHubClientSnapshot } from '../phoneHub/phoneHubClient';

export type Tone = 'ok' | 'idle' | 'warn';

export interface StatusLine {
  readonly label: string;
  readonly text: string;
  readonly tone: Tone;
}

/* ══════════════════════════════════════════════════════════════════════════
 * ARAÇ rolü
 * ════════════════════════════════════════════════════════════════════════ */

export interface CarView {
  readonly bluetooth: StatusLine;
  readonly wifi: StatusLine;
  readonly connection: StatusLine;
  /** En az bir yol dinliyor mu (değilse "Başlat" gösterilir). */
  readonly listening: boolean;
  readonly awaitingConfirmation: boolean;
  readonly hasTrustedPhone: boolean;
}

function carBluetooth(raw: PhoneHubLinkSnapshotRaw): StatusLine {
  const label = 'Bluetooth';
  const bt = raw.transports?.bluetooth;
  const running = bt ? bt.running === true : raw.server?.running === true;
  if (running) return { label, text: 'Hazır', tone: 'ok' };
  const blocker = bt ? bt.blockerCode ?? null : raw.preconditions?.blockerCode ?? null;
  if (bt?.stackUnavailableSuspected === true) {
    return {
      label,
      text: 'Bu ünitede Android Bluetooth\'u kullanılamıyor (üreticinin modülü) — Wi-Fi kullanılır',
      tone: 'idle',
    };
  }
  switch (blocker) {
    case 'BLUETOOTH_UNAVAILABLE': return { label, text: 'Bu cihazda yok — Wi-Fi kullanılır', tone: 'idle' };
    case 'BLUETOOTH_DISABLED': return { label, text: 'Kapalı', tone: 'idle' };
    case 'BLUETOOTH_PERMISSION_REQUIRED':
    case 'BLUETOOTH_PERMISSION_DENIED': return { label, text: 'İzin verilmedi', tone: 'warn' };
    default: return { label, text: 'Dinlemiyor', tone: 'idle' };
  }
}

function carWifi(raw: PhoneHubLinkSnapshotRaw): StatusLine {
  const label = 'Wi-Fi';
  const w = raw.transports?.wifi;
  if (!w) return { label, text: 'Bu sürümde yok', tone: 'idle' };
  if (w.running !== true) return { label, text: 'Dinlemiyor', tone: 'idle' };
  const addr = (w.localAddresses ?? []).filter((a) => typeof a === 'string' && a.length > 0);
  if (addr.length === 0) {
    return { label, text: 'Hazır — ama bir Wi-Fi ağına bağlı değil (telefonun hotspot\'una bağlayın)', tone: 'warn' };
  }
  return { label, text: `Hazır · ${addr[0]}`, tone: 'ok' };
}

export function describeCarView(raw: PhoneHubLinkSnapshotRaw): CarView | null {
  if (!raw?.present) return null;
  const bluetooth = carBluetooth(raw);
  const wifi = carWifi(raw);
  const session = raw.session ?? null;
  const established = session?.trulyEstablished === true;
  const via = raw.transports?.active === 'WIFI' ? 'Wi-Fi' : raw.transports?.active === 'BLUETOOTH' ? 'Bluetooth' : null;
  const awaiting = raw.pairing?.awaitingConfirmation === true;
  let connection: StatusLine;
  if (established) {
    connection = { label: 'Telefon', text: via ? `Bağlı (${via})` : 'Bağlı', tone: 'ok' };
  } else if (awaiting) {
    connection = { label: 'Telefon', text: 'Eşleştirme onayı bekleniyor', tone: 'warn' };
  } else if (session) {
    connection = { label: 'Telefon', text: 'Bağlanıyor…', tone: 'idle' };
  } else {
    connection = { label: 'Telefon', text: 'Bekleniyor', tone: 'idle' };
  }
  const btOn = raw.transports?.bluetooth ? raw.transports.bluetooth.running === true : raw.server?.running === true;
  return {
    bluetooth, wifi, connection,
    listening: btOn || raw.transports?.wifi?.running === true,
    awaitingConfirmation: awaiting,
    hasTrustedPhone: raw.trust?.hasTrustedPeer === true,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * TELEFON rolü
 * ════════════════════════════════════════════════════════════════════════ */

const PATH_TEXT: Readonly<Record<ClientPathState, { text: string; tone: Tone }>> = {
  IDLE: { text: '—', tone: 'idle' },
  SEARCHING: { text: 'Aranıyor…', tone: 'idle' },
  FOUND: { text: 'Araç bulundu', tone: 'ok' },
  CONNECTED: { text: 'Bağlandı', tone: 'ok' },
  NOT_FOUND: { text: 'Bulunamadı', tone: 'warn' },
  DISABLED: { text: 'Kapalı', tone: 'idle' },
  PERMISSION_REQUIRED: { text: 'İzin gerekli', tone: 'warn' },
  UNAVAILABLE: { text: 'Kullanılamıyor', tone: 'idle' },
  CANCELLED: { text: 'Diğer yol kullanıldı', tone: 'idle' },
};

export interface PhoneView {
  readonly headline: string;
  readonly tone: Tone;
  readonly wifi: StatusLine;
  readonly bluetooth: StatusLine;
  /** "Araca bağlan" mı yoksa "Bağlantıyı kes" mi gösterilir. */
  readonly action: 'connect' | 'disconnect';
  readonly awaitingConfirmation: boolean;
  readonly hint: string | null;
}

export function describePhoneView(s: PhoneHubClientSnapshot): PhoneView | null {
  if (!s.present) return null;
  const path = (label: string, p: ClientPathState | null): StatusLine => {
    const t = PATH_TEXT[p ?? 'IDLE'];
    return { label, text: t.text, tone: t.tone };
  };
  const wifi = path('Wi-Fi', s.wifi);
  const bluetooth = path('Bluetooth', s.bluetooth);
  const via = s.activeTransport === 'WIFI' ? 'Wi-Fi' : s.activeTransport === 'BLUETOOTH' ? 'Bluetooth' : null;
  const busy = s.phase === 'SEARCHING' || s.phase === 'HANDSHAKING' || s.phase === 'AWAITING_CONFIRM'
    || s.phase === 'RETRY_WAIT' || s.connected;

  let headline: string;
  let tone: Tone = 'idle';
  let hint: string | null = null;
  if (s.connected) {
    headline = via ? `Araca bağlı (${via})` : 'Araca bağlı';
    tone = 'ok';
  } else if (s.phase === 'AWAITING_CONFIRM' || s.awaitingConfirmation) {
    headline = 'İki ekrandaki kodu karşılaştırın';
    tone = 'warn';
  } else if (s.phase === 'HANDSHAKING') {
    headline = via ? `Bağlanıyor (${via})…` : 'Bağlanıyor…';
  } else if (s.phase === 'SEARCHING') {
    headline = 'Araç aranıyor (Wi-Fi + Bluetooth)…';
  } else if (s.phase === 'RETRY_WAIT') {
    headline = 'Bağlantı koptu — yeniden deneniyor';
    tone = 'warn';
  } else if (s.phase === 'NOT_FOUND') {
    headline = 'Araç bulunamadı';
    tone = 'warn';
    hint = 'Telefon ile araç aynı Wi-Fi\'de olmalı: telefonun hotspot\'unu açıp aracı ona bağlayın '
      + '(ya da ortak bir Wi-Fi kullanın). Araçta Bluetooth varsa telefonla eşleştirmek de yeter. '
      + 'Araçtaki CarOS Pro açık ve Ayarlar › Bağlantı\'da "Araç" rolünde olmalı.';
  } else if (s.phase === 'FAILED') {
    headline = 'Bağlantı kurulamadı';
    tone = 'warn';
  } else {
    headline = s.hasTrustedCar ? 'Araç tanıdık — bağlanmaya hazır' : 'Henüz bir araca bağlanmadı';
  }
  return {
    headline, tone, wifi, bluetooth,
    action: busy ? 'disconnect' : 'connect',
    awaitingConfirmation: s.awaitingConfirmation || s.phase === 'AWAITING_CONFIRM',
    hint,
  };
}
