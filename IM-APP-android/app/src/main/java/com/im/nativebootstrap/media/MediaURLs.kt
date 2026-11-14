package com.im.nativebootstrap.media

import java.net.URI
import java.net.URLDecoder
import java.net.URLEncoder

enum class ImageVariant(val edge: Int, val process: String, val stable: String) {
    LIST(360,"image/resize,w_360/quality,q_60/format,webp","list"),
    PREVIEW(960,"image/resize,w_960/quality,q_72/format,webp","preview-mobile"),
    AVATAR(128,"image/resize,w_128/quality,q_70/format,webp","avatar"), ORIGINAL(0,"","")
}

/** 不把业务凭据发往 CDN；签名直链的 host/path/query 字节不可随意改写。 */
object MediaURLs {
    const val DEFAULT_BASE = "https://www.xn--jprz53bj9s.com/api/v1"
    @Volatile var businessBase: String = DEFAULT_BASE
    private val chatHosts=setOf("oss-chat.whs188.xin","oss-chat-test.xn--jprz53bj9s.com")
    private val businessHosts=setOf("oss-business.whs188.xin","oss-business-test.xn--jprz53bj9s.com")
    private val chatPrefixes=listOf("im-app-production/chat/","oss-test/chat/")
    private val businessPrefixes=listOf("im-app-production/business/","oss-test/business/")
    private val image=Regex("\\.(jpe?g|png|webp|bmp|gif|tiff?|heic|heif|avif)$",RegexOption.IGNORE_CASE)
    private val nonImage=Regex("\\.(mp4|mov|m4v|webm|mkv|avi|aac|m4a|mp3|wav|ogg|flac|pdf|zip|rar|7z|docx?|xlsx?|pptx?)$",RegexOption.IGNORE_CASE)
    private fun decode(s:String)=runCatching { URLDecoder.decode(s.replace("+","%2B"),"UTF-8") }.getOrDefault(s)
    private fun encode(s:String)=URLEncoder.encode(s,"UTF-8").replace("+","%20")
    private fun params(uri:URI)=uri.rawQuery.orEmpty().split('&').filter { it.isNotEmpty() }.associate { decode(it.substringBefore('=')) to decode(it.substringAfter('=',"")) }
    private fun signed(uri:URI):Boolean {
        val keys=params(uri).keys.map(String::lowercase).toSet()
        return "x-oss-signature" in keys || "x-amz-signature" in keys || ("ossaccesskeyid" in keys&&"signature" in keys)
    }
    private fun change(raw:String,remove:Set<String>,add:Map<String,String> = emptyMap()):String {
        val uri=URI(raw)
        val parts=uri.rawQuery.orEmpty().split('&').filter { it.isNotBlank() && decode(it.substringBefore('=')) !in remove }
        val query=(parts+add.map { encode(it.key)+"="+encode(it.value) }).joinToString("&")
        return raw.substringBefore('#').substringBefore('?')+(if(query.isNotEmpty()) "?${query}" else "")+(uri.rawFragment?.let { "#$it" } ?: "")
    }
    private fun origin(base:String):String {
        val uri=URI(base)
        require(uri.scheme=="https"&&!uri.host.isNullOrBlank()&&uri.userInfo==null)
        return "https://${uri.rawAuthority}"+uri.path.orEmpty().replace(Regex("/api/v1/?$",RegexOption.IGNORE_CASE),"").trimEnd('/')
    }
    private fun logical(uri:URI):String {
        val host=uri.host.orEmpty().lowercase()
        // 仅已知聊天存储域名 + 物理桶前缀，禁止为任意外域签名 URL 生成代理。
        if(host !in chatHosts || host=="oss-chat.whs188.xin" || !signed(uri)) return ""
        val path=decode(uri.rawPath.orEmpty()).trimStart('/')
        return chatPrefixes.firstNotNullOfOrNull { prefix -> path.takeIf { it.startsWith(prefix) }?.removePrefix(prefix) }.orEmpty()
    }
    fun isGif(raw:String):Boolean=runCatching {
        val uri=URI(raw.trim())
        decode(uri.rawPath.orEmpty()).endsWith(".gif",true)||params(uri)["key"].orEmpty().endsWith(".gif",true)
    }.getOrDefault(false)
    fun image(raw:String,variant:ImageVariant=ImageVariant.LIST,base:String=businessBase):String = runCatching {
        val value=raw.trim()
        if(value.isBlank()) return ""
        val uri=URI(value)
        val query=params(uri)
        val path=decode(uri.rawPath.orEmpty())
        val animated=path.endsWith(".gif",true)||query["key"].orEmpty().endsWith(".gif",true)
        if(variant==ImageVariant.ORIGINAL||animated) {
            // 已知聊天桶的过期签名恢复为无处理原图；外域与其它桶的签名字节仍保持不变。
            val key=logical(uri)
            if(key.isNotEmpty()&&!nonImage.containsMatchIn(key)) {
                val encoded=key.trimStart('/').split('/').filter(String::isNotEmpty).joinToString("/") { encode(it) }
                return "${origin(base)}/object/$encoded"
            }
            if(signed(uri)) return remote(value,base)
            return remote(change(value,setOf("x-oss-process","variant")+(if(path.startsWith("/object/")) setOf("type","width","height","format") else emptySet())),base)
        }
        if(path=="/api/v1/public/oss-media" && !query["token"].isNullOrBlank() && image.containsMatchIn(query["key"].orEmpty())) {
            return remote(change(value,setOf("variant"),mapOf("variant" to variant.stable)),base)
        }
        val key=if(variant==ImageVariant.AVATAR) "" else logical(uri)
        if(key.isNotEmpty()&&!nonImage.containsMatchIn(key)) {
            val encoded=key.trimStart('/').split('/').filter(String::isNotEmpty).joinToString("/") { encode(it) }
            return "${origin(base)}/object/$encoded?type=image&width=${variant.edge}&height=${variant.edge}&format=webp"
        }
        if(signed(uri)) return remote(value,base)
        if(path.startsWith("/object/")&&!nonImage.containsMatchIn(path)&&variant!=ImageVariant.AVATAR) {
            return remote(change(value,setOf("type","width","height","format"),mapOf("type" to "image","width" to variant.edge.toString(),"height" to variant.edge.toString(),"format" to "webp")),base)
        }
        val host=uri.host.orEmpty().lowercase()
        val normalized=path.trimStart('/')
        val knownBusiness=host in businessHosts&&businessPrefixes.any(normalized::startsWith)
        val knownChat=variant!=ImageVariant.AVATAR&&host in chatHosts&&chatPrefixes.any(normalized::startsWith)
        val relativeAvatar=uri.host==null&&path.startsWith('/')&&path.contains("/avatars/")
        if((knownBusiness||knownChat||relativeAvatar)&&image.containsMatchIn(path)&&"x-oss-process" !in query) {
            return remote(change(value,emptySet(),mapOf("x-oss-process" to variant.process)),base)
        }
        remote(value,base)
    }.getOrDefault("")

