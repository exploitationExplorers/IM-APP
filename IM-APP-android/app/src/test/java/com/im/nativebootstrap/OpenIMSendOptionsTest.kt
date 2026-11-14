package com.im.nativebootstrap

import com.google.gson.JsonParser
import com.im.nativebootstrap.chat.OpenIMSendOptions
import io.openim.android.sdk.utils.JsonUtil
import org.junit.Assert.*
import org.junit.Test

class OpenIMSendOptionsTest {
    @Test fun sendPushIsARealJsonObjectForTheInstalledSdkInsteadOfEmptyNullEncoding() {
        assertEquals("",JsonUtil.toString(null))
        val push=JsonParser.parseString(JsonUtil.toString(OpenIMSendOptions.push())).asJsonObject
        assertEquals("你收到一条新消息",push["title"].asString)
        assertEquals("+1",push["iOSPushSound"].asString)
        assertTrue(push["iOSBadgeCount"].asBoolean)
        assertTrue(push.has("desc")&&push.has("ex"))
    }
    @Test fun onlyUploadedMediaSkipsSdkOssUpload() {
        listOf(102,103,104,105).forEach { assertTrue(OpenIMSendOptions.uploaded(it)) }
        listOf(101,106,108,110,114).forEach { assertFalse(OpenIMSendOptions.uploaded(it)) }
    }
}
