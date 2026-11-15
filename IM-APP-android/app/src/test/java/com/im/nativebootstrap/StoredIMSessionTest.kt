package com.im.nativebootstrap

import com.google.gson.JsonParser
import com.im.nativebootstrap.core.StoredIMSession
import com.im.nativebootstrap.data.IMCredentials
import org.junit.Assert.*
import org.junit.Test

class StoredIMSessionTest {
    private val base="https://api.invalid/api/v1"
    private val credentials=IMCredentials("im-owner","synthetic-local-token",2,3600,"https://im.invalid","wss://im.invalid/ws")

    @Test fun persistedSDKCredentialsSurviveRestartWithoutExtendingExpiry() {
        val raw=StoredIMSession.encode(base,"owner",credentials,1_000_000)
        val first=StoredIMSession.decode(raw,base,"owner",1_060_000)
        assertEquals("im-owner",first.imUserId)
        assertEquals(credentials.token,first.token)
        assertEquals(3540L,first.expireSec)
        // 过期票据保留供 SDK 本地恢复；不能靠重新保存延长服务端授权。
        assertTrue(StoredIMSession.decode(raw,base,"owner",5_000_000).expireSec<0)
        assertFalse(raw.contains("password"))
    }

    @Test fun anotherAccountOrEnvironmentCannotOpenSavedSDKSession() {
        val raw=StoredIMSession.encode(base,"owner",credentials,1000)
        assertThrows(IllegalArgumentException::class.java){StoredIMSession.decode(raw,base,"other",1000)}
        assertThrows(IllegalArgumentException::class.java){StoredIMSession.decode(raw,"https://other.invalid/api/v1","owner",1000)}
        val changed=JsonParser.parseString(raw).asJsonObject.apply{addProperty("user","other-im")}.toString()
        assertThrows(IllegalArgumentException::class.java){StoredIMSession.decode(changed,base,"owner",1000)}
    }

    @Test fun malformedEndpointsAndExpiryAreRejectedWithoutDeletingTheOriginal() {
        val raw=StoredIMSession.encode(base,"owner",credentials,1000)
        for((key,value) in listOf("api" to "http://im.invalid","ws" to "wss://im.invalid/?token=secret","token" to "")) {
            val changed=JsonParser.parseString(raw).asJsonObject.apply{addProperty(key,value)}.toString()
            assertThrows(IllegalArgumentException::class.java){StoredIMSession.decode(changed,base,"owner",1000)}
        }
        val changed=JsonParser.parseString(raw).asJsonObject.apply{addProperty("expiresAt",1.5)}.toString()
        assertThrows(ArithmeticException::class.java){StoredIMSession.decode(changed,base,"owner",1000)}
        assertEquals(credentials.token,StoredIMSession.decode(raw,base,"owner",1000).token)
    }
}
