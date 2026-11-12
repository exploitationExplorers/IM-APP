package com.im.nativebootstrap

import com.im.nativebootstrap.data.*
import com.google.gson.JsonParser
import org.junit.Assert.*
import org.junit.Test

class NativeAPITest {
    private fun fixture(name: String): String = javaClass.classLoader!!.getResourceAsStream(name)!!.bufferedReader().use { it.readText() }
    private fun response(name: String) = APIResponse(200, fixture(name))

    @Test fun passwordAndImIdentityRemainSeparate() {
        val requests = mutableListOf<APIRequest>()
        val api = NativeAPI("https://staging.example.invalid/api/v1/", HTTPTransport { request ->
            requests += request
            response(if (request.url.endsWith("/im/token")) "im-token-success.json" else "auth-success.json")
        })
        val auth = api.passwordLogin("+86", "13000000000", "synthetic-test-password", "native-fixture-device")
        val im = api.imToken(auth.tokens.accessToken)
        assertNotEquals(auth.businessUserId, im.imUserId)
        assertEquals("https://staging.example.invalid/api/v1/auth/login", requests[0].url)
        assertEquals(JsonParser.parseString(fixture("password-login-request.json")), JsonParser.parseString(requests[0].body))
        assertEquals("application/json", requests[0].headers["Content-Type"])
        assertFalse(requests[0].headers.containsKey("Authorization"))
        assertEquals("Bearer synthetic-access-token", requests[1].headers["Authorization"])
        assertEquals(2, JsonParser.parseString(requests[1].body).asJsonObject["platformId"].asInt)
        assertFalse(auth.tokens.toString().contains("synthetic-access-token"))
    }
    @Test fun allRemainingContractRoutesUseJsonBodies() {
        val requests = mutableListOf<APIRequest>()
        val api = NativeAPI("https://staging.example.invalid", HTTPTransport { req ->
            requests += req
            response(when {
                req.url.endsWith("/sms/send") -> "sms-success.json"
                req.url.endsWith("/token/refresh") -> "refresh-success.json"
                else -> "auth-success.json"
            })
        })
        api.smsLogin("+86", "13000000000", "123456", "device")
        assertEquals("/api/v1/auth/login/sms", java.net.URI(requests.last().url).path)
        val receipt = api.sendSms("+86", "13000000000", "device")
        assertEquals(60, receipt.retryAfterSec)
        assertEquals("login", JsonParser.parseString(requests.last().body).asJsonObject["scene"].asString)
        assertEquals("synthetic-refreshed-access", api.refreshToken("synthetic-refresh-token", "device").accessToken)
        assertEquals("/api/v1/auth/token/refresh", java.net.URI(requests.last().url).path)
    }
    @Test fun rejectsHttpAndBusinessFailuresAndNullData() {
        for (response in listOf(APIResponse(401, fixture("api-error.json")), response("api-error.json"), APIResponse(200, """{"code":0,"data":null}"""), APIResponse(200, "invalid-json"))) {
            val api = NativeAPI("https://staging.example.invalid", HTTPTransport { response })
            assertThrows(APIException::class.java) { api.passwordLogin("+86", "1", "x", "device") }
        }
    }
    @Test fun endpointMustBeExplicitHttpsWithoutSecretsOrQuery() {
        for (url in listOf("", "http://staging.example.invalid", "https://user:secret@staging.example.invalid", "https://staging.example.invalid?token=x", "https://staging.example.invalid/other")) {
            assertThrows(IllegalArgumentException::class.java) { NativeAPI(url, HTTPTransport { error("Must not connect") }) }
        }
    }
    @Test fun imEndpointsRejectCredentialsAndMissingHost() {
        for (url in listOf("https://name:secret@im.example.invalid", "https:///missing-host", "https://im.example.invalid?secret=x")) {
            val source = fixture("im-token-success.json").replace("https://im.example.invalid", url)
            val api = NativeAPI("https://staging.example.invalid", HTTPTransport { APIResponse(200, source) })
            assertThrows(APIException::class.java) { api.imToken("synthetic-token") }
        }
    }
    @Test fun credentialsRequirePositiveIntegerExpiration() {
        for (bad in listOf("0", "-1", "1.5")) {
            val authSource = fixture("auth-success.json").replace("\"expiresIn\":86400", "\"expiresIn\":$bad")
            val authAPI = NativeAPI("https://staging.example.invalid", HTTPTransport { APIResponse(200, authSource) })
            assertThrows(APIException::class.java) { authAPI.passwordLogin("+86", "1", "x", "device") }
            val imSource = fixture("im-token-success.json").replace("\"expireSec\":7200", "\"expireSec\":$bad")
            val imAPI = NativeAPI("https://staging.example.invalid", HTTPTransport { APIResponse(200, imSource) })
            assertThrows(APIException::class.java) { imAPI.imToken("synthetic-token") }
        }
    }
    @Test fun mismatchedImPlatformIsRejected() {
        val api = NativeAPI("https://staging.example.invalid", HTTPTransport { APIResponse(200, fixture("im-token-success.json").replace("\"platform\":2", "\"platform\":1")) })
        assertThrows(APIException::class.java) { api.imToken("synthetic-token") }
    }

