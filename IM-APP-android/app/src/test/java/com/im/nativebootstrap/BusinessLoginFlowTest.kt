package com.im.nativebootstrap

import com.im.nativebootstrap.core.BusinessLoginFlow
import com.im.nativebootstrap.core.BusinessSession
import com.im.nativebootstrap.data.*
import org.junit.Assert.*
import org.junit.Test

class BusinessLoginFlowTest {
    private fun fixture(name: String): String = javaClass.classLoader!!.getResourceAsStream(name)!!.bufferedReader().use { it.readText() }
    private fun auth() = APIResponse(200, fixture("auth-success.json"))
    private fun profile() = APIResponse(200, fixture("profile-success.json"))
    private fun login(session: BusinessSession, api: NativeAPI) = BusinessLoginFlow(session).login(session.beginLogin(), api, "+86", "13000000000", "synthetic-password", "synthetic-device", true)

    @Test fun loginRequestsOnlyAuthAndMeAndUsesLoadedRealProfile() {
        val session = BusinessSession()
        val requests = mutableListOf<APIRequest>()
        val api = NativeAPI(transport = HTTPTransport { request ->
            requests += request
            when {
                request.url.endsWith("/auth/login") -> auth()
                request.url.endsWith("/me") -> APIResponse(200, fixture("profile-success.json").replace("样例用户", "资料更新后的用户"))
                else -> error("Unexpected endpoint: IM token must not be requested")
            }
        })
        val result = login(session, api)!!
        assertEquals(listOf("POST", "GET"), requests.map { it.method })
        assertEquals(2, requests.size)
        assertEquals("资料更新后的用户", result.profile.nickname)
        assertEquals("sampleUser", result.profile.publicId)
        assertNull(result.profileWarning)
        assertTrue(session.hasCredentials())
        assertEquals("business-fixture-user", session.currentProfile()!!.businessUserId)
        session.logout()
        assertFalse(session.hasCredentials())
        assertNull(session.currentProfile())
    }
    @Test fun failedProfileKeepsSuccessfulAuthAndItsRealUser() {
        for (failure in listOf(APIResponse(500, "unavailable"), APIResponse(200, "{\"code\":0,\"data\":{}}"))) {
            val session = BusinessSession()
            val api = NativeAPI(transport = HTTPTransport { if (it.url.endsWith("/auth/login")) auth() else failure })
            val result = login(session, api)!!
            assertEquals("business-fixture-user", result.profile.businessUserId)
            assertEquals("样例用户", result.profile.nickname)
            assertEquals("sampleUser", result.profile.publicId)
            assertNotNull(result.profileWarning)
            assertTrue(session.hasCredentials())
        }
    }
    @Test fun mismatchedProfileNeverBindsAnotherUsersData() {
        val session = BusinessSession()
        val api = NativeAPI(transport = HTTPTransport {
            if (it.url.endsWith("/auth/login")) auth() else APIResponse(200, fixture("profile-success.json").replace("business-fixture-user", "other-business-account").replace("样例用户", "其他账号"))
        })
        val result = login(session, api)!!
        assertEquals("business-fixture-user", result.profile.businessUserId)
        assertEquals("样例用户", result.profile.nickname)
        assertNotNull(result.profileWarning)
        assertEquals("business-fixture-user", session.currentProfile()!!.businessUserId)
    }
    @Test fun logoutDuringAuthRejectsLateTokenAndSkipsMe() {
        val session = BusinessSession()
        var requests = 0
        val api = NativeAPI(transport = HTTPTransport {
            requests += 1
            session.logout()
            auth()
        })
        assertNull(login(session, api))
        assertEquals(1, requests)
        assertFalse(session.hasCredentials())
        assertNull(session.currentProfile())
    }
    @Test fun logoutDuringProfileRejectsLateAccountCallback() {
        val session = BusinessSession()
        val api = NativeAPI(transport = HTTPTransport {
            if (it.url.endsWith("/auth/login")) auth() else { session.logout(); profile() }
        })
        assertNull(login(session, api))
        assertFalse(session.hasCredentials())
        assertNull(session.currentProfile())
    }
    @Test fun olderLoginCannotOverwriteNewAccountAfterProfileReturns() {
        val session = BusinessSession()
        val newAPI = NativeAPI(transport = HTTPTransport {
            val source = if (it.url.endsWith("/auth/login")) fixture("auth-success.json") else fixture("profile-success.json")
            APIResponse(200, source.replace("business-fixture-user", "second-business-account").replace("样例用户", "第二个账号"))
        })
        val oldAPI = NativeAPI(transport = HTTPTransport {
            if (it.url.endsWith("/auth/login")) auth() else {
                assertNotNull(login(session, newAPI))
                profile()
            }
        })
        assertNull(login(session, oldAPI))
        assertEquals("second-business-account", session.currentProfile()!!.businessUserId)
        assertEquals("第二个账号", session.currentProfile()!!.nickname)
        assertTrue(session.hasCredentials())
    }
    @Test fun failedNewLoginCannotKeepOldAccountCredentials() {
        val session = BusinessSession()
        val successAPI = NativeAPI(transport = HTTPTransport { if (it.url.endsWith("/auth/login")) auth() else profile() })
        assertNotNull(login(session, successAPI))
        val failedAPI = NativeAPI(transport = HTTPTransport { APIResponse(401, "{\"code\":40101,\"message\":\"账号或密码错误\"}") })
        assertThrows(APIException::class.java) { login(session, failedAPI) }
        assertFalse(session.hasCredentials())
        assertNull(session.currentProfile())
    }
}
