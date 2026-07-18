package com.cockpitos.pro.obd;

import android.bluetooth.BluetoothDevice;

/**
 * PairingGate — OEM seviyesi Bluetooth eşleşme KARARI (saf, test edilebilir).
 *
 * KURAL (kullanıcı politikası): daha önce eşleşmiş cihazlarda HİÇBİR DURUMDA yeniden pair
 * isteği çıkmamalı; Android pairing dialog'u yalnız GERÇEKTEN gerekli olduğunda açılmalı.
 *
 * KÖK NEDEN (bu kapıdan önce): {@code OBDManager.connect} tek bir {@code getBondState() !=
 * BOND_BONDED} koşuluyla {@code createBond()} çağırıyordu. Bu üç şekilde yanlış-pair üretir:
 *  (1) BOND_BONDING de "!= BONDED"tır → devam eden bir eşleşme varken İKİNCİ createBond;
 *  (2) {@code getRemoteDevice(addr).getBondState()} bazı OEM BT stack'lerinde stale/BOND_NONE
 *      döner → gerçekte bonded cihaz pairing bloğuna girer;
 *  (3) createBond çağrısı dialog-bastırma receiver'ı OLMADAN yapıldığından sistem dialog'u çıkar.
 *
 * Bu kapı kararı TEK yerde, yan-etkisiz verir. Otoriter kaynak {@code getBondedDevices()}
 * listesidir (tek device nesnesinin cache'li state'i değil) — {@code addressInBondedList}.
 */
public final class PairingGate {

    private PairingGate() {}

    /** BluetoothDevice.BOND_BONDING literal'i — API sabitine bağımlılığı testte azaltmak için ayna. */
    static final int BOND_NONE    = BluetoothDevice.BOND_NONE;      // 10
    static final int BOND_BONDING = BluetoothDevice.BOND_BONDING;   // 11
    static final int BOND_BONDED  = BluetoothDevice.BOND_BONDED;    // 12

    public enum Decision {
        /** Cihaz zaten eşleşmiş → pairing YAPMA, doğrudan sokete geç (dialog imkânsız). */
        ALREADY_BONDED,
        /** Eşleşme HÂLİHAZIRDA sürüyor → yeni createBond BAŞLATMA, mevcudi bekle. */
        WAIT_BONDING,
        /** Eşleşmemiş + PIN var → dialog-bastırmalı sessiz eşleşme (setPin + createBond). */
        PAIR_WITH_PIN,
        /** Eşleşmemiş + PIN yok → createBond ÇAĞIRMA; secure socket.connect() Android'in
         *  kendi akışını tetikler (dialog YALNIZ gerçekten gerekliyse, ör. bilinmeyen cihaz). */
        CONNECT_WITHOUT_PAIRING
    }

    /**
     * Eşleşme kararını verir.
     *
     * @param bondState            {@code device.getBondState()} (cache olabilir — tek başına
     *                             otoriter DEĞİL, bu yüzden addressInBondedList ile birleşir)
     * @param addressInBondedList  adres {@code adapter.getBondedDevices()} listesinde mi
     *                             (OTORİTER kaynak — bonded cihazda pairing kesinlikle atlanır)
     * @param hasPin               çağıran bir PIN sağladı mı (sessiz eşleşme yalnız bununla mümkün)
     */
    public static Decision decide(int bondState, boolean addressInBondedList, boolean hasPin) {
        // OTORİTE: bonded listede VEYA state BONDED → asla yeniden pair (kullanıcı kuralı).
        if (addressInBondedList || bondState == BOND_BONDED) {
            return Decision.ALREADY_BONDED;
        }
        // Devam eden eşleşme → ikinci createBond başlatma (çift-bond yarışı + dialog riski).
        if (bondState == BOND_BONDING) {
            return Decision.WAIT_BONDING;
        }
        // Gerçekten eşleşmemiş.
        if (hasPin) {
            return Decision.PAIR_WITH_PIN;              // sessiz pair (receiver + setPin)
        }
        return Decision.CONNECT_WITHOUT_PAIRING;        // Android akışı — dialog yalnız gerekliyse
    }

    /**
     * PR-OBD-PAIR-CONTINUITY: bond-BEKLEME stratejisi — ensureBonded()'ın Decision'a göre
     * hangi native eylemi yapacağının SAF haritası (Android API'ye bağımsız, JUnit test edilir).
     *
     * KÖK NEDEN (bu haritadan önce): OBDManager tek bir 15s POLLING waitForBond() kullanıyordu
     * — insan PIN girişi (Android sistem dialog'u) asenkron ve bu pencereyi kolayca aşıyor.
     * Bonding SONRADAN (15s'den sonra) tamamlansa bile bağlantı denemesi zaten düşmüş oluyordu
     * → kullanıcı ilk eşleştirmede İKİNCİ kez "Bağlan" demek zorunda kalıyordu.
     *
     * NOT (bilinçli kapsam): CONNECT_WITHOUT_PAIRING → NONE döner (bekleme YOK). Bu dal native'de
     * createBond() ÇAĞIRMAZ; OS'in kendi bonding akışı (varsa) RFCOMM secure socket.connect()
     * İÇİNDE senkron olarak zaten gerçekleşir/beklenir. Burada AYRICA bir bond-bekleme eklemek,
     * hiç bonding GEREKTİRMEYEN (insecure-only) adaptörlerde asla gelmeyecek bir BOND_BONDED
     * sinyalini 90s boşuna beklemek anlamına gelirdi — gerçek regresyon riski. Bu dalın gerçek
     * düzeltmesi JS tarafındaki connect-timeout uzatmasıdır (bkz. obdService.ts PAIRING_GRACE).
     */
    public static WaitStrategy waitStrategyFor(Decision d) {
        switch (d) {
            case PAIR_WITH_PIN: return WaitStrategy.START_AND_WAIT;
            case WAIT_BONDING:  return WaitStrategy.WAIT_ONLY;
            default:             return WaitStrategy.NONE; // ALREADY_BONDED, CONNECT_WITHOUT_PAIRING
        }
    }

    /** {@link #waitStrategyFor(Decision)} dönüş tipi — native eylemi. */
    public enum WaitStrategy {
        /** Bekleme YOK — ya zaten bonded ya da bekleme native açısından anlamsız/riskli. */
        NONE,
        /** createBond()+setPin() BAŞLAT, SONRA bounded bekle (yalnız PAIR_WITH_PIN). */
        START_AND_WAIT,
        /** createBond() ÇAĞIRMA — devam eden bir eşleşmeyi (varsa) yalnız bounded bekle. */
        WAIT_ONLY
    }
}
