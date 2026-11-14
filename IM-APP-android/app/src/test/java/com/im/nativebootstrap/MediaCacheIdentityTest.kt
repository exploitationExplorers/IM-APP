package com.im.nativebootstrap

import com.im.nativebootstrap.media.MediaCacheIdentity
import org.junit.Assert.*
import org.junit.Test

class MediaCacheIdentityTest {
    private val base = "https://service.invalid/api/v1"
    private val scope = MediaCacheIdentity.scope(base, "account-a")
    private fun key(url: String) = MediaCacheIdentity.key(url, scope, base)
    @Test fun controlledObjectSurvivesSignatureRotationWithoutMutatingDownloadUrl() {
        val a = "https://oss-chat-test.xn--jprz53bj9s.com/oss-test/chat/photo.jpg?OSSAccessKeyId=a&Signature=one&Expires=1&x-oss-process=small"
        assertEquals(key(a), key(a.replace("one", "two").replace("Expires=1", "Expires=2")))
        assertNotEquals(key(a), key(a.replace("small", "large")))
        assertNotEquals(key(a), key(a.replace("photo.jpg", "new.jpg")))
    }
    @Test fun unknownStorageAndCapabilityTokensRemainDifferent() {
        val unknown = "https://other.invalid/oss-test/chat/a.jpg?Signature=one&Expires=1"
        assertNotEquals(key(unknown), key(unknown.replace("one", "two")))
        val capability = "https://service.invalid/api/v1/public/oss-media?key=a.jpg&token=one&variant=list"
        assertNotEquals(key(capability), key(capability.replace("one", "two")))
        assertNotEquals(key(unknown), key(unknown.replace("other.invalid", "oss-chat-test.xn--jprz53bj9s.com.evil.invalid")))
    }
    @Test fun objectVariantsVersionsEscapedPathsAndScopesDoNotCollide() {
        val url = "https://service.invalid/object/a%2Fb.jpg?width=360&version=1"
        assertEquals(key(url), key("https://service.invalid/object/a%2Fb.jpg?version=1&width=360"))
        assertNotEquals(key("https://service.invalid/object/a.jpg?width=360&width=960"),key("https://service.invalid/object/a.jpg?width=960&width=360"))
        for (other in listOf(url.replace("360", "960"), url.replace("version=1", "version=2"), url.replace("a%2Fb", "a/b"))) assertNotEquals(key(url), key(other))
        assertNotEquals(key(url), MediaCacheIdentity.key(url, MediaCacheIdentity.scope(base, "account-b"), base))
        assertNotEquals(key(url), MediaCacheIdentity.key(url, MediaCacheIdentity.scope("https://test.invalid/api/v1", "account-a"), base))
    }
}
