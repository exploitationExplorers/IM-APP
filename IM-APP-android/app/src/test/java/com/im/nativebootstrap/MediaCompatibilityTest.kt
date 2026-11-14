package com.im.nativebootstrap

import com.google.gson.JsonParser
import com.google.gson.Gson
import com.im.nativebootstrap.chat.ForwardSnapshots
import com.im.nativebootstrap.chat.businessUserId
import com.im.nativebootstrap.media.*
import org.junit.Assert.*
import org.junit.Test
import io.openim.android.sdk.models.Message

class MediaCompatibilityTest {
    @Test fun legacyContentSurvivesAnEmptySdkElementAndPreservesRemoteFallbacks() {
        val raw="""{"contentType":102,"pictureElem":{},"content":"{\"SourcePicture\":{\"URL\":\"https://c.invalid/original.jpg\"},\"SnapshotPicture\":{\"URL\":\"https://c.invalid/expired.jpg\"},\"BigPicture\":{\"URL\":\"https://c.invalid/big.jpg\"}}"}"""
        val parsed=MessageContents.parse(raw)
        assertEquals("https://c.invalid/original.jpg",parsed.url)
        assertEquals(listOf("https://c.invalid/expired.jpg","https://c.invalid/big.jpg","https://c.invalid/original.jpg"),parsed.imageAlternatives)
        assertEquals("https://c.invalid/original.jpg",ForwardSnapshots.freeze(raw).getAsJsonObject("content").getAsJsonObject("sourcePicture")["url"].asString)
    }
    @Test fun quoteLocationKeepsTheOriginalClientMessageIdForBothBridgeCases() {
        val camel="""{"contentType":114,"quoteElem":{"text":"回复正文","quoteMessage":{"clientMsgID":"original-client-id","contentType":101,"senderNickname":"成员","textElem":{"content":"原始文字"}}}}"""
        val pascal="""{"ContentType":106,"AtTextElem":{"Text":"@成员 回复正文","QuoteMessage":{"ClientMsgID":"original-client-id","ContentType":101,"SenderNickname":"成员","TextElem":{"Content":"原始文字"}}}}"""
        assertEquals("original-client-id",MessageContents.parse(camel).quoteId)
        assertEquals("成员：原始文字",MessageContents.parse(camel).quoteText)
        assertEquals("original-client-id",MessageContents.parse(pascal).quoteId)
        assertEquals("@成员 回复正文",MessageContents.parse(pascal).text)
    }
    @Test fun groupCardsParseLegacyCustomPayloadWithoutTurningUnknownDataIntoActions() {
        val invite="""{"ContentType":110,"CustomElem":{"Data":"{\"BusinessKey\":\"group_invite\",\"Token\":\"token-value\",\"GroupID\":\"business-group\",\"GroupName\":\"交流群\",\"MemberCount\":5,\"GroupAvatar\":\"https://cdn.invalid/group.png\"}"}}"""
        val card=MessageContents.parse(invite).groupCard!!
        assertEquals("business-group",card.groupId);assertEquals("token-value",card.token);assertEquals(5L,card.count)
        val request="""{"contentType":110,"customElem":{"data":{"businessKey":"group_join_request","requestId":"request-1","groupId":"group-1","applicantNickname":"新朋友"}}}"""
        assertEquals("新朋友",MessageContents.parse(request).groupCard!!.applicantName)
        assertNull(MessageContents.parse(invite.replace("group_invite","other_custom")).groupCard)
        assertNull(MessageContents.parse(invite.replace("token-value","")).groupCard)
        assertNull(MessageContents.parse(request.replace("request-1","")).groupCard)
    }
    private val base="https://service.invalid/api/v1"
    @Test fun pictureSupportsPascalCaseAndRejectsSenderLocalPaths() {
        val picture="""{"ContentType":102,"SenderFaceURL":"https://avatar.invalid/a.png","SendID":"user","PictureElem":{"SourcePath":"/data/user/other/private.jpg","SourcePicture":{"Url":"https://cdn.invalid/original.jpg","Width":1200,"Height":1800,"Size":8000},"SnapshotPicture":{"Url":"https://cdn.invalid/thumb.jpg"}}}"""
        val parsed=MessageContents.parse(picture)
        assertEquals(102,parsed.type);assertEquals("https://cdn.invalid/original.jpg",parsed.url)
        assertEquals("https://cdn.invalid/thumb.jpg",parsed.thumbnail)
        assertEquals(1200,parsed.width);assertEquals(1800,parsed.height)
        assertEquals("https://avatar.invalid/a.png",parsed.avatar)
        val noRemote=MessageContents.parse("""{"contentType":102,"pictureElem":{"sourcePath":"/storage/emulated/0/a.jpg"}}""")
        assertEquals("",noRemote.url)
    }
    @Test fun videoVoiceAndFileNormalizeNativeBridgeFields() {
        val video=MessageContents.parse("""{"ContentType":104,"VideoElem":{"VideoURL":"https://c.invalid/v.mp4","SnapshotURL":"https://c.invalid/s.jpg","VideoPath":"/data/local.mp4","Duration":9,"SnapshotWidth":320,"SnapshotHeight":180}}""")
        assertEquals("https://c.invalid/v.mp4",video.url);assertEquals(9L,video.duration);assertEquals(320,video.width)
        val voice=MessageContents.parse("""{"contentType":103,"content":"{\"SourceURL\":\"https://c.invalid/v.m4a\",\"Duration\":3}"}""")
        assertEquals("https://c.invalid/v.m4a",voice.url);assertEquals(3L,voice.duration)
        val file=MessageContents.parse("""{"contentType":105,"fileElem":{"sourceUrl":"https://c.invalid/f.pdf","fileName":"合同.pdf","fileSize":2048}}""")
        assertEquals("合同.pdf",file.fileName);assertEquals(2048L,file.size)
    }
    @Test fun quotedTextDisplaysActualReplyAndOriginalSender() {
        val parsed=MessageContents.parse("""{"contentType":114,"quoteElem":{"text":"收到","quoteMessage":{"contentType":101,"senderNickname":"小王","textElem":{"content":"你好"}}}}""")
        assertEquals("收到",parsed.text);assertEquals("小王：你好",parsed.quoteText)
    }
    @Test fun expiredSignedChatUrlRecoversLogicalObjectWithoutOldSignature() {
        val url="https://oss-chat-test.xn--jprz53bj9s.com/oss-test/chat/a%20b/c.jpg?OSSAccessKeyId=old&Signature=A%2fb%2B&Expires=1"
        assertEquals("https://service.invalid/object/a%20b/c.jpg?type=image&width=360&height=360&format=webp",MediaURLs.image(url,ImageVariant.LIST,base))
        assertTrue(MediaURLs.image(url,ImageVariant.PREVIEW,base).contains("width=960"))
        assertEquals("https://service.invalid/object/a%20b/c.jpg",MediaURLs.image(url,ImageVariant.ORIGINAL,base))
    }
    @Test fun unknownSignedUrlsAndSignedObjectQueriesKeepTheirBytes() {
        val url="https://other.invalid/object/a%2fb.jpg?x-oss-signature=A%2fb%2B&Expires=1&x=two%20words"
        assertEquals(url,MediaURLs.image(url,ImageVariant.LIST,base))
        assertEquals(url,MediaURLs.image(url,ImageVariant.ORIGINAL,base))
        val outside="https://oss-chat-test.xn--jprz53bj9s.com/not-chat/a.jpg?OSSAccessKeyId=old&Signature=x"
        assertEquals(outside,MediaURLs.image(outside,ImageVariant.PREVIEW,base))
        assertEquals(outside,MediaURLs.image(outside,ImageVariant.ORIGINAL,base))
    }
    @Test fun signedVideoIsNotSentToImageProcessingProxy() {
        val url="https://oss-chat-test.xn--jprz53bj9s.com/oss-test/chat/a.mp4?x-oss-signature=sig"
        assertEquals(url,MediaURLs.image(url,ImageVariant.LIST,base))
    }
    @Test fun stableProxyVariantsPreserveAccessTokenAndOriginalRemovesVariant() {
        val url="/api/v1/public/oss-media?key=oss-test%2Fchat%2Fa.jpg&token=A%2fb%2B"
        val list=MediaURLs.image(url,ImageVariant.LIST,base)
        assertTrue(list.startsWith("https://service.invalid/api/v1/public/oss-media?"))
        assertTrue(list.contains("token=A%2fb%2B"));assertTrue(list.contains("variant=list"))
        assertFalse(MediaURLs.image(list,ImageVariant.ORIGINAL,base).contains("variant="))
        assertTrue(MediaURLs.image(url,ImageVariant.AVATAR,base).contains("variant=avatar"))
    }
    @Test fun onlyKnownBucketAndHostReceivePublicImageProcessing() {
        val known="https://oss-chat.whs188.xin/im-app-production/chat/a.jpg"
        assertTrue(MediaURLs.image(known,ImageVariant.LIST,base).contains("x-oss-process="))
        assertEquals(known,MediaURLs.image(known,ImageVariant.AVATAR,base))
        val unknown="https://untrusted.invalid/im-app-production/chat/a.jpg"
        assertEquals(unknown,MediaURLs.image(unknown,ImageVariant.LIST,base))
        val crossBucket="https://oss-business.whs188.xin/im-app-production/chat/a.jpg"
        assertEquals(crossBucket,MediaURLs.image(crossBucket,ImageVariant.LIST,base))
    }
    @Test fun legacyKnownIpUsesHttpsOriginAndOtherCleartextAndSchemesAreRejected() {
        assertEquals("https://service.invalid/object/a.jpg?x=1",MediaURLs.remote("http://8.154.44.197:9000/object/a.jpg?x=1",base))
        assertEquals("",MediaURLs.remote("http://evil.invalid/a.jpg",base))
        assertEquals("",MediaURLs.remote("file:///data/private/a.jpg",base))
        assertEquals("",MediaURLs.remote("content://media/a",base))
        assertEquals("",MediaURLs.remote("https://name:password@cdn.invalid/a",base))
    }
    @Test fun originalRemovesProcessingAndObjectSizingWithoutChangingOtherQueryBytes() {
        val raw="https://service.invalid/object/a.jpg?width=360&height=360&type=image&format=webp&x=a%2fb&x-oss-process=p"
        assertEquals("https://service.invalid/object/a.jpg?x=a%2fb",MediaURLs.image(raw,ImageVariant.ORIGINAL,base))
    }
    @Test fun gifVariantsKeepAnimationInsteadOfRequestingStaticWebpProcessing() {
        val raw="https://oss-business.whs188.xin/im-app-production/business/stickers/a.gif"
        assertEquals(raw,MediaURLs.image(raw,ImageVariant.LIST,base))
        assertEquals(raw,MediaURLs.image(raw,ImageVariant.AVATAR,base))
        val objectUrl="https://service.invalid/object/a.gif?width=360&type=image&format=webp&x=a%2fb"
        assertEquals("https://service.invalid/object/a.gif?x=a%2fb",MediaURLs.image(objectUrl,ImageVariant.PREVIEW,base))
    }
    @Test fun expiredKnownGifSignatureUsesUnprocessedOriginalProxy() {
        val raw="https://oss-chat-test.xn--jprz53bj9s.com/oss-test/chat/sticker.gif?x-oss-signature=old"
        assertEquals("https://service.invalid/object/sticker.gif",MediaURLs.image(raw,ImageVariant.LIST,base))
        assertEquals("https://service.invalid/object/sticker.gif",MediaURLs.image(raw,ImageVariant.ORIGINAL,base))
    }
    @Test fun stableGifProxyKeepsTokenBytesAndRemovesStaticVariant() {
        val raw="/api/v1/public/oss-media?key=oss-test%2Fchat%2Fa.gif&token=A%2fb%2B&variant=list"
        assertEquals("https://service.invalid/api/v1/public/oss-media?key=oss-test%2Fchat%2Fa.gif&token=A%2fb%2B",MediaURLs.image(raw,ImageVariant.LIST,base))
        val unknown="https://untrusted.invalid/a.gif?x-oss-signature=sig&x-oss-process=keep"
        assertEquals(unknown,MediaURLs.image(unknown,ImageVariant.PREVIEW,base))
    }
    @Test fun animatedOriginalIsNotReplacedByAStaticSdkSnapshot() {
        val message="""{"ContentType":102,"PictureElem":{"SourcePicture":{"URL":"https://cdn.invalid/a.gif","Type":"image/gif"},"SnapshotPicture":{"URL":"https://cdn.invalid/static.jpg"}}}"""
        assertEquals("https://cdn.invalid/a.gif",MessageContents.parse(message).thumbnail)
        val typed=message.replace("a.gif","without-extension")
        assertEquals("https://cdn.invalid/without-extension",MessageContents.parse(typed).thumbnail)
        assertTrue(MediaURLs.isGif("https://service.invalid/api/v1/public/oss-media?key=stickers%2Fa.gif&token=x"))
    }
    @Test fun frozenMediaSnapshotHasNoSendingDeviceLocalPath() {
        val raw="""{"ContentType":104,"VideoElem":{"VideoURL":"https://c.invalid/a.mp4","VideoPath":"/data/private.mp4","SnapshotPath":"/data/private.jpg","SnapshotURL":"https://c.invalid/a.jpg","Duration":5}}"""
        val frozen=ForwardSnapshots.freeze(raw)
        assertEquals(104,frozen.get("contentType").asInt)
        assertFalse(frozen.toString().contains("/data/"))
        val content=frozen.getAsJsonObject("content")
        assertEquals("https://c.invalid/a.mp4",content.get("videoUrl").asString)
        val merged=ForwardSnapshots.withSnapshot(raw,frozen)
        assertEquals("https://c.invalid/a.mp4",MessageContents.parse(merged).url)
    }
    @Test fun frozenPicturePreservesEveryRemoteSpecificationAndRequiredTypesThroughRealSdkGson() {
        val raw="""{"clientMsgID":"source-id","ContentType":102,"Content":"old content","PictureElem":{"SourcePath":"/data/private.jpg","SourcePicture":{"UUID":"original-id","URL":"https://cdn.invalid/original.png","Type":"image/png","Width":1800,"Height":1200,"Size":120000},"BigPicture":{"UUID":"big-id","URL":"https://cdn.invalid/big.jpg","Type":"image/jpeg","Width":900,"Height":600,"Size":20000},"SnapshotPicture":{"UUID":"thumb-id","URL":"https://cdn.invalid/thumb.jpg","Type":"image/jpeg","Width":300,"Height":200,"Size":5000}}}"""
        val frozen=ForwardSnapshots.freeze(raw)
        val body=frozen.getAsJsonObject("content")
        val expected=listOf(Triple("sourcePicture","original","image/png"),Triple("bigPicture","big","image/jpeg"),Triple("snapshotPicture","thumb","image/jpeg"))
        expected.forEach { (key,name,type) ->
            assertEquals(type,body.getAsJsonObject(key)["type"].asString)
            assertEquals("$name-id",body.getAsJsonObject(key)["uuid"].asString)
            assertTrue(body.getAsJsonObject(key)["url"].asString.contains("/$name."))
        }
        // 模拟归档服务仅重写地址，不替客户端补齐 Type。
        body.getAsJsonObject("sourcePicture").addProperty("url","https://cdn.invalid/preserved.png")
        val merged=ForwardSnapshots.withSnapshot(raw,frozen)
        assertFalse(merged.contains("/data/"))
        val compatible=JsonParser.parseString(merged).asJsonObject
        assertEquals(compatible["content"],compatible["Content"])
        assertEquals(compatible["pictureElem"],compatible["PictureElem"])
        val gson=Gson()
        val sdk=gson.toJsonTree(gson.fromJson(merged,Message::class.java)).asJsonObject.getAsJsonObject("pictureElem")
        expected.forEach { (key,_,type) -> assertEquals(type,sdk.getAsJsonObject(key)["type"].asString) }
        assertEquals("https://cdn.invalid/preserved.png",sdk.getAsJsonObject("sourcePicture")["url"].asString)
        assertEquals("https://cdn.invalid/thumb.jpg",sdk.getAsJsonObject("snapshotPicture")["url"].asString)
        assertEquals(300,sdk.getAsJsonObject("snapshotPicture")["width"].asInt)
    }
    @Test fun missingPictureTypesAreFilledForAllSdkSpecificationsIncludingLegacyContent() {
        val raw="""{"contentType":102,"pictureElem":{},"content":"{\"SourcePicture\":{\"URL\":\"https://cdn.invalid/original.jpg\"},\"SnapshotPicture\":{\"URL\":\"/data/private.jpg\"}}"}"""
        val snapshot=ForwardSnapshots.freeze(raw)
        val gson=Gson()
        val sdk=gson.toJsonTree(gson.fromJson(ForwardSnapshots.withSnapshot(raw,snapshot),Message::class.java)).asJsonObject.getAsJsonObject("pictureElem")
        listOf("sourcePicture","bigPicture","snapshotPicture").forEach { key ->
            assertEquals("image/jpeg",sdk.getAsJsonObject(key)["type"].asString)
            assertEquals("https://cdn.invalid/original.jpg",sdk.getAsJsonObject(key)["url"].asString)
        }
    }
    @Test fun unsupportedSystemAndLocalOnlyMediaCannotBeForwarded() {
        assertThrows(IllegalArgumentException::class.java) { ForwardSnapshots.freeze("""{"contentType":1501}""") }
        assertThrows(IllegalArgumentException::class.java) { ForwardSnapshots.freeze("""{"contentType":105,"fileElem":{"filePath":"/data/private"}}""") }
    }
    @Test fun businessUserIdsRoundTripWithoutAcceptingArbitraryPeerNames() {
        assertEquals("12345678-1234-1234-1234-123456789abc",businessUserId("12345678123412341234123456789abc"))
        assertEquals("",businessUserId("../../user"))
    }
    @Test fun oldFavoriteMediaSnapshotsRenderWithoutExposingRawJson() {
        val voice=FavoriteContents.parse("voice","""{"path":"https://cdn.invalid/a.m4a","duration":7}""")
        assertEquals("https://cdn.invalid/a.m4a",voice.url);assertEquals(7L,voice.duration)
        val file=FavoriteContents.parse("file","""{"url":"https://cdn.invalid/a.pdf","fileName":"说明.pdf"}""")
        assertEquals("说明.pdf",file.fileName)
        val video=FavoriteContents.parse("video","""{"url":"https://cdn.invalid/a.mp4","snapshotUrl":"https://cdn.invalid/s.jpg","duration":8}""")
        assertEquals("https://cdn.invalid/s.jpg",video.thumbnail)
        assertEquals("https://cdn.invalid/a.mp4",FavoriteContents.parse("video",FavoriteContents.serialize(video)).url)
        assertEquals("https://cdn.invalid/a.m4a",FavoriteContents.parse("voice",FavoriteContents.serialize(voice)).url)
    }
    @Test fun mergedForwardSnapshotsNormalizeEmbeddedMediaAndStripLocalPathsRecursively() {
        val raw="""{"contentType":107,"mergeElem":{"title":"聊天记录","abstractList":["图片"],"multiMessage":[{"ContentType":102,"SendID":"sender","SenderNickname":"成员","PictureElem":{"SourcePath":"/data/private.jpg","SourcePicture":{"Url":"https://cdn.invalid/a.jpg","Width":800,"Height":600}}}]}}"""
        val frozen=ForwardSnapshots.freeze(raw)
        assertFalse(frozen.toString().contains("/data/"))
        val embedded=frozen.getAsJsonObject("content").getAsJsonArray("multiMessage").single()
        assertEquals("https://cdn.invalid/a.jpg",MessageContents.parse(embedded.toString()).url)
        assertEquals("成员",embedded.asJsonObject.get("senderNickname").asString)
    }
}
