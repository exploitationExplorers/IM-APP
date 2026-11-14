package com.im.nativebootstrap.media

import com.google.gson.JsonElement
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.File

enum class MediaKind { IMAGE, VOICE, VIDEO, FILE }
data class LocalMedia(val file: File, val name: String, val mime: String, val kind: MediaKind, val duration: Long = 0, val width: Int = 0, val height: Int = 0, val snapshot: File? = null)
data class UploadedMedia(val local: LocalMedia, val url: String, val thumbnail: String = "", val id: String = "")
data class MessageContent(
    val type: Int = 101, val text: String = "", val url: String = "", val thumbnail: String = "",
    val width: Int = 0, val height: Int = 0, val duration: Long = 0, val size: Long = 0,
    val fileName: String = "", val avatar: String = "", val senderId: String = "", val read: Boolean = false,
    val quoteText: String = "", val cardUserId: String = "", val cardName: String = "",val quoteId:String="",
    val groupCard:GroupMessageCard?=null,
    val imageAlternatives:List<String> = emptyList(),
)
data class GroupMessageCard(val kind:String,val groupId:String,val groupName:String,val avatar:String="",val token:String="",val count:Long=0,val requestId:String="",val applicantName:String="")

internal fun JsonObject.field(vararg names: String): JsonElement? = names.firstNotNullOfOrNull { get(it)?.takeUnless { value -> value.isJsonNull } }
internal fun JsonObject.string(vararg names: String): String = runCatching { field(*names)?.takeIf { it.isJsonPrimitive }?.asString.orEmpty() }.getOrDefault("")
internal fun JsonObject.number(vararg names: String): Long = runCatching { field(*names)?.asLong ?: 0 }.getOrDefault(0)
internal fun JsonObject.obj(vararg names: String): JsonObject = parseObject(field(*names)) ?: JsonObject()
internal fun parseObject(raw: JsonElement?): JsonObject? {
    var value = raw
    repeat(4) {
        if (value?.isJsonObject == true) return value!!.asJsonObject
        value = runCatching { value?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString?.let(JsonParser::parseString) }.getOrNull()
    }
    return null
}
private fun remote(vararg values: String) = values.map(String::trim).firstOrNull { it.startsWith("https://",true) || it.startsWith("http://",true) || it.startsWith("/object/") || it.startsWith("/api/") }.orEmpty()

