package com.cockpitos.pro.media;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;

/**
 * F2 — artwork sampled-decode ve cache anahtarı DAVRANIŞ KİLİTLERİ (JVM).
 *
 * Kilitlenen iddia: "hedef boyuta yakın decode" bir yorum değil, ölçülebilir bir
 * davranıştır. 3000px bir kapak 96px küçük resim için TAM boyutta decode edilip
 * sonra küçültülmez; önce sınırlar okunur, sonra örneklenmiş (sampled) decode edilir.
 */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = 34)
public class ArtworkStoreTest {

    @Test
    public void sampleSizeShrinksLargeArtworkTowardsTheTarget() {
        // 3000px → 96px: 1/16 örnekleme (187px) hedefi geçer; 1/32 (93px) geçmez.
        assertEquals(16, ArtworkStore.sampleSizeFor(3000, 3000, 96));
        assertEquals(16, ArtworkStore.sampleSizeFor(3000, 3000, 160));
        assertEquals(4, ArtworkStore.sampleSizeFor(3000, 3000, 640));
    }

    @Test
    public void sampledBitmapNeverFallsBelowTheTarget() {
        int[] sources = { 240, 500, 1000, 1400, 2048, 3000, 6000 };
        int[] targets = { 96, 160, 640 };
        for (int src : sources) {
            for (int target : targets) {
                int sample = ArtworkStore.sampleSizeFor(src, src, target);
                int decoded = src / sample;
                assertTrue("sample=" + sample + " src=" + src + " target=" + target,
                    decoded >= Math.min(src, target));
            }
        }
    }

    @Test
    public void smallArtworkIsNeverUpsampledOrDownsampled() {
        assertEquals(1, ArtworkStore.sampleSizeFor(64, 64, 96));
        assertEquals(1, ArtworkStore.sampleSizeFor(96, 96, 96));
        // Bozuk/okunamayan sınırlar sessizce 1 döner; decode yine denenir.
        assertEquals(1, ArtworkStore.sampleSizeFor(-1, -1, 96));
        assertEquals(1, ArtworkStore.sampleSizeFor(3000, 3000, 0));
    }

    @Test
    public void cacheKeyIsDeterministicAndTargetScoped() {
        String uri = "content://media/external_primary/audio/albumart/42";
        assertEquals(ArtworkStore.keyFor(uri, 96), ArtworkStore.keyFor(uri, 96));
        assertNotEquals(ArtworkStore.keyFor(uri, 96), ArtworkStore.keyFor(uri, 640));
        assertNotEquals(ArtworkStore.keyFor(uri, 96), ArtworkStore.keyFor(uri + "9", 96));
        // Dosya adı olarak güvenli: yalnız hex.
        assertTrue(ArtworkStore.keyFor(uri, 96).matches("[0-9a-f]+"));
    }
}
