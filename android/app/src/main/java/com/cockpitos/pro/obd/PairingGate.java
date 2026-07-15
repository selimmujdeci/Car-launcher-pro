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
}
