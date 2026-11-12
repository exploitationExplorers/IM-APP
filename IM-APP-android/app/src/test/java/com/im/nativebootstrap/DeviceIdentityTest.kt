package com.im.nativebootstrap

import org.junit.Assert.*
import org.junit.Test

class DeviceIdentityTest {
    @Test fun savedInstallationIdSurvivesRecreatingCaller() {
        var stored: String? = null
        var writes = 0
        val first = DeviceIdentity.getOrCreate({ stored }, { stored = it; writes += 1; true }, { "synthetic-stable-device" })
        val afterRestart = DeviceIdentity.getOrCreate({ stored }, { error("Existing ID must not be rewritten") }, { error("Existing ID must not be replaced") })
        assertEquals("synthetic-stable-device", first)
        assertEquals(first, afterRestart)
        assertEquals(1, writes)
    }
    @Test fun failedPersistenceDoesNotReturnUnstableId() {
        assertThrows(IllegalStateException::class.java) { DeviceIdentity.getOrCreate({ null }, { false }, { "synthetic-device" }) }
    }
}