    @Test fun defaultHttpsOriginAndProfileGetMatchExistingBackend() {
        val requests = mutableListOf<APIRequest>()
        val api = NativeAPI(transport = HTTPTransport { request ->
            requests += request
            response(if (request.url.endsWith("/me")) "profile-success.json" else "auth-success.json")
        })
        val auth = api.passwordLogin("+86", "13000000000", "synthetic-password", "device")
        val profile = api.profile(auth.tokens.accessToken)
        assertEquals("https://www.xn--jprz53bj9s.com/api/v1/auth/login", requests[0].url)
        assertEquals("POST", requests[0].method)
        assertEquals("https://www.xn--jprz53bj9s.com/api/v1/me", requests[1].url)
        assertEquals("GET", requests[1].method)
        assertEquals("", requests[1].body)
        assertEquals("Bearer synthetic-access-token", requests[1].headers["Authorization"])
        assertFalse(requests[1].headers.containsKey("Content-Type"))
        assertEquals(auth.businessUserId, profile.businessUserId)
        assertEquals("sampleUser", profile.publicId)
        assertEquals("130****0000", profile.phoneMasked)
        assertEquals("样例用户", profile.nickname)
    }
    @Test fun http401PreservesShortBusinessMessageWithoutControls() {
        val api = NativeAPI(transport = HTTPTransport { APIResponse(401, """{"code":40101,"message":"账号或密码错误\n请重试\u0000","data":null}""") })
        val error = assertThrows(APIException::class.java) { api.passwordLogin("+86", "13000000000", "synthetic-secret", "device") }
        assertEquals("账号或密码错误 请重试", error.message)
        assertFalse(error.message!!.any { it.isISOControl() })
    }
    @Test fun businessErrorsLimitLengthAndRedactSubmittedSecret() {
        val body = com.google.gson.JsonObject().apply {
            addProperty("code", 40001)
            addProperty("message", "synthetic-private-password " + "提示".repeat(200))
        }.toString()
        for (status in listOf(200, 400)) {
            val api = NativeAPI(transport = HTTPTransport { APIResponse(status, body) })
            val error = assertThrows(APIException::class.java) { api.passwordLogin("+86", "13000000000", "synthetic-private-password", "device") }
            assertFalse(error.message!!.contains("synthetic-private-password"))
            assertTrue(error.message!!.length <= 160)
        }
    }
    @Test fun errorsNeverEchoRawBodyOrCredentialLikeMessages() {
        val messages = listOf("Bearer synthetic-credential", "accessToken=synthetic-credential", "{\"token\":\"synthetic-credential\"}", "<html>synthetic-credential</html>")
        for (message in messages) {
            val body = com.google.gson.JsonObject().apply { addProperty("message", message); addProperty("token", "raw-response-token") }.toString()
            val api = NativeAPI(transport = HTTPTransport { APIResponse(401, body) })
            val error = assertThrows(APIException::class.java) { api.profile("submitted-access-token") }
            assertEquals("请求失败（HTTP 401）", error.message)
            assertFalse(error.toString().contains("credential"))
            assertFalse(error.toString().contains("raw-response-token"))
        }
    }
}
