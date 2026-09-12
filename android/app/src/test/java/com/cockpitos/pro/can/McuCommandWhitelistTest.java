package com.cockpitos.pro.can;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

/**
 * McuCommandWhitelistTest — P0 SAHTE ACK onarımının NATIVE tarafındaki ayağı.
 *
 * KÖK (denetim 2026-07-28): `CarLauncherPlugin.sendMcuCommand` başarısız olduğunda
 * bile `call.resolve({sent:false})` yapıyor, JS köprüsü de `sent` bayrağını hiç
 * okumadan `status:'completed'` üretiyordu → MCU bağlı değilken kullanıcıya
 * "Kapılar kilitlendi" deniyordu.
 *
 * `sendMcuCommand` iki AYRI başarısızlık nedeni üretir ve ikisi de JS'e taşınır:
 *   · packet == null            → "whitelist_rejected"
 *   · canBusManager false       → "mcu_send_failed"
 *
 * Bu test BİRİNCİ nedenin kaynağını — whitelist kapısını — saf olarak kilitler
 * (`McuCommandFactory` Android'e HİÇ bağımlı değildir: dosyada tek `import` yok).
 * `canBusManager` yolu Android/donanım bağımlı olduğu için burada taklit
 * EDİLMEZ; onun sözleşmesi JS tarafında `nativeAckFailClosed.test.ts` ile
 * kilitlenmiştir (uydurma bir sahte-donanım katmanı kurulmadı).
 */
public class McuCommandWhitelistTest {

    /** Whitelist'te OLMAYAN komut → null paket → plugin "whitelist_rejected" döner. */
    @Test
    public void unknownCommandProducesNullPacket() {
        // 0x7F bilinçli olarak ALLOWED_COMMANDS dışındadır.
        assertNull("whitelist dışı komut paket ÜRETMEMELİ", McuCommandFactory.buildPacket((byte) 0x7F, new byte[0]));
        assertFalse(McuCommandFactory.isAllowed((byte) 0x7F));
        assertNull(McuCommandFactory.buildPacket((byte) 0xFF, new byte[0]));
        assertNull(McuCommandFactory.buildPacket((byte) 0x01, new byte[0]));
    }

    /** Altı donanım komutunun TAMAMI geçerli paket üretmeli (aksi hâlde hepsi ölü). */
    @Test
    public void allSixHardwareCommandsProducePackets() {
        assertNotNull("lockDoors",    McuCommandFactory.lockDoors());
        assertNotNull("unlockDoors",  McuCommandFactory.unlockDoors());
        assertNotNull("honkHorn",     McuCommandFactory.honkHorn());
        assertNotNull("flashLights",  McuCommandFactory.flashLights());
        assertNotNull("alarmOn",      McuCommandFactory.alarmOn());
        assertNotNull("alarmOff",     McuCommandFactory.alarmOff());
    }

    /** Whitelist kapısı gerçekten ETKİLİ: izinli/izinsiz ayrımı ölü kod değil. */
    @Test
    public void whitelistGateIsEffective() {
        assertTrue(McuCommandFactory.isAllowed(McuCommandFactory.CMD_LOCK_DOORS));
        assertTrue(McuCommandFactory.isAllowed(McuCommandFactory.CMD_UNLOCK_DOORS));
        assertTrue(McuCommandFactory.isAllowed(McuCommandFactory.CMD_HONK_HORN));
        assertTrue(McuCommandFactory.isAllowed(McuCommandFactory.CMD_FLASH_LIGHTS));
        assertTrue(McuCommandFactory.isAllowed(McuCommandFactory.CMD_ALARM_ON));
        assertTrue(McuCommandFactory.isAllowed(McuCommandFactory.CMD_ALARM_OFF));
        // Kapı kaldırılırsa bu satır düşer (yanlışlama).
        assertFalse(McuCommandFactory.isAllowed((byte) 0x7E));
    }

    /** Paket bütünlüğü: komut baytı ve XOR checksum yerinde (bozuk paket gönderilmez). */
    @Test
    public void packetCarriesCommandAndChecksum() {
        byte[] p = McuCommandFactory.lockDoors();
        assertNotNull(p);
        assertEquals("veri baytı yok → 5 baytlık çerçeve", 5, p.length);
        assertEquals(McuCommandFactory.CMD_LOCK_DOORS, p[1]);
        assertEquals("veri uzunluğu 0", 0, p[2]);
        // CRC = CMD ^ DATA_LEN
        assertEquals((byte) (McuCommandFactory.CMD_LOCK_DOORS ^ 0), p[3]);
    }
}
