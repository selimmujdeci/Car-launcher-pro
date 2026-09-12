package com.cockpitos.pro.media;

import androidx.annotation.NonNull;
import androidx.media3.common.ForwardingPlayer;
import androidx.media3.common.Player;

/**
 * MÜZİK HUB PAKET A — Otoriteyi BYPASS ETMEYİ imkânsız kılan sarmalayıcı.
 *
 * SORUN: MediaSession'a çıplak ExoPlayer verilirse, bildirim düğmeleri · kilit
 * ekranı · Bluetooth AVRCP · direksiyon medya tuşları doğrudan
 * {@code player.play()} çağırır. O yol audio focus İSTEMEZ ve "kullanıcı mı
 * duraklattı" bilgisini güncellemez → focus politikası delinir, iki backend
 * aynı anda ses verebilir.
 *
 * ÇÖZÜM: MediaSession bu sarmalayıcıyı görür. Oynatma niyeti üreten HER çağrı
 * ({@code play}, {@code pause}, {@code setPlayWhenReady}, {@code stop})
 * {@link CarosPlaybackService}'in focus kapısından geçer. Diğer tüm çağrılar
 * (seek, kuyruk okuma, metadata) olduğu gibi iletilir.
 *
 * NOT: Servisin kendi iç metotları SARMALANMAMIŞ ExoPlayer üzerinde çalışır →
 * özyineleme (recursion) yoktur.
 */
public final class CarosFocusAwarePlayer extends ForwardingPlayer {

    private final CarosPlaybackService service;

    public CarosFocusAwarePlayer(@NonNull Player wrapped, @NonNull CarosPlaybackService service) {
        super(wrapped);
        this.service = service;
    }

    @Override
    public void play() {
        // Focus reddedilirse çalmaz — ve YALAN da söylemez: hata kodu teşhise yazılır.
        service.play();
    }

    @Override
    public void pause() {
        // Bildirim/AVRCP'den gelen duraklatma da KULLANICI niyetidir:
        // focus geri geldiğinde otomatik devam ETMEMELİDİR.
        service.pause();
    }

    @Override
    public void setPlayWhenReady(boolean playWhenReady) {
        if (playWhenReady) service.play();
        else               service.pause();
    }

    @Override
    public void stop() {
        service.stop();
    }
}
