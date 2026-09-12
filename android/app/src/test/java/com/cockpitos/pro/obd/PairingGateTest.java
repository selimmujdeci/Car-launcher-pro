package com.cockpitos.pro.obd;

import static org.junit.Assert.assertEquals;

import org.junit.Test;

/**
 * PairingGateTest — OEM Bluetooth eşleşme kararı kilitleri.
 *
 * KURAL (kullanıcı politikası): daha önce eşleşmiş cihazda HİÇBİR DURUMDA yeniden pair
 * isteği çıkmamalı; dialog yalnız gerçekten gerekli olduğunda. Bu test o kuralı, regresyona
 * karşı, karar tablosunun HER dalıyla kilitler.
 */
public class PairingGateTest {

    private static PairingGate.Decision decide(int bond, boolean inList, boolean hasPin) {
        return PairingGate.decide(bond, inList, hasPin);
    }

    // ── ANA KURAL: bonded cihaz asla yeniden pair edilmez ────────────────────

    @Test
    public void bondedListedeVarsa_pinVarsaBile_ALREADY_BONDED() {
        // En kritik saha vakası: cache'li getBondState() yanlış (NONE) dönse BİLE,
        // otoriter getBondedDevices() listesi cihazı bonded diyorsa → pairing YOK.
        assertEquals(PairingGate.Decision.ALREADY_BONDED,
            decide(PairingGate.BOND_NONE, true, true));
        assertEquals(PairingGate.Decision.ALREADY_BONDED,
            decide(PairingGate.BOND_NONE, true, false));
    }

    @Test
    public void bondStateBONDED_pinVarsaBile_ALREADY_BONDED() {
        assertEquals(PairingGate.Decision.ALREADY_BONDED,
            decide(PairingGate.BOND_BONDED, false, true));
    }

    // ── BONDING: devam eden eşleşme → yeni createBond başlatma ───────────────

    @Test
    public void bondStateBONDING_WAIT_BONDING_ciftBondYok() {
        // Eski kod BONDING'i "!= BONDED" sayıp İKİNCİ createBond çağırırdı (çift-bond
        // yarışı + dialog). Artık yalnız beklenir.
        assertEquals(PairingGate.Decision.WAIT_BONDING,
            decide(PairingGate.BOND_BONDING, false, true));
        assertEquals(PairingGate.Decision.WAIT_BONDING,
            decide(PairingGate.BOND_BONDING, false, false));
    }

    // ── NONE: gerçekten eşleşmemiş ───────────────────────────────────────────

    @Test
    public void bondNONE_pinVar_PAIR_WITH_PIN() {
        assertEquals(PairingGate.Decision.PAIR_WITH_PIN,
            decide(PairingGate.BOND_NONE, false, true));
    }

    @Test
    public void bondNONE_pinYok_CONNECT_WITHOUT_PAIRING() {
        // PIN yoksa createBond ÇAĞRILMAZ — Android'in kendi akışı devralır (dialog yalnız
        // gerçekten gerekliyse). Uygulama proaktif pair dialog'u zorlamaz.
        assertEquals(PairingGate.Decision.CONNECT_WITHOUT_PAIRING,
            decide(PairingGate.BOND_NONE, false, false));
    }

    // ── Öncelik: bonded listesi BONDING/pin'i EZER ───────────────────────────

    @Test
    public void bondedListe_BONDINGdurumunuEzer() {
        // Otorite bonded liste — state ne derse desin pair yok.
        assertEquals(PairingGate.Decision.ALREADY_BONDED,
            decide(PairingGate.BOND_BONDING, true, true));
    }

    // ── PR-OBD-PAIR-CONTINUITY: waitStrategyFor — SAF karar haritası kilitleri ──────
    // Kök neden: OBDManager tek bir 15s POLLING waitForBond() kullanıyordu; insan PIN
    // girişi bu pencereyi kolayca aşıyor, bonding SONRADAN bitse bile bağlantı denemesi
    // zaten düşmüş oluyordu. Bu harita, hangi Decision'ın ne kadar/nasıl beklendiğinin
    // TEK doğruluk kaynağıdır — Android API'ye bağımsız, JUnit ile kilitlenir.

    @Test
    public void waitStrategyFor_ALREADY_BONDED_NONE() {
        assertEquals(PairingGate.WaitStrategy.NONE,
            PairingGate.waitStrategyFor(PairingGate.Decision.ALREADY_BONDED));
    }

    @Test
    public void waitStrategyFor_PAIR_WITH_PIN_START_AND_WAIT() {
        // Native createBond()+setPin() BAŞLATIR, sonra bounded bekler (BOND_WAIT_TIMEOUT_MS).
        assertEquals(PairingGate.WaitStrategy.START_AND_WAIT,
            PairingGate.waitStrategyFor(PairingGate.Decision.PAIR_WITH_PIN));
    }

    @Test
    public void waitStrategyFor_WAIT_BONDING_WAIT_ONLY() {
        // Devam eden bir eşleşme var — İKİNCİ createBond çağrılmaz, yalnız beklenir.
        assertEquals(PairingGate.WaitStrategy.WAIT_ONLY,
            PairingGate.waitStrategyFor(PairingGate.Decision.WAIT_BONDING));
    }

    @Test
    public void waitStrategyFor_CONNECT_WITHOUT_PAIRING_NONE() {
        // BİLİNÇLİ KAPSAM: bu dal native'de createBond() ÇAĞIRMAZ — bond-bekleme eklemek,
        // hiç bonding gerektirmeyen (insecure-only) adaptörlerde asla gelmeyecek bir
        // BOND_BONDED sinyalini boşuna bekleyip gerçek regresyon üretirdi. Gerçek düzeltme
        // JS tarafındaki connect-timeout uzatmasıdır (bkz. obdService.ts PAIRING_GRACE).
        assertEquals(PairingGate.WaitStrategy.NONE,
            PairingGate.waitStrategyFor(PairingGate.Decision.CONNECT_WITHOUT_PAIRING));
    }
}