    /** 视频仍走原文件；只恢复已知旧聊天桶的签名，不追加图片处理参数。 */
    fun playback(raw:String,base:String=businessBase):String = runCatching {
        val value=raw.trim();val uri=URI(value)
        val key=logical(uri)
        if(key.isNotEmpty()) {
            val segments=key.trimStart('/').split('/')
            require(segments.all { it.isNotBlank()&&it!="."&&it!=".." })
            return "${origin(base)}/object/"+segments.joinToString("/") { encode(it) }
        }
        remote(value,base)
    }.getOrDefault("")

    fun remote(raw:String,base:String=businessBase):String = runCatching {
        val value=raw.trim()
        if(value.startsWith("//")) return ""
        val uri=URI(value)
        val resolved=if(uri.scheme==null&&value.startsWith('/')) URI(origin(base)).resolve(uri) else uri
        if(resolved.userInfo!=null||resolved.host.isNullOrBlank()) return ""
        if(resolved.scheme.equals("https",true)) return resolved.toASCIIString()
        // 历史 MinIO/IP 只按已知部署路径转到同一业务源，不全局放行明文网络。
        if(resolved.scheme=="http"&&resolved.host=="8.154.44.197"&&!signed(resolved)&&listOf("/object/","/minio/","/openim/","/openim-api/").any { resolved.path.startsWith(it) }) {
            return origin(base)+resolved.rawPath+(resolved.rawQuery?.let { "?$it" } ?: "")
        }
        ""
    }.getOrDefault("")
}
