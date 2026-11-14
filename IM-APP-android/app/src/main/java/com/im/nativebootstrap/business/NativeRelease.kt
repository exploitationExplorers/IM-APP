package com.im.nativebootstrap.business

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import com.google.gson.JsonObject
import com.im.nativebootstrap.update.NativeUpdateManifest
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.security.MessageDigest
import java.util.UUID

data class NativeRelease(val versionCode:Long,val versionName:String,val url:String,val changelog:String,val sha256:String="",val sizeBytes:Long?=null) {
    companion object {
        const val CHANNEL="canary"
        const val FAMILY="im-native-android-v1"
        const val MAX_BYTES=200L*1024*1024
        @Suppress("DEPRECATION")
        fun installedVersion(info:android.content.pm.PackageInfo):Long=if(Build.VERSION.SDK_INT>=28)info.longVersionCode else info.versionCode.toLong()
        fun parse(value:JsonObject,currentVersion:Long):NativeRelease? {
            if(!value.flag("hasUpdate")||value.text("updateType")=="none")return null
            require(value.text("updateType")=="native") { "该更新适用于旧版应用，请使用原生安装包更新。" }
            val version=value.get("versionCode")?.asBigDecimal?.longValueExact() ?: error("更新版本信息不完整")
            require(version>currentVersion) { "更新版本不可用，请稍后重试。" }
            val uri=NativeUpdateManifest.https(value.text("downloadUrl"))
            return NativeRelease(version,value.text("versionName"),uri.toASCIIString(),value.text("changelog").take(2000))
        }
        /** 只接受与当前应用同身份、同签名的原生包，旧 WGT 和 uni-app 壳不能覆盖。 */
        fun downloadCompatible(context:Context,release:NativeRelease,ensureActive:()->Unit={}):File {
            val folder=File(context.cacheDir,"updates").apply {check(mkdirs()||isDirectory)}
            val part=File(folder,"native-${UUID.randomUUID()}.part")
            try {
                var address=release.url
                var downloaded=false
                repeat(5) {
                    if(!downloaded) {
                        ensureActive()
                        val uri=NativeUpdateManifest.https(address)
                        val connection=uri.toURL().openConnection() as HttpURLConnection
                        connection.connectTimeout=15_000;connection.readTimeout=30_000;connection.instanceFollowRedirects=false
                        connection.setRequestProperty("Accept-Encoding","identity")
                        try {
                            val status=connection.responseCode
                            if(status in listOf(301,302,303,307,308)) {
                                val location=connection.getHeaderField("Location").orEmpty()
                                check(location.isNotBlank()) { "更新下载暂不可用。" }
                                address=uri.resolve(location).toASCIIString()
                            } else {
                                check(status==200) { "更新下载失败，请稍后重试。" }
                                check(connection.contentLengthLong<=MAX_BYTES) { "安装包超过下载大小限制。" }
                                val digest=MessageDigest.getInstance("SHA-256")
                                connection.inputStream.use { input->FileOutputStream(part).use { output->
                                    val buffer=ByteArray(64*1024);var total=0L
                                    while(true){ensureActive();val count=input.read(buffer);if(count<0)break;total+=count;check(total<=MAX_BYTES){"安装包超过下载大小限制。"};digest.update(buffer,0,count);output.write(buffer,0,count)}
                                    check(total>0&&(connection.contentLengthLong<0||total==connection.contentLengthLong)) { "安装包未下载完整，请重试。" }
                                    check(release.sizeBytes==null||release.sizeBytes==total) { "安装包大小与更新清单不符，请重新下载。" }
                                    val actual=digest.digest().joinToString(""){"%02x".format(it)}
                                    check(release.sha256.isBlank()||actual==release.sha256.lowercase()) { "安装包摘要与更新清单不符，请重新下载。" }
                                    output.fd.sync()
                                }}
                                downloaded=true
                            }
                        } finally {connection.disconnect()}
                    }
                }
                check(downloaded) { "更新下载暂不可用。" }
                ensureActive()
                validatePackage(context,part,release.versionCode)
                val apk=File(folder,"native-${release.versionCode}-${UUID.randomUUID()}.apk")
                check(part.renameTo(apk)) { "安装包未能保存，请重试。" }
                folder.listFiles().orEmpty().filter{it.isFile&&it.name.startsWith("native-")&&it.extension=="apk"&&it!=apk}.forEach{it.delete()}
                return apk
            } finally {part.delete()}
        }
        @Suppress("DEPRECATION")
        fun installedSigners(context:Context):Set<String> {
            val flags=if(Build.VERSION.SDK_INT>=28)PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
            return signers(context.packageManager.getPackageInfo(context.packageName,flags))
        }
        @Suppress("DEPRECATION")
        private fun signers(info:android.content.pm.PackageInfo):Set<String> =
            (if(Build.VERSION.SDK_INT>=28)info.signingInfo?.apkContentsSigners else info.signatures)?.map { signer->
                MessageDigest.getInstance("SHA-256").digest(signer.toByteArray()).joinToString(""){"%02x".format(it)}
            }?.toSet().orEmpty()
        @Suppress("DEPRECATION")
        private fun validatePackage(context:Context,file:File,version:Long) {
            val manager=context.packageManager
            val flags=(if(Build.VERSION.SDK_INT>=28)PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES) or PackageManager.GET_META_DATA
            val candidate=manager.getPackageArchiveInfo(file.absolutePath,flags)
                ?: error("安装包校验失败，请获取完整的原生安装包。")
            val current=manager.getPackageInfo(context.packageName,flags)
            val metadata=candidate.applicationInfo?.metaData
            check(candidate.packageName==context.packageName&&metadata?.getString("com.im.nativebootstrap.releaseFamily")==FAMILY) { "安装包不属于当前原生应用，请联系工作人员。" }
            check(installedVersion(candidate)==version&&version>installedVersion(current)) { "安装包版本不匹配，请重新检查更新。" }
            val actual=signers(candidate);val expected=signers(current)
            check(actual.isNotEmpty()&&actual==expected) { "安装包签名不匹配，请联系工作人员。" }
        }
        /** 返回 false 表示已打开系统授权页，用户返回后再次点击安装。 */
        fun install(context:Context,file:File):Boolean {
            check(file.isFile&&file.parentFile?.canonicalFile==File(context.cacheDir,"updates").canonicalFile) { "安装包已清理，请重新下载。" }
            if(!context.packageManager.canRequestPackageInstalls()) {
                context.startActivity(Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,Uri.parse("package:${context.packageName}")))
                return false
            }
            val uri=FileProvider.getUriForFile(context,"${context.packageName}.files",file)
            context.startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri,"application/vnd.android.package-archive").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
            return true
        }
    }
}
