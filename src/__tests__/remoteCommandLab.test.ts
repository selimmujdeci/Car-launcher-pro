/**
 * remoteCommandLab.test.ts — CAROS LAB · Uzak Komut Zinciri kilitleri.
 *
 * ZORUNLU GÖZLEMLENEBİLİRLİK (CLAUDE.md): ekranın işi "komut çalışmadı"nın
 * SEBEBİNİ ayırt etmektir. Bu kilitler ayrımın çökmesini engeller ve
 * gizlilik sınırını (kural 6) koruma altına alır.
 */

import { describe, it, expect } from 'vitest';

import {
  judgeRemoteCommandChain, buildRemoteCommandView, ageText,
  REMOTE_COMMAND_VERDICT_LABEL,
} from '../platform/devtools/remoteCommandModel';
import type { RemoteCommandRawSnapshot } from '../platform/devtools/remoteCommandSources';
import type { CommandEvidence } from '../platform/commandListener';
import type { SpeedAlertEvidence } from '../platform/speedAlertRuntime';

const NOW = 1_760_000_000_000;

const ZERO_CMD: CommandEvidence = {
  received: 0, completed: 0, rejected: 0, failed: 0, cryptoFailed: 0,
  unknownType: 0, movingBlocked: 0, ttlExpired: 0, retries: 0,
  lastType: null, lastOutcome: null, lastAt: null,
};

const ZERO_SPEED: SpeedAlertEvidence = {
  running: false, samples: 0, unknownSpeed: 0, gateFed: 0,
  fired: 0, suppressedCooldown: 0, lastReason: null,
  lastFiredAtMs: null, pushChannelBound: false,
};

function snap(over: Partial<RemoteCommandRawSnapshot> = {}): RemoteCommandRawSnapshot {
  return {
    readAt: NOW,
    listenerActive: true,
    command: ZERO_CMD,
    speedAlert: ZERO_SPEED,
    speedAlertConfig: null,
    hysteresisKmh: 8,
    cooldownMs: 300_000,
    thresholdMinKmh: 30,
    thresholdMaxKmh: 250,
    ...over,
  };
}

describe('hüküm — dört sebep ayrı ayrı', () => {
  it('KİLİT: kaynak okunamadıysa hüküm UNKNOWN (fail-closed, sahte sağlık yok)', () => {
    expect(judgeRemoteCommandChain(snap({ listenerActive: null }))).toBe('UNKNOWN');
    expect(judgeRemoteCommandChain(snap({ command: null }))).toBe('UNKNOWN');
  });

  it('KİLİT: dinleyici bağlı değilse diğer sayaçlar hükmü EZEMEZ', () => {
    const v = judgeRemoteCommandChain(snap({
      listenerActive: false,
      command: { ...ZERO_CMD, received: 50, completed: 50 },
    }));
    expect(v).toBe('NOT_LISTENING');
  });

  it('hiç komut gelmediyse "sessizlik" ayrı bir hükümdür (arıza DEĞİL)', () => {
    expect(judgeRemoteCommandChain(snap())).toBe('NEVER_RECEIVED');
  });

  it('KİLİT: şifre · tanımsız tip · güvenlik kapısı AYRI hükümler', () => {
    expect(judgeRemoteCommandChain(snap({
      command: { ...ZERO_CMD, received: 10, cryptoFailed: 8 },
    }))).toBe('CRYPTO_BLOCKED');

    expect(judgeRemoteCommandChain(snap({
      command: { ...ZERO_CMD, received: 10, unknownType: 9 },
    }))).toBe('TYPE_UNKNOWN');

    expect(judgeRemoteCommandChain(snap({
      command: { ...ZERO_CMD, received: 10, movingBlocked: 7 },
    }))).toBe('SAFETY_BLOCKED');
  });

  it('KİLİT: "hata yok" tek başına SAĞLIK kanıtı değildir', () => {
    // Komut geldi, hiçbiri düşmedi ama hiçbiri de tamamlanmadı → HEALTHY DEĞİL.
    expect(judgeRemoteCommandChain(snap({
      command: { ...ZERO_CMD, received: 5 },
    }))).toBe('UNKNOWN');

    expect(judgeRemoteCommandChain(snap({
      command: { ...ZERO_CMD, received: 5, completed: 5 },
    }))).toBe('HEALTHY');
  });

  it('her hükmün Türkçe etiketi vardır (ekranda ham enum görünmez)', () => {
    for (const k of Object.keys(REMOTE_COMMAND_VERDICT_LABEL)) {
      expect(REMOTE_COMMAND_VERDICT_LABEL[k as keyof typeof REMOTE_COMMAND_VERDICT_LABEL].length)
        .toBeGreaterThan(0);
    }
  });
});

