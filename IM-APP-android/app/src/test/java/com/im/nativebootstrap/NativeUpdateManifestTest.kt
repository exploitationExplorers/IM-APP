package com.im.nativebootstrap

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.im.nativebootstrap.business.NativeRelease
import com.im.nativebootstrap.business.obj
import com.im.nativebootstrap.update.NativeUpdateManifest
import org.junit.Assert.*
import org.junit.Test

class NativeUpdateManifestTest {
    private val signer="b".repeat(64)
    private val application="com.im.nativebootstrap.staging"
    private fun manifest():JsonObject = obj(
        "schemaVersion" to 1,"platform" to "android","channel" to "native-staging",
        "applicationId" to application,"releaseFamily" to NativeRelease.FAMILY,
        "versionCode" to 8,"versionName" to "0.3.4-media","downloadUrl" to "https://downloads.example.test/native/app.apk?signature=retained",
        "sha256" to "a".repeat(64),"sizeBytes" to 1024,"changelog" to "修复图片预览"
    ).apply{add("certificateSha256",JsonArray().apply{add(signer)})}

    @Test fun independentNativeFeedRetainsSignedURLAndDigest() {
        val parsed=NativeUpdateManifest.parse(manifest(),application,setOf(signer),7)!!
        assertEquals(8L,parsed.versionCode)
        assertEquals("a".repeat(64),parsed.sha256)
        assertEquals(1024L,parsed.sizeBytes)
        assertTrue(parsed.url.endsWith("?signature=retained"))
        assertNull(NativeUpdateManifest.parse(manifest(),application,setOf(signer),8))
    }
    @Test fun wrongIdentityOldShellChannelAndDifferentSigningKeyAreRejectedBeforePrompt() {
        for((key,value) in listOf("applicationId" to "io.dcloud.old","releaseFamily" to "uni-app","channel" to "canary","platform" to "ios")) {
            val manifest=manifest().apply{addProperty(key,value)}
            assertThrows(IllegalArgumentException::class.java){NativeUpdateManifest.parse(manifest,application,setOf(signer),7)}
        }
        assertThrows(IllegalArgumentException::class.java){NativeUpdateManifest.parse(manifest(),application,setOf("c".repeat(64)),7)}
    }
    @Test fun partialOrUnboundedArtifactMetadataIsRejected() {
        for(size in listOf(0L,-1L,NativeRelease.MAX_BYTES+1)) {
            val value=manifest().apply{addProperty("sizeBytes",size)}
            assertThrows(IllegalArgumentException::class.java){NativeUpdateManifest.parse(value,application,setOf(signer),7)}
        }
        val value=manifest().apply{addProperty("sha256","invalid")}
        assertThrows(IllegalArgumentException::class.java){NativeUpdateManifest.parse(value,application,setOf(signer),7)}
        for(url in listOf("http://downloads.example.test/a.apk","https://name:secret@downloads.example.test/a.apk","https://downloads.example.test/a.apk#x")) {
            value.addProperty("sha256","a".repeat(64));value.addProperty("downloadUrl",url)
            assertThrows(IllegalArgumentException::class.java){NativeUpdateManifest.parse(value,application,setOf(signer),7)}
        }
    }
}
