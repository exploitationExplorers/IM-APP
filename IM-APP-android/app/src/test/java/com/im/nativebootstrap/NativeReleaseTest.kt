package com.im.nativebootstrap

import com.im.nativebootstrap.business.NativeRelease
import com.im.nativebootstrap.business.obj
import org.junit.Assert.*
import org.junit.Test

class NativeReleaseTest {
    @Test fun legacyWgtAndDowngradeCannotBePresentedAsNativeUpdates() {
        val base=obj("hasUpdate" to true,"updateType" to "wgt","versionCode" to 20,"downloadUrl" to "https://download.invalid/file.wgt")
        assertThrows(IllegalArgumentException::class.java){NativeRelease.parse(base,4)}
        base.addProperty("updateType","native");base.addProperty("versionCode",4)
        assertThrows(IllegalArgumentException::class.java){NativeRelease.parse(base,4)}
        base.addProperty("versionCode",5)
        assertEquals(5L,NativeRelease.parse(base,4)!!.versionCode)
        base.addProperty("hasUpdate",false)
        assertNull(NativeRelease.parse(base,4))
    }
    @Test fun updaterRejectsInsecureOrCredentialBearingDownloads() {
        val base=obj("hasUpdate" to true,"updateType" to "native","versionCode" to 5)
        for(url in listOf("http://download.invalid/app.apk","file:///tmp/app.apk","https://account:secret@download.invalid/app.apk","https://download.invalid/app.apk#fragment")) {
            base.addProperty("downloadUrl",url)
            assertThrows(IllegalArgumentException::class.java){NativeRelease.parse(base,4)}
        }
        base.addProperty("downloadUrl","https://download.invalid/app.apk?signature=fixture")
        assertEquals("https://download.invalid/app.apk?signature=fixture",NativeRelease.parse(base,4)!!.url)
    }
}
