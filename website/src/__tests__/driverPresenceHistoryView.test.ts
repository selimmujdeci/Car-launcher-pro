/**
 * driverPresenceHistoryView.test.ts — "SON GÖRÜLEN SÜRÜCÜ" KİLİTLERİ.
 *
 * ── KİLİTLENEN ANA KURAL ──────────────────────────────────────────────
 * "Son görülen sürücü" bir GÖZLEMDİR, trip attribution KARARI DEĞİLDİR.
 * Doğrulanmamış bir kaynak (araç ekranı beyanı) burada **isim olarak
 * gösterilemez** — aksi halde 049'da kapatılan kapı Fleet UI'dan arkadan
 * dolanılırdı.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildPresenceHistoryEntry, buildLastSeenDriverView,
  lastSeenDriverLabel, lastSeenDetailLabel, presenceDurationLabel,
  presenceHistoryStatusLabel, presenceHistorySourceLabel,
  PRESENCE_HISTORY_STATUSES,
  type PresenceHistoryRow,
} from '@/lib/fleet/driverPresenceHistoryView';

const T = '2026-07-30T09:00:00.000Z';

function row(over: Partial<PresenceHistoryRow> = {}): PresenceHistoryRow {
  return {
    history_id: 'h-1', vehicle_id: 'v-1',
    driver_id: 'd-1', driver_name: 'Ahmet Y.',
    source: 'NFC', confidence: 'VERY_HIGH', identity_verifying: true,
    detected_at: T, expires_at: '2026-07-30T17:00:00.000Z',
    expired_at: null, duration_ms: null, close_reason: null,
    status: 'OPEN', refresh_count: 0,
    ...over,
  };
}

/* ══════════════════════════════════════════════════════════════════════ */

describe('LastSeenDriver · A. Okunamadı ≠ kayıt yok', () => {
  it('A1. 🔒 okuma başarısızsa "Okunamadı"', () => {
    const v = buildLastSeenDriverView({ rows: null, readable: false });
    expect(v.readable).toBe(false);
    expect(lastSeenDriverLabel(v)).toBe('Okunamadı');
  });

  it('A2. 🔒 okundu ama kayıt yoksa "Kayıt yok"', () => {
    const v = buildLastSeenDriverView({ rows: [], readable: true });
    expect(v.readable).toBe(true);
    expect(v.hasRecord).toBe(false);
    expect(lastSeenDriverLabel(v)).toBe('Kayıt yok');
  });

  it('A3. 🔒 kayıt yokken ayrıntı da ÜRETİLMEZ', () => {
    expect(lastSeenDetailLabel(buildLastSeenDriverView({ rows: [], readable: true })))
      .toBeNull();
  });
});

describe('LastSeenDriver · B. DOĞRULANMAMIŞ KAYNAK İSİM GÖSTERMEZ', () => {
  it('B1. 🔒 HEAD_UNIT kaydı sürücü ADI olarak sunulmaz', () => {
    /* Sunucu zaten NULL gönderir; istemci sızdırılsa bile düşürür. */
    const v = buildLastSeenDriverView({
      rows: [row({ source: 'HEAD_UNIT', identity_verifying: false,
                   driver_id: 'd-9', driver_name: 'Sızıntı Ahmet' })],
      readable: true,
    });
    expect(v.entry).toBeNull();
    expect(v.unverifiedOnly).toBe(true);
    expect(lastSeenDriverLabel(v)).toBe('Doğrulanmamış gözlem — sürücü belirlenemedi');
    expect(JSON.stringify(v)).not.toContain('Sızıntı');
  });

  it('B2. 🔒 PHONE de doğrulanmış SAYILMAZ', () => {
    const e = buildPresenceHistoryEntry(
      row({ source: 'PHONE', identity_verifying: null, driver_name: 'X' }));
    expect(e.identityVerifying).toBe(false);
    expect(e.driverName).toBeNull();
  });

  it('B3. 🔒 bayrak eksikse "doğrulandı" VARSAYILMAZ (fail-closed)', () => {
    const e = buildPresenceHistoryEntry(
      row({ source: 'UYDURMA', identity_verifying: null, driver_name: 'X' }));
    expect(e.source).toBe('UNKNOWN');
    expect(e.identityVerifying).toBe(false);
    expect(e.driverId).toBeNull();
  });

  it('B4. 🔒 NFC/BLUETOOTH kaydında isim GÖSTERİLİR', () => {
    const v = buildLastSeenDriverView({ rows: [row()], readable: true });
    expect(v.entry?.identityVerifying).toBe(true);
    expect(lastSeenDriverLabel(v)).toBe('Ahmet Y.');
  });

  it('B5. 🔒 doğrulanmış ama adı okunamayan kayıt İSİM UYDURMAZ', () => {
    const v = buildLastSeenDriverView({
      rows: [row({ driver_name: null })], readable: true });
    expect(lastSeenDriverLabel(v)).toBe('Sürücü kaydı bulunamadı');
  });

  it('B6. 🔒 doğrulanmış kayıt varsa doğrulanmamışlar onu GÖLGELEMEZ', () => {
    const v = buildLastSeenDriverView({
      rows: [
        row({ history_id: 'h-2', source: 'HEAD_UNIT', identity_verifying: false,
              driver_id: null, driver_name: null,
              detected_at: '2026-07-30T11:00:00.000Z' }),
        row(),
      ],
      readable: true,
    });
    expect(v.unverifiedOnly).toBe(false);
    expect(lastSeenDriverLabel(v)).toBe('Ahmet Y.');
  });
});

