package com.im.nativebootstrap

import com.im.nativebootstrap.business.*
import org.junit.Assert.*
import org.junit.Test

class NativeDiagnosticsTest {
    @Test fun diagnosticsExposeHostsWithoutCredentialsOrSignatures() {
        assertEquals("media.invalid:443",NativeDiagnostics.host("https://media.invalid:443/private/file?accessToken=secret"))
        assertEquals("https://api.invalid",NativeDiagnostics.origin("https://api.invalid/api/v1"))
        assertFalse(NativeDiagnostics.mask("chat-account-123456").contains("account"))
        assertEquals("（已隐藏）",NativeDiagnostics.mask("123"))
        val urls=NativeDiagnostics.targets(DiagnosticEndpoints("https://api.invalid/api/v1","https://im.invalid","wss://im.invalid/ws"))
        assertEquals("https://api.invalid/health",urls.single{it.first=="API"}.second)
        assertEquals("wss://im.invalid/ws",urls.single{it.first=="WS"}.second)
        assertThrows(IllegalArgumentException::class.java){NativeDiagnostics.origin("http://api.invalid/api/v1")}
        assertThrows(IllegalArgumentException::class.java){NativeDiagnostics.origin("https://user:secret@api.invalid/api/v1")}
    }
    @Test fun explicitAnnouncementPermissionOverridesRoleFallback() {
        assertTrue(canEditAnnouncement(obj("myRole" to "admin")))
        assertFalse(canEditAnnouncement(obj("myRole" to "member")))
        assertFalse(canEditAnnouncement(obj("myRole" to "owner","permissions" to obj("canEditAnnouncement" to false))))
        assertTrue(canEditAnnouncement(obj("myRole" to "member","permissions" to obj("canEditAnnouncement" to true))))
    }
}
