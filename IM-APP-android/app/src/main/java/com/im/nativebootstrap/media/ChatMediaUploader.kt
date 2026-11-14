package com.im.nativebootstrap.media

import com.im.nativebootstrap.chat.ChatBusiness
import com.im.nativebootstrap.chat.jsonBody
import java.net.HttpURLConnection
import java.net.URI
import java.util.UUID

/** 沿用现有业务签名上传/完成协议；multipart 的 file 必须在签名字段之后。 */
object ChatMediaUploader {
    fun upload(business:ChatBusiness,media:LocalMedia,purpose:String?=null):UploadedMedia {
        require(media.file.isFile&&media.file.length() in 1..(256L*1024*1024)) { "请选择有效且小于 256 MB 的文件" }
        val selectedPurpose=purpose ?: when(media.kind) { MediaKind.IMAGE -> "image";MediaKind.VOICE -> "voice";else -> "file" }
        require(selectedPurpose in setOf("avatar","image","voice","file","sticker"))
        val init=business.request("POST","/files/uploads",jsonBody("purpose" to selectedPurpose,"fileName" to media.name,"contentType" to media.mime,"size" to media.file.length())).asJsonObject
        val fileId=init.obj("file").string("id")
        require(fileId.isNotEmpty()) { "上传凭据缺少文件标识" }
        val url=init.string("formUrl").ifEmpty { init.string("uploadUrl") }
        val uri=URI(url)
        require(uri.scheme=="https"&&uri.userInfo==null&&!uri.host.isNullOrBlank()) { "上传必须使用 HTTPS" }
        val form=init.obj("formData")
        require(form.size()>0) { "上传凭据缺少签名表单" }
        val boundary="NativeIM${UUID.randomUUID().toString().replace("-","")}"
        val fields=form.entrySet().map { (name,value) ->
            require(name!="file"&&!name.contains('"')&&!name.contains('\r')&&!name.contains('\n'))
            "--$boundary\r\nContent-Disposition: form-data; name=\"$name\"\r\n\r\n${value.asString}\r\n".toByteArray(Charsets.UTF_8)
        }
        val safeName=media.name.replace(Regex("[\"\\r\\n\\\\]"),"_")
        val safeMime=media.mime.takeIf { Regex("^[a-zA-Z0-9.+-]+/[a-zA-Z0-9.+-]+$").matches(it) } ?: "application/octet-stream"
        val fileHeader="--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$safeName\"\r\nContent-Type: $safeMime\r\n\r\n".toByteArray(Charsets.UTF_8)
        val footer="\r\n--$boundary--\r\n".toByteArray(Charsets.UTF_8)
        val connection=uri.toURL().openConnection() as HttpURLConnection
        connection.requestMethod="POST";connection.doOutput=true;connection.instanceFollowRedirects=false
        connection.connectTimeout=20_000;connection.readTimeout=90_000
        connection.setFixedLengthStreamingMode(fields.sumOf { it.size.toLong() }+fileHeader.size+media.file.length()+footer.size)
        init.obj("headers").entrySet().forEach { (name,value) ->
            require(!name.equals("Authorization",true)&&!name.equals("Cookie",true)) { "存储上传凭据格式不受支持" }
            if(!name.equals("Content-Type",true)&&!name.equals("Content-Length",true)) connection.setRequestProperty(name,value.asString)
        }
        connection.setRequestProperty("Content-Type","multipart/form-data; boundary=$boundary")
        var etag:String?=null
        try {
            connection.outputStream.use { out ->
                fields.forEach { out.write(it) }
                out.write(fileHeader)
                media.file.inputStream().use { it.copyTo(out,64*1024) }
                out.write(footer)
            }
            check(connection.responseCode in 200..299) { "文件上传未完成，请重试" }
            etag=connection.getHeaderField("ETag")
        } finally { connection.disconnect() }
        val result=business.request("POST","/files/uploads/complete",jsonBody("fileId" to fileId,"etag" to etag)).asJsonObject
        val remote=MediaURLs.remote(result.string("url"),business.baseUrl)
        check(remote.isNotEmpty()) { "文件已上传，但暂未获得可用地址" }
        return UploadedMedia(media,remote,MediaURLs.remote(result.string("thumbnailUrl"),business.baseUrl),fileId)
    }
}
