/**
 * messageAnnounceGate.test — mesaj duyurusu süzgeci.
 * Saha 2026-09-24: "Mavi durmadan telefonun sesini kısıyor" — her mesaj (ve
 * WhatsApp'ın özet/grup güncellemeleri) ayrı duyuruluyor, her duyuru müziği kısıyordu.
 */
import { describe, it, expect } from 'vitest';
import {
  decideMessageAnnounce, noteMessageAnnounced, EMPTY_ANNOUNCE_LEDGER,
  MESSAGE_ANNOUNCE_GLOBAL_GAP_MS, MESSAGE_ANNOUNCE_SAME_SENDER_MS,
} from '../platform/notificationService';

const msg = (sender: string, text = 'selam') => ({ key: `wa|${sender}`, sender, appName: 'WhatsApp', text });

describe('mesaj duyurusu süzgeci', () => {
  it('🔒 aynı kişiden 2 dk içinde ikinci duyuru YOK', () => {
    let l = EMPTY_ANNOUNCE_LEDGER;
    expect(decideMessageAnnounce(l, msg('Ahmet'), 0)).toBe(true);
    l = noteMessageAnnounced(l, 'wa|Ahmet', 0);
    expect(decideMessageAnnounce(l, msg('Ahmet', 'naber'), 60_000)).toBe(false);
    expect(decideMessageAnnounce(l, msg('Ahmet', 'naber'), MESSAGE_ANNOUNCE_SAME_SENDER_MS + 1)).toBe(true);
  });

  it('🔒 herhangi iki duyuru arası en az 20 sn (kalabalık grup / art arda mesaj)', () => {
    let l = noteMessageAnnounced(EMPTY_ANNOUNCE_LEDGER, 'wa|Ahmet', 0);
    expect(decideMessageAnnounce(l, msg('Ayşe'), 5_000)).toBe(false);
    expect(decideMessageAnnounce(l, msg('Ayşe'), MESSAGE_ANNOUNCE_GLOBAL_GAP_MS + 1)).toBe(true);
    l = noteMessageAnnounced(l, 'wa|Ayşe', MESSAGE_ANNOUNCE_GLOBAL_GAP_MS + 1);
    expect(Object.keys(l.lastByKey).sort()).toEqual(['wa|Ahmet', 'wa|Ayşe']);
  });

  it('🔒 özet bildirimleri ("5 yeni mesaj") hiç duyurulmaz', () => {
    expect(decideMessageAnnounce(EMPTY_ANNOUNCE_LEDGER, msg('WhatsApp', '5 yeni mesaj'), 0)).toBe(false);
    expect(decideMessageAnnounce(EMPTY_ANNOUNCE_LEDGER, msg('Aile Grubu', '3 sohbetten 12 mesaj'), 0)).toBe(false);
    expect(decideMessageAnnounce(EMPTY_ANNOUNCE_LEDGER, msg('', 'x'), 0)).toBe(false);
  });

  it('eski kayıtlar defterden düşer (sınırlı bellek)', () => {
    const l = noteMessageAnnounced(noteMessageAnnounced(EMPTY_ANNOUNCE_LEDGER, 'wa|A', 0), 'wa|B', MESSAGE_ANNOUNCE_SAME_SENDER_MS + 10);
    expect(Object.keys(l.lastByKey)).toEqual(['wa|B']);
  });
});
