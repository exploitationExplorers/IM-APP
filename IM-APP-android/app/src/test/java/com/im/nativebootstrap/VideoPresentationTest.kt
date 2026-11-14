package com.im.nativebootstrap

import com.im.nativebootstrap.media.*
import org.junit.Assert.*
import org.junit.Test

class VideoPresentationTest {
    @Test fun portraitAndLandscapeFitUseOneScaleAndKeepAspectRatio() {
        val portrait=VideoBubbleGeometry.fit(1080,1920)
        assertEquals(202.5f,portrait.width,.001f);assertEquals(360f,portrait.height,.001f)
        val landscape=VideoBubbleGeometry.fit(1920,1080)
        assertEquals(280f,landscape.width,.001f);assertEquals(157.5f,landscape.height,.001f)
        val tall=VideoBubbleGeometry.fit(300,3000)
        assertEquals(36f,tall.width,.001f);assertEquals(360f,tall.height,.001f)
        assertEquals(VideoBubbleSize(280f,210f),VideoBubbleGeometry.fit(0,0))
        assertEquals("00:09",VideoBubbleGeometry.duration(9));assertEquals("01:05",VideoBubbleGeometry.duration(65))
    }
    @Test fun nativeEmptyVideoElementKeepsLegacyStoredContentAndDimensionVariants() {
        val stored="""{"ContentType":104,"VideoElem":{},"content":{"VideoElem":{"VideoURL":"https://cdn.invalid/video.mp4","SnapshotURL":"https://cdn.invalid/poster.jpg","VideoWidth":720,"VideoHeight":1280,"Duration":5}}}"""
        val parsed=MessageContents.parse(stored)
        assertEquals("https://cdn.invalid/video.mp4",parsed.url);assertEquals(720,parsed.width);assertEquals(1280,parsed.height)
        val simple=MessageContents.parse("""{"contentType":104,"content":{"url":"https://cdn.invalid/a.mp4","snapshot_url":"https://cdn.invalid/a.jpg","width":1080,"height":1920}}""")
        assertEquals("https://cdn.invalid/a.mp4",simple.url);assertEquals("https://cdn.invalid/a.jpg",simple.thumbnail);assertEquals(1080,simple.width)
        assertEquals("",MessageContents.parse("""{"contentType":104,"VideoElem":{"VideoPath":"/storage/another-user.mp4"}}""").url)
    }
    @Test fun expiredKnownChatVideoUsesStableFileWithoutImageTransformsAndUnknownSignaturesStayIntact() {
        val base="https://service.invalid/api/v1"
        assertEquals("https://service.invalid/object/video/a%20b.mp4",MediaURLs.playback("https://oss-chat-test.xn--jprz53bj9s.com/oss-test/chat/video/a%20b.mp4?x-oss-signature=expired",base))
        val unknown="https://outside.invalid/a%2fb.mp4?x-oss-signature=A%2Fb%2B&token=keep"
        assertEquals(unknown,MediaURLs.playback(unknown,base))
        val capability="https://service.invalid/api/v1/public/oss-media?key=video%2Fa.mp4&token=keep"
        assertEquals(capability,MediaURLs.playback(capability,base))
        assertEquals("",MediaURLs.playback("file:///data/other.mp4",base))
    }
}
