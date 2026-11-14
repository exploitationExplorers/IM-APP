package com.im.nativebootstrap.chat

import com.google.gson.JsonObject
import com.google.gson.JsonParser
import com.google.gson.JsonArray
import com.im.nativebootstrap.media.*

/** 冻结业务转发快照；剥离发送端本地路径，引用内容也不能夹带旧临时路径。 */
object ForwardSnapshots {
    fun freeze(serialized:String):JsonObject = build(JsonParser.parseString(serialized).asJsonObject,0)
    private fun build(raw:JsonObject,depth:Int):JsonObject {
        require(depth<=6) { "引用层级过深" }
        val type=raw.number("contentType","ContentType").toInt()
        require(type in setOf(101,102,103,104,105,106,107,108,114)) { "该消息暂不支持转发" }
        val parsed=MessageContents.parse(raw.toString())
        val content=when(type) {
            101 -> jsonBody("content" to parsed.text)
            102 -> {
                require(parsed.url.isNotEmpty()) { "图片原图地址不可用" }
                val stored=parseObject(raw.field("content","Content")) ?: JsonObject()
                fun remote(box:JsonObject)=listOf("url","Url","URL").map { box.string(it).trim() }.firstOrNull { it.startsWith("https://",true)||it.startsWith("http://",true)||it.startsWith("/object/")||it.startsWith("/api/") }
                val candidates=listOf("pictureElem","PictureElem").mapNotNull { parseObject(raw.get(it)) }+listOf("pictureElem","PictureElem").mapNotNull { parseObject(stored.get(it)) }+stored
                val elem=candidates.firstOrNull { item -> listOf("sourcePicture","SourcePicture","bigPicture","BigPicture","snapshotPicture","SnapshotPicture").any { remote(item.obj(it))!=null } } ?: JsonObject()
                fun spec(camel:String,pascal:String):JsonObject {
                    val values=listOfNotNull(parseObject(elem.get(camel)),parseObject(elem.get(pascal)))
                    return values.firstOrNull { remote(it)!=null } ?: values.firstOrNull() ?: JsonObject()
                }
                val boxes=listOf(spec("sourcePicture","SourcePicture"),spec("bigPicture","BigPicture"),spec("snapshotPicture","SnapshotPicture"))
                val fallbackType=boxes.firstNotNullOfOrNull { it.string("type","Type").trim().takeIf(String::isNotBlank) } ?: "image/jpeg"
                fun picture(box:JsonObject,fallback:JsonObject?=null):JsonObject {
                    val url=remote(box)
                    if(url==null&&fallback!=null)return fallback.deepCopy()
                    return jsonBody("uuid" to box.string("uuid","UUID"),"url" to (url ?: parsed.url),
                        "width" to box.number("width","Width").takeIf { it>0 }.let { it ?: parsed.width.toLong() },
                        "height" to box.number("height","Height").takeIf { it>0 }.let { it ?: parsed.height.toLong() },
                        "size" to box.number("size","Size").takeIf { it>0 }.let { it ?: parsed.size },
                        "type" to box.string("type","Type").trim().ifBlank { fallbackType })
                }
                val source=picture(boxes[0])
                jsonBody("sourcePath" to "","sourcePicture" to source,"bigPicture" to picture(boxes[1],source),"snapshotPicture" to picture(boxes[2],source))
            }
            103 -> jsonBody("soundPath" to "","sourceUrl" to parsed.url,"duration" to parsed.duration,"dataSize" to parsed.size)
            104 -> jsonBody("videoPath" to "","videoUrl" to parsed.url,"videoType" to "mp4","videoSize" to parsed.size,"duration" to parsed.duration,"snapshotPath" to "","snapshotUrl" to parsed.thumbnail,"snapshotWidth" to parsed.width,"snapshotHeight" to parsed.height)
            105 -> jsonBody("filePath" to "","sourceUrl" to parsed.url,"fileName" to parsed.fileName,"fileSize" to parsed.size)
            108 -> jsonBody("userID" to parsed.cardUserId,"nickname" to parsed.cardName,"faceURL" to parsed.thumbnail)
            107 -> {
                val elem=raw.obj("mergeElem","MergeElem").takeIf { it.size()>0 } ?: raw.obj("content","Content")
                val source=elem.field("multiMessage","MultiMessage")
                val array=if(source?.isJsonArray==true)source.asJsonArray else source?.asString?.let { JsonParser.parseString(it).asJsonArray } ?: error("合并记录内容无效")
                require(array.size() in 1..200) { "合并记录数量过大或为空" }
                val messages=JsonArray().apply { array.forEach { add(embedded(parseObject(it) ?: error("内嵌消息无效"),depth+1)) } }
                jsonBody("title" to elem.string("title","Title"),"multiMessage" to messages).apply { elem.field("abstractList","AbstractList")?.let { add("abstractList",it.deepCopy()) } }
            }
            else -> {
                val elem=raw.obj(if(type==114) "quoteElem" else "atTextElem",if(type==114) "QuoteElem" else "AtTextElem").takeIf { it.size()>0 } ?: raw.obj("content","Content")
                jsonBody("text" to parsed.text).apply {
                    if(type==106) {
                        elem.field("atUserList","AtUserList")?.let { add("atUserList",it.deepCopy()) }
                        elem.field("atUsersInfo","AtUsersInfo")?.let { add("atUsersInfo",it.deepCopy()) }
                    }
                    val quote=elem.obj("quoteMessage","QuoteMessage")
                    if(quote.size()>0) {
                        add("quoteMessage",embedded(quote,depth+1))
                    }
                }
            }
        }
        if(type in 103..105) require(parsed.url.isNotEmpty()) { "媒体地址不可用" }
        return jsonBody("contentType" to type,"content" to content)
    }
    private fun embedded(raw:JsonObject,depth:Int):JsonObject {
        val nested=build(raw,depth)
        val safe=jsonBody("contentType" to nested.get("contentType"),"content" to nested.get("content").toString())
        val nestedField=mapOf(101 to "textElem",102 to "pictureElem",103 to "soundElem",104 to "videoElem",105 to "fileElem",106 to "atTextElem",107 to "mergeElem",108 to "cardElem",114 to "quoteElem")[nested.get("contentType").asInt]
        if(nestedField!=null)safe.add(nestedField,nested.get("content").deepCopy())
        listOf("clientMsgID","sendID","senderNickname","senderFaceUrl","sendTime","createTime","seq","sessionType").forEach { key -> raw.field(key,key.replaceFirstChar(Char::uppercase))?.let { safe.add(key,it.deepCopy()) } }
        return safe
    }
    fun withSnapshot(serialized:String,snapshot:JsonObject):String {
        val raw=JsonParser.parseString(serialized).asJsonObject
        val type=snapshot.get("contentType").asInt
        val content=parseObject(snapshot.get("content")) ?: error("消息快照内容格式无效")
        val field=mapOf(101 to "textElem",102 to "pictureElem",103 to "soundElem",104 to "videoElem",105 to "fileElem",106 to "atTextElem",107 to "mergeElem",108 to "cardElem",114 to "quoteElem")[type] ?: error("消息快照类型无效")
        raw.addProperty("contentType",type);raw.addProperty("content",content.toString());raw.add(field,content.deepCopy())
        if(raw.has("ContentType"))raw.addProperty("ContentType",type)
        if(raw.has("Content"))raw.addProperty("Content",content.toString())
        val pascal=field.replaceFirstChar(Char::uppercase)
        if(raw.has(pascal))raw.add(pascal,content.deepCopy())
        return raw.toString()
    }
}
