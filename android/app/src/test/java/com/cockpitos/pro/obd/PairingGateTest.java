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
}