/** 兼容历史 App 桥的 PascalCase；接收端绝不加载消息中的发送端本地路径。 */
object MessageContents {
    fun isPinSync(serialized:String):Boolean=runCatching {
        val raw=JsonParser.parseString(serialized).asJsonObject
        raw.number("contentType","ContentType")==110L&&parseObject(raw.obj("customElem","CustomElem").field("data","Data"))?.string("businessKey","BusinessKey")=="message_pin"
    }.getOrDefault(false)
    fun parse(serialized: String, fallback: String = ""): MessageContent = runCatching {
        if (serialized.isBlank()) return MessageContent(text=fallback)
        val raw = JsonParser.parseString(serialized).asJsonObject
        val type = raw.number("contentType","ContentType").toInt()
        val stored = parseObject(raw.field("content","Content")) ?: JsonObject()
        fun elem(vararg names: String) = parseObject(raw.field(*names)) ?: stored
        val read=runCatching { raw.field("isRead","IsRead")?.asBoolean==true }.getOrDefault(false)||raw.obj("attachedInfoElem","AttachedInfoElem").obj("groupHasReadInfo","GroupHasReadInfo").number("hasReadCount","HasReadCount")>0
        var result = MessageContent(type=type,text=fallback,avatar=raw.string("senderFaceUrl","SenderFaceUrl","SenderFaceURL"),senderId=raw.string("sendID","SendID"),read=read)
        result = when(type) {
            101 -> result.copy(text=elem("textElem","TextElem").string("content","Content").ifEmpty { fallback })
            102 -> {
                var pic=elem("pictureElem","PictureElem")
                if(listOf("sourcePicture","SourcePicture","bigPicture","BigPicture","snapshotPicture","SnapshotPicture").all { pic.obj(it).string("url","Url","URL").isBlank() }&&stored.size()>0)
                    pic=stored.obj("pictureElem","PictureElem").takeIf { it.size()>0 } ?: stored
                val source=pic.obj("sourcePicture","SourcePicture")
                val big=pic.obj("bigPicture","BigPicture")
                val thumb=pic.obj("snapshotPicture","SnapshotPicture")
                val original=remote(source.string("url","Url","URL"),big.string("url","Url","URL"),thumb.string("url","Url","URL"),pic.string("sourcePath","SourcePath"))
                val animated=MediaURLs.isGif(original)||source.string("type","Type").substringAfter('/').equals("gif",true)
                val alternatives=if(animated&&original.isNotEmpty())listOf(original) else listOf(remote(thumb.string("url","Url","URL")),remote(big.string("url","Url","URL")),original).filter(String::isNotBlank).distinct()
                result.copy(url=original,thumbnail=alternatives.firstOrNull().orEmpty(),imageAlternatives=alternatives,width=source.number("width","Width").toInt().takeIf { it>0 } ?: big.number("width","Width").toInt(),height=source.number("height","Height").toInt().takeIf { it>0 } ?: big.number("height","Height").toInt(),size=source.number("size","Size"))
            }
            103 -> elem("soundElem","SoundElem").let { result.copy(url=remote(it.string("sourceUrl","SourceUrl","SourceURL"),it.string("soundPath","SoundPath")),duration=it.number("duration","Duration"),size=it.number("dataSize","DataSize")) }
            104 -> {
                var video=elem("videoElem","VideoElem")
                fun videoURL(value:JsonObject)=remote(value.string("videoUrl","VideoUrl","videoURL","VideoURL","video_url","sourceUrl","SourceUrl","url","URL"),value.string("videoPath","VideoPath"))
                if(videoURL(video).isBlank()&&stored.size()>0)video=stored.obj("videoElem","VideoElem").takeIf { it.size()>0 } ?: stored
                fun dimension(vararg names:String)=names.firstNotNullOfOrNull { name->video.number(name).takeIf { it in 1..100_000 } }?.toInt() ?: 0
                result.copy(url=videoURL(video),thumbnail=remote(video.string("snapshotUrl","SnapshotUrl","snapshotURL","SnapshotURL","snapshot_url","coverUrl","CoverUrl","thumbUrl","ThumbUrl"),video.string("snapshotPath","SnapshotPath")),duration=video.number("duration","Duration"),size=video.number("videoSize","VideoSize"),width=dimension("snapshotWidth","SnapshotWidth","videoWidth","VideoWidth","width","Width"),height=dimension("snapshotHeight","SnapshotHeight","videoHeight","VideoHeight","height","Height"))
            }
            105 -> elem("fileElem","FileElem").let { result.copy(url=remote(it.string("sourceUrl","SourceUrl","SourceURL"),it.string("filePath","FilePath")),fileName=it.string("fileName","FileName"),size=it.number("fileSize","FileSize")) }
            106,114 -> elem(if(type==114) "quoteElem" else "atTextElem",if(type==114) "QuoteElem" else "AtTextElem").let {
                val quote=it.obj("quoteMessage","QuoteMessage")
                val quoteType=quote.number("contentType","ContentType").toInt()
                val summary=when(quoteType) { 101 -> quote.obj("textElem","TextElem").string("content","Content");102 -> "[图片]";103 -> "[语音]";104 -> "[视频]";105 -> "[文件]";else -> "[引用消息]" }
                result.copy(text=it.string("text","Text"),quoteText=if(quote.size()>0) quote.string("senderNickname","SenderNickname")+"："+summary else "",quoteId=quote.string("clientMsgID","ClientMsgID"))
            }
            108 -> elem("cardElem","CardElem").let { result.copy(cardUserId=it.string("userID","UserID"),cardName=it.string("nickname","Nickname"),thumbnail=it.string("faceURL","FaceURL")) }
            107 -> elem("mergeElem","MergeElem").let { result.copy(text=it.string("title","Title").ifEmpty { "聊天记录" }) }
            110 -> {
                val data=parseObject(elem("customElem","CustomElem").field("data","Data")) ?: JsonObject()
                val key=data.string("businessKey","BusinessKey")
                val groupId=data.string("groupId","GroupId","groupID","GroupID").trim()
                val name=data.string("groupName","GroupName").ifBlank { "群聊" }
                val card=when(key) {
                    "group_invite" -> data.string("token","Token").trim().takeIf { it.isNotEmpty()&&groupId.isNotEmpty() }?.let { GroupMessageCard(key,groupId,name,remote(data.string("groupAvatar","GroupAvatar")),it,data.number("memberCount","MemberCount").coerceAtLeast(0)) }
                    "group_join_request" -> data.string("requestId","RequestId").trim().takeIf { it.isNotEmpty()&&groupId.isNotEmpty() }?.let { GroupMessageCard(key,groupId,name,remote(data.string("applicantAvatar","ApplicantAvatar")),requestId=it,applicantName=data.string("applicantNickname","ApplicantNickname").ifBlank { "申请人" }) }
                    else -> null
                }
                result.copy(groupCard=card,text=when(key) { "group_invite" -> "[群邀请] $name";"group_join_request" -> "[入群申请] $name";else -> fallback })
            }
            else -> if(type>=1000)result.copy(text=com.im.nativebootstrap.chat.ChatSystemMessages.format(serialized)) else result
        }
        result
    }.getOrElse { MessageContent(type=0,text="消息内容暂不可用") }
}
