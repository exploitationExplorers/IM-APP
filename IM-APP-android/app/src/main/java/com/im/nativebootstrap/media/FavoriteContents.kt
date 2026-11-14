package com.im.nativebootstrap.media

import com.google.gson.JsonParser
import com.im.nativebootstrap.chat.jsonBody

/** 收藏是独立快照；兼容旧版 URL / {path,duration} / {url,fileName} / SDK 冻结内容。 */
object FavoriteContents {
    fun parse(type:String,content:String):MessageContent {
        val code=when(type) { "image" -> 102;"voice" -> 103;"video" -> 104;"file" -> 105;else -> 101 }
        if(code==101)return MessageContent(text=content)
        val raw=runCatching { JsonParser.parseString(content).takeIf { it.isJsonObject }?.asJsonObject }.getOrNull()
        if(raw!=null) {
            if(raw.has("contentType")||raw.has("ContentType"))return MessageContents.parse(raw.toString())
            val url=raw.string("url","Url","URL","path","Path","sourceUrl","SourceUrl","videoUrl","VideoUrl","videoURL","VideoURL")
            val parsed=MessageContent(type=code,url=MediaURLs.remote(url),thumbnail=MediaURLs.remote(raw.string("snapshotUrl","SnapshotUrl","thumbnailUrl","coverUrl")),duration=raw.number("duration","Duration"),fileName=raw.string("fileName","FileName","name"),size=raw.number("fileSize","FileSize","size"))
            if(parsed.url.isNotEmpty())return parsed
            val sdk=MessageContents.parse(jsonBody("contentType" to code,"content" to raw.toString()).toString())
            if(sdk.url.isNotEmpty())return sdk
            return parsed
        }
        val url=MediaURLs.remote(content)
        return MessageContent(type=code,url=url,fileName=if(code==105)runCatching { java.net.URLDecoder.decode(java.net.URI(url).path.substringAfterLast('/'),"UTF-8") }.getOrDefault("文件") else "")
    }
    fun serialize(content:MessageContent):String = when(content.type) {
        101,106,114 -> content.text
        108 -> "[名片] ${content.cardName}"
        102 -> content.url
        103 -> jsonBody("path" to content.url,"duration" to content.duration).toString()
        104 -> jsonBody("url" to content.url,"snapshotUrl" to content.thumbnail,"duration" to content.duration).toString()
        105 -> jsonBody("url" to content.url,"fileName" to content.fileName).toString()
        else -> error("该消息暂不支持收藏")
    }
}