describe('LastSeenDriver · C. Durum ve süre — SAHTE DEĞER YOK', () => {
  it('C1. 🔒 açık segment "şu an araçta"', () => {
    const v = buildLastSeenDriverView({ rows: [row()], readable: true });
    expect(v.isCurrent).toBe(true);
    expect(lastSeenDetailLabel(v)).toContain('Şu an araçta');
  });

  it('C2. 🔒 açık segmentte süre GÖSTERİLMEZ (sahte 0 YOK)', () => {
    const v = buildLastSeenDriverView({ rows: [row()], readable: true });
    expect(v.entry?.durationMs).toBeNull();
    expect(lastSeenDetailLabel(v)).not.toContain('0 sn');
  });

  it('C3. 🔒 kapanmış segmentin süresi gösterilir', () => {
    const v = buildLastSeenDriverView({
      rows: [row({ status: 'TTL_EXPIRED', close_reason: 'TTL_EXPIRED',
                   expired_at: '2026-07-30T17:00:00.000Z', duration_ms: 28800000 })],
      readable: true,
    });
    expect(v.isCurrent).toBe(false);
    expect(lastSeenDetailLabel(v)).toContain('8 sa');
  });

  it('C4. 🔒 bigint METİN olarak gelse de sayıya çevrilir', () => {
    expect(buildPresenceHistoryEntry(row({ duration_ms: '3600000' })).durationMs)
      .toBe(3_600_000);
    expect(buildPresenceHistoryEntry(row({ duration_ms: 'abc' })).durationMs).toBeNull();
  });

  it('C5. 🔒 TANINMAYAN durum "açık" SAYILMAZ', () => {
    const e = buildPresenceHistoryEntry(row({ status: 'UYDURMA' }));
    expect(e.status).not.toBe('OPEN');
    expect(PRESENCE_HISTORY_STATUSES).toContain(e.status);
  });

  it('C6. 🔒 bilinmeyen süre "Veri yok" — 0 DEĞİL', () => {
    expect(presenceDurationLabel(null)).toBe('Veri yok');
    expect(presenceDurationLabel(0)).toBe('0 sn');
  });

  it('C7. 🔒 geçersiz tarih UYDURULMAZ', () => {
    expect(buildPresenceHistoryEntry(row({ detected_at: 'bozuk' })).detectedAtMs)
      .toBeNull();
  });
});

describe('LastSeenDriver · D. Sıralamaya güvenilmez', () => {
  it('D1. 🔒 en yeni gözlem, satır sırası bozuksa bile seçilir', () => {
    const v = buildLastSeenDriverView({
      rows: [
        row({ history_id: 'h-old', driver_name: 'Eski',
              detected_at: '2026-07-30T05:00:00.000Z' }),
        row({ history_id: 'h-new', driver_name: 'Yeni',
              detected_at: '2026-07-30T15:00:00.000Z' }),
      ],
      readable: true,
    });
    expect(lastSeenDriverLabel(v)).toBe('Yeni');
  });

  it('D2. 🔒 kimliksiz satır (history_id yok) ELENİR', () => {
    const v = buildLastSeenDriverView({
      rows: [row({ history_id: null })], readable: true });
    expect(v.hasRecord).toBe(false);
  });
});

describe('LastSeenDriver · E. Etiketler', () => {
  it('E1. 🔒 tüm durum ve kaynak etiketleri kapsanır', () => {
    expect(presenceHistoryStatusLabel('OPEN')).toBe('Şu an araçta');
    expect(presenceHistoryStatusLabel('SUPERSEDED')).toBe('Yerine başka sürücü geçti');
    expect(presenceHistoryStatusLabel('TTL_EXPIRED')).toBe('Gözlemin süresi doldu');
    expect(presenceHistorySourceLabel('HEAD_UNIT')).toBe('Araç ekranı');
    expect(presenceHistorySourceLabel('NFC')).toBe('NFC kart');
  });
});

describe('LastSeenDriver · F. Fleet UI kilitleri', () => {
  const MODAL = readFileSync(
    join(process.cwd(), 'src/components/dashboard/VehicleModal.tsx'), 'utf8');

  it('F1. 🔒 araç detayında "Son görülen sürücü" alanı VAR', () => {
    expect(MODAL).toContain('Son görülen sürücü');
    expect(MODAL).toContain('lastSeenDriverLabel');
  });

  it('F2. 🔒 gözlem, trip sürücüsü KARARI ile karıştırılmaz', () => {
    expect(MODAL).toContain('gözlemdir');
    /* Trip attribution gösterimi SİLİNMEDİ — ikisi ayrı kalır. */
    expect(MODAL).toContain('tripDriverLabel');
  });

  it('F3. 🔒 doğrulanmamış gözlem SESSİZCE gizlenmez', () => {
    expect(MODAL).toContain('unverifiedOnly');
    expect(MODAL).toContain('kanıt sayılmaz');
  });

  it('F4. 🔒 okunamadı ≠ kayıt yok ayrımı UI\'da korunur', () => {
    expect(MODAL).toContain('lastSeen.readable');
    expect(MODAL).toContain('Okunamadı');
  });

  it('F5. 🔒 unmount sonrası setState YOK', () => {
    /* Kilit İMPORT satırını değil ÇAĞRI YERİNİ inceler — metin araması
       niyet kanıtı değildir (P1 raporu §10 dersi). */
    const at = MODAL.indexOf('await fetchVehiclePresenceHistory(');
    expect(at).toBeGreaterThan(-1);
    expect(MODAL.slice(at, at + 300)).toContain('if (!alive) return;');
  });
});
