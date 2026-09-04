/**
 * musicF72VideoSafety.test.ts — MUSIC F7.2 · Sürüşte video görünürlüğü kapısı.
 *
 * ÖLÇÜLEN KUSUR (F7.2 öncesi): `videoModeStore` koşulsuzdu; `MediaScreen`
 * YouTube video host'unu tüm viewport'a (`z-index: 2147483000`) yayıyordu ve
 * hiçbir hız/duruş kontrolü YOKTU — araç hareket hâlindeyken de tam ekran
 * video görünüyordu.
 *
 * Bu paket SAF karar politikasını kilitler. Ses tarafına dokunulmadığı
 * (yalnız GÖRÜNTÜ kararı verildiği) yapısal olarak da doğrulanır.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  decideVideoVisibility, isVideoBlocked, videoBlockReason,
  VIDEO_ALLOW_BELOW_KMH, VIDEO_BLOCK_ABOVE_KMH,
  type VideoVisibilityDecision,
} from '../platform/media/videoSafetyPolicy';

const UNKNOWN: VideoVisibilityDecision = 'BLOCKED_SPEED_UNKNOWN';
const decide = (speedKmh: number | null, previous: VideoVisibilityDecision = UNKNOWN) =>
  decideVideoVisibility({ speedKmh, previous });

describe('F7.2 · video görünürlüğü kararı', () => {
  it('hız ÖLÇÜLEMİYORSA duruş VARSAYILMAZ — görüntü kapalı', () => {
    expect(decide(null)).toBe('BLOCKED_SPEED_UNKNOWN');
    expect(decide(null, 'ALLOWED')).toBe('BLOCKED_SPEED_UNKNOWN');
  });

  it('bozuk/imkânsız hız duruş kanıtı SAYILMAZ', () => {
    expect(decide(Number.NaN)).toBe('BLOCKED_SPEED_UNKNOWN');
    expect(decide(-5)).toBe('BLOCKED_SPEED_UNKNOWN');
    expect(decide(9999)).toBe('BLOCKED_SPEED_UNKNOWN');
    expect(decide(Number.POSITIVE_INFINITY)).toBe('BLOCKED_SPEED_UNKNOWN');
  });

  it('duruş ölçüldüyse görüntü AÇILIR', () => {
    expect(decide(0)).toBe('ALLOWED');
    expect(decide(VIDEO_ALLOW_BELOW_KMH)).toBe('ALLOWED');
  });

  it('araç hareket hâlindeyse görüntü KAPANIR', () => {
    expect(decide(VIDEO_BLOCK_ABOVE_KMH + 0.1, 'ALLOWED')).toBe('BLOCKED_MOVING');
    expect(decide(50, 'ALLOWED')).toBe('BLOCKED_MOVING');
    expect(decide(120, 'ALLOWED')).toBe('BLOCKED_MOVING');
  });

  it('histerezis bandı dur-kalk trafiğinde kararı TİTRETMEZ', () => {
    /* Bant: (ALLOW_BELOW, BLOCK_ABOVE]. Önceki karar korunur. */
    const mid = (VIDEO_ALLOW_BELOW_KMH + VIDEO_BLOCK_ABOVE_KMH) / 2;
    expect(decide(mid, 'ALLOWED')).toBe('ALLOWED');
    expect(decide(mid, 'BLOCKED_MOVING')).toBe('BLOCKED_MOVING');
    /* "Hız bilinmiyordu" durumundan bandın içine girmek İZİN ÜRETMEZ. */
    expect(decide(mid, 'BLOCKED_SPEED_UNKNOWN')).toBe('BLOCKED_MOVING');
  });

  it('eşik sırası tutarlı (ALLOW <= BLOCK) — bant ters dönmez', () => {
    expect(VIDEO_ALLOW_BELOW_KMH).toBeLessThanOrEqual(VIDEO_BLOCK_ABOVE_KMH);
  });

  it('her engel GEREKÇE taşır — sessiz engelleme yok', () => {
    expect(videoBlockReason('ALLOWED')).toBeNull();
    expect(videoBlockReason('BLOCKED_MOVING')).toBeTruthy();
    expect(videoBlockReason('BLOCKED_SPEED_UNKNOWN')).toBeTruthy();
    /* Gerekçe SESİN etkilenmediğini açıkça söylemeli. */
    expect(videoBlockReason('BLOCKED_MOVING')).toMatch(/[Ss]es/);
    expect(videoBlockReason('BLOCKED_SPEED_UNKNOWN')).toMatch(/[Ss]es/);
    expect(isVideoBlocked('ALLOWED')).toBe(false);
    expect(isVideoBlocked('BLOCKED_MOVING')).toBe(true);
  });

  it('politika SAF — I/O · timer · global durum · React YOK', () => {
    const src = readFileSync(
      resolve(process.cwd(), 'src/platform/media/videoSafetyPolicy.ts'), 'utf8',
    );
    expect(src.length, 'politika okunamadı — kilit boş kümeye düştü').toBeGreaterThan(500);
    const code = src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
    for (const forbidden of [
      'setTimeout', 'setInterval', 'Date.now', 'fetch(', 'localStorage',
      'from \'react\'', 'useState', 'CarLauncher',
    ]) {
      expect(code, `saflık bozulmuş: ${forbidden}`).not.toContain(forbidden);
    }
    /* SESE DOKUNMAZ: ses/oynatma otoritelerinin adı bile geçmemeli. */
    for (const forbidden of [
      'mediaCommandGateway', 'duckPolicy', 'volumePolicy', 'setVolume', 'pause(',
    ]) {
      expect(code, `görüntü kapısı ses otoritesine karışmış: ${forbidden}`)
        .not.toContain(forbidden);
    }
  });
});