describe('görünüm — sahte 0 ve gizlilik', () => {
  it('KİLİT: okunamayan sayaç "0 ÖLÇÜLDÜ" diye SUNULMAZ', () => {
    const v = buildRemoteCommandView(snap({ command: null, speedAlert: null }), NOW);
    const all = v.cards.flatMap((c) => c.fields);
    // Kaynak tamamen yoksa tek bir UNAVAILABLE alan kalır — uydurma sayı yok.
    expect(all.every((f) => f.klass === 'UNAVAILABLE')).toBe(true);
    expect(v.verdict).toBe('UNKNOWN');
  });

  it('ölçülmüş 0 ile okunamayan AYRIDIR', () => {
    const v = buildRemoteCommandView(snap({
      command: { ...ZERO_CMD, received: 3, completed: 0 },
    }), NOW);
    const completed = v.cards.flatMap((c) => c.fields).find((f) => f.id === 'completed');
    // Gerçekten ölçülmüş 0 → OBSERVED (KAYNAK YOK değil).
    expect(completed?.klass).toBe('OBSERVED');
    expect(completed?.value).toBe('0');
  });

  it('KİLİT: hiçbir alanda UUID / payload / anahtar sızıntısı YOK', () => {
    const v = buildRemoteCommandView(snap({
      command: {
        ...ZERO_CMD, received: 2, completed: 1,
        lastType: 'unlock', lastOutcome: 'completed', lastAt: NOW - 5_000,
      },
      speedAlert: { ...ZERO_SPEED, running: true, samples: 100, gateFed: 100 },
      speedAlertConfig: { enabled: true, thresholdKmh: 120 },
    }), NOW);

    const blob = JSON.stringify(v);
    // UUID biçimi (komut/araç kimliği) HİÇBİR yerde geçmez — açıklamalar dâhil.
    expect(blob).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    // Base64/hex uzun token izi de yok.
    expect(blob).not.toMatch(/\b[A-Za-z0-9+/]{40,}={0,2}\b/);

    /* Yasak-kelime taraması YALNIZ DEĞER alanlarında yapılır. Tüm bloba
       bakmak yanlış olur: açıklama metinleri "payload defterlere GİRMEZ"
       gibi cümleler içerir ve kilit kendi uyarısına takılırdı — bu tuzak
       daha önce (#467–#479) ölçülmüştü. Sızıntı riski DEĞERDEDİR. */
    const values = v.cards.flatMap((c) => c.fields.map((f) => f.value)).join('|');
    for (const forbidden of ['api_key', 'apiKey', 'nonce', 'payload', 'privateKey', 'Bearer', 'eyJ']) {
      expect(values).not.toContain(forbidden);
    }
  });

  it('son komut TİPİ taşınır, kimliği taşınmaz', () => {
    const v = buildRemoteCommandView(snap({
      command: { ...ZERO_CMD, received: 1, completed: 1, lastType: 'read_dtc', lastOutcome: 'completed', lastAt: NOW },
    }), NOW);
    const t = v.cards.flatMap((c) => c.fields).find((f) => f.id === 'lastType');
    expect(t?.value).toBe('read_dtc');
  });

  it('KİLİT: model zamanı KENDİ okumaz — `nowMs` dışarıdan gelir', () => {
    const a = buildRemoteCommandView(snap(), 1_000);
    const b = buildRemoteCommandView(snap(), 1_000);
    // Aynı girdi + aynı zaman → birebir aynı çıktı (deterministik/saf).
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe('ageText — saf yaş metni', () => {
  it('null girdi null döner (uydurma tarih yok)', () => {
    expect(ageText(null, NOW)).toBeNull();
    expect(ageText(Number.NaN, NOW)).toBeNull();
  });

  it('yaş kademeleri', () => {
    expect(ageText(NOW - 5_000, NOW)).toBe('5 sn önce');
    expect(ageText(NOW - 120_000, NOW)).toBe('2 dk önce');
    expect(ageText(NOW - 7_200_000, NOW)).toBe('2 sa önce');
    expect(ageText(NOW + 1_000, NOW)).toBe('şimdi');
  });
});
