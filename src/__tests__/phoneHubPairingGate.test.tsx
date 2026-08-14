/**
 * phoneHubPairingGate.test.tsx — E-20 KİLİDİ: eşleştirme ONAY yüzeyi bağlı.
 *
 * ── BULUNAN KUSUR (envanter denetimi E-20) ─────────────────────────────
 * `confirmPhoneHubPairing` ve `getPhoneHubPairingCode` ürün yolunda SIFIR
 * çağırana sahipti: native el sıkışması "kullanıcı onayı" adımında kalıyor,
 * RFCOMM oturumu hiçbir zaman kurulamıyordu (kütük #122'nin kod tarafındaki ucu).
 *
 * ── NE KİLİTLENİYOR ────────────────────────────────────────────────────
 * 1. Onay BEKLENİYORSA onay/ret yüzeyi ekranda VARDIR.
 * 2. KONTROL — onay beklenmiyorsa yüzey YOKTUR (kilit körü körüne geçmiyor).
 * 3. Kod görülmeden ONAY verilemez (MITM kapısı); RET her zaman mümkündür.
 * 4. Doğrulama kodu modele · anlık görüntüye · dışa aktarıma GİRMEZ.
 *
 * ⚠️ DÜRÜST SINIR: bu repoda `@testing-library/react` YOK → tıklama olayı
 * runtime'da tetiklenemez. Düğmelerin gerçekten native'i çağırdığı cihazda
 * doğrulanacaktır (saha kütüğü 🔴).
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';

import type { PhoneHubLinkSnapshotRaw } from '../platform/phoneHub/phoneHubLink';
import { buildPhoneHubLinkExport, buildPhoneHubLinkView } from '../platform/devtools/phoneHubLinkModel';

const h = vi.hoisted(() => ({
  snapshot: { present: false } as PhoneHubLinkSnapshotRaw,
}));

vi.mock('../platform/devtools/phoneHubLinkSources', () => ({
  readPhoneHubLinkSnapshot: () => h.snapshot,
}));

import { PhoneHubLinkScreen } from '../components/devtools/screens/PhoneHubLinkScreen';

const SCREEN_SRC = readFileSync(
  'src/components/devtools/screens/PhoneHubLinkScreen.tsx', 'utf8');

const PAIRING_CODE = '481902';

function awaiting(over: Partial<PhoneHubLinkSnapshotRaw> = {}): PhoneHubLinkSnapshotRaw {
  return {
    present: true,
    schemaVersion: 1,
    server: {
      state: 'CLIENT_CONNECTED', running: true, disposed: false,
      listenStartedAtMs: 1000, acceptedCount: 1, rejectedSecondClient: 0,
      hasActiveSocket: true, lastErrorCode: null,
    },
    preconditions: { ready: true, blockerCode: null, connectPermission: true },
    identity: { hasIdentity: true, hardwareBacked: false },
    pairing: { awaitingConfirmation: true, expiresAtMs: 60_000 },
    ...over,
  };
}

function render(raw: PhoneHubLinkSnapshotRaw): string {
  h.snapshot = raw;
  return renderToStaticMarkup(<PhoneHubLinkScreen />);
}

describe('E-20 — Phone Hub eşleştirme onay kapısı', () => {
  it('onay BEKLENİYORKEN onay/ret yüzeyi ekranda vardır', () => {
    const html = render(awaiting());
    expect(html).toContain('phl-pairing-gate');
    expect(html).toContain('phl-pairing-accept');
    expect(html).toContain('phl-pairing-reject');
    expect(html).toContain('phl-reveal-code');
  });

  it('KONTROL — onay beklenmiyorken yüzey HİÇ basılmaz', () => {
    const html = render({ ...awaiting(), pairing: { awaitingConfirmation: false } });
    expect(html).not.toContain('phl-pairing-gate');
    expect(html).not.toContain('phl-pairing-accept');
    expect(html).not.toContain('phl-pairing-reject');
  });

  it('kod görülmeden ONAY verilemez; RET her zaman açıktır', () => {
    const html = render(awaiting());
    /* İlk render'da kod okunmamıştır → maskeli gösterilir. */
    expect(html).toContain('••••••');
    /* Onay düğmesi disabled ÖZNİTELİĞİ taşır, ret düğmesi taşımaz.
       (`disabled:opacity-40` bir Tailwind SINIFIDIR — öznitelik değil; alt-dize
       aramak bu yüzden yanıltır, `disabled=""` özniteliği aranır.) */
    const btn = (id: string) => {
      const from = html.indexOf(id);
      return html.slice(from, html.indexOf('</button>', from));
    };
    expect(btn('phl-pairing-accept')).toContain('disabled=""');
    expect(btn('phl-pairing-reject')).not.toContain('disabled=""');
  });

  it('kod modele ve dışa aktarıma GİRMEZ (gizlilik)', () => {
    const view = buildPhoneHubLinkView(awaiting());
    const exported = buildPhoneHubLinkExport(view, 1_000);
    expect(JSON.stringify(view)).not.toContain(PAIRING_CODE);
    expect(exported).not.toContain(PAIRING_CODE);
    /* Yapısal: kod state'i yalnız ekranda yaşar — modele/dışa aktarıma
       taşınırsa bu kilit düşer. */
    expect(SCREEN_SRC).not.toMatch(/buildPhoneHubLinkExport\([^)]*pairingCode/);
    expect(SCREEN_SRC).not.toMatch(/setNotice\([^)]*pairingCode/);
  });

  it('onay ve ret NATIVE otoriteye gider (uydurma sonuç yok)', () => {
    expect(SCREEN_SRC).toContain('confirmPhoneHubPairing(accepted)');
    expect(SCREEN_SRC).toContain('decidePairing(true)');
    expect(SCREEN_SRC).toContain('decidePairing(false)');
    expect(SCREEN_SRC).toContain('getPhoneHubPairingCode()');
    /* Karar sonrası tanı native'den YENİDEN okunur (runAction bunu yapar). */
    expect(SCREEN_SRC).toMatch(/decidePairing[\s\S]{0,400}runAction\(/);
  });

  it('kod ekran sökülürken silinir (Zero-Leak · sızıntı yok)', () => {
    expect(SCREEN_SRC).toMatch(/mountedRef\.current = false;[\s\S]{0,120}setPairingCode\(null\)/);
  });
});
