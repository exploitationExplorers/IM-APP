package com.im.nativebootstrap.media

import android.app.Activity
import android.app.Instrumentation
import android.graphics.Bitmap
import android.os.Bundle
import kotlinx.coroutines.*
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.SocketPolicy
import okhttp3.tls.HandshakeCertificates
import okhttp3.tls.HeldCertificate
import okio.Buffer
import java.io.ByteArrayOutputStream
import java.io.File
import java.util.UUID
import java.util.concurrent.TimeUnit

/** 只请求模拟器内 loopback HTTPS 服务；证明缓存与取消行为，不冒充现网性能。 */
@OptIn(coil.annotation.ExperimentalCoilApi::class)
class MediaPipelineInstrumentation : Instrumentation() {
    private var restartOnly = false
    override fun onCreate(arguments: Bundle?) { restartOnly = arguments?.getString("restart") == "true"; super.onCreate(arguments); start() }
    override fun onStart() {
        val result = Bundle()
        try { runBlocking { withTimeout(90_000) { if(restartOnly)verifyRestart() else { verify();verifyOwnUpload() } } }; result.putString("mediaPipeline", if(restartOnly)"passed: process restart disk cache, zero network allowed" else "passed: cold/memory/disk/loader-recreate/signature/scope/singleflight/cancel/no-store/redirect/bad-image/local-upload; localhost HTTPS only"); finish(Activity.RESULT_OK, result) }
        catch (error: Throwable) { result.putString("mediaPipeline", "failed: ${error.javaClass.simpleName}: ${error.message}"); finish(Activity.RESULT_CANCELED, result) }
    }
    private suspend fun verifyOwnUpload() {
        val base="https://127.0.0.1:1/api/v1"
        val url="https://127.0.0.1:1/object/owned-${UUID.randomUUID()}.png"
        val directory=File(targetContext.filesDir,"outgoing").apply { mkdirs() }
        val source=File(directory,"own-fixture-${UUID.randomUUID()}.png")
        val bitmap=Bitmap.createBitmap(120,80,Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(android.graphics.Color.GREEN)
        source.outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG,100,it) };bitmap.recycle()
        try {
            MediaLoader.setScope(base,"own-upload-fixture")
            MediaLoader.rememberUploaded(targetContext,UploadedMedia(LocalMedia(source,"own.png","image/png",MediaKind.IMAGE),url),base,"own-upload-fixture")
            check(source.delete())
            check(withTimeout(5_000) { MediaLoader.load(targetContext,MediaURLs.image(url,ImageVariant.LIST,base),360) }.bitmap!=null) { "Own image was downloaded instead of reusing the uploaded file" }
            MediaLoader.setScope(base,"another-account")
            MediaLoader.setScope(base,"own-upload-fixture")
            check(withTimeout(5_000) { MediaLoader.load(targetContext,url,960) }.bitmap!=null) { "Local copy did not survive memory eviction" }
        } finally { source.delete();MediaLoader.setScope(MediaURLs.DEFAULT_BASE,"anonymous") }
    }
    private suspend fun verifyRestart() {
        val fixture = File(targetContext.filesDir,"media-restart-fixture.txt").readLines()
        check(fixture.size == 3 && Regex("^media-test-[0-9a-f-]+$").matches(fixture[0]))
        var requests = 0
        val client = OkHttpClient.Builder().addInterceptor { requests++; throw java.io.IOException("Network disabled during restart verification") }.build()
        val pipeline = MediaImagePipeline(targetContext,client,File(targetContext.cacheDir,fixture[0]),observeNetwork=false)
        try { check(pipeline.load(targetContext,fixture[1],fixture[2],128).bitmap != null);check(requests == 0) }
        finally { pipeline.close() }
    }
    private suspend fun verify() {
        val cert = HeldCertificate.Builder().commonName("localhost").addSubjectAlternativeName("localhost").build()
        val serverTLS = HandshakeCertificates.Builder().heldCertificate(cert).build()
        val clientTLS = HandshakeCertificates.Builder().addTrustedCertificate(cert.certificate).build()
        val server = MockWebServer().apply { useHttps(serverTLS.sslSocketFactory(), false); start() }
        val client = MediaHttp.images.newBuilder().sslSocketFactory(clientTLS.sslSocketFactory(), clientTLS.trustManager).build()
        val directory = File(targetContext.cacheDir, "media-test-${UUID.randomUUID()}")
        var pipeline = MediaImagePipeline(targetContext, client, directory, observeNetwork=false)
        val output = ByteArrayOutputStream()
        val bitmap = Bitmap.createBitmap(240, 160, Bitmap.Config.ARGB_8888)
        bitmap.eraseColor(android.graphics.Color.BLUE); bitmap.compress(Bitmap.CompressFormat.PNG, 100, output); bitmap.recycle()
        val bytes = output.toByteArray()
        fun response(cache: String = "public, max-age=3600") = MockResponse().setHeader("Content-Type", "image/png").setHeader("Cache-Control", cache).setBody(Buffer().write(bytes))
        val address = server.url("/object/photo.png?Signature=first&Expires=1").toString()
        val base = server.url("/api/v1").toString()
        val scope = MediaCacheIdentity.scope(base, "test-a")
        fun id(url: String = address, owner: String = scope) = MediaCacheIdentity.key(url, owner, base)
        try {
            MediaMetrics.reset()
            server.enqueue(response())
            val cold = pipeline.load(targetContext, address, id(), 128)
            check(cold.bitmap != null && cold.bitmap.width <= 256)
            check(server.requestCount == 1)
            val warm = pipeline.load(targetContext, address, id(), 128)
            check(warm.bitmap === cold.bitmap && server.requestCount == 1) { "Memory cache repeated transfer" }
            val forwarded=server.url("/object/forwarded-photo.png").toString()
            pipeline.alias(id(),id(forwarded))
            check(pipeline.load(targetContext,forwarded,id(forwarded),128).bitmap===cold.bitmap&&server.requestCount==1) { "Forwarded memory alias repeated transfer" }
            pipeline.loader.memoryCache!!.clear()
            check(pipeline.load(targetContext,forwarded,id(forwarded),128).bitmap!=null&&server.requestCount==1) { "Forwarded disk alias repeated transfer" }
            pipeline.loader.memoryCache!!.clear()
            val rotated = address.replace("first", "second").replace("Expires=1", "Expires=2")
            check(id() == id(rotated))
            pipeline.load(targetContext, rotated, id(rotated), 128)
            check(server.requestCount == 1) { "Signature rotation repeated transfer" }
            // 不同时创建两个写同目录的 DiskCache；复用同一 journal，重建加载器模拟组件生命周期。
            val sharedDisk = pipeline.loader.diskCache!!
            pipeline.close()
            pipeline = MediaImagePipeline(targetContext, client, directory, sharedDisk,observeNetwork=false)
            pipeline.load(targetContext, rotated, id(rotated), 128)
            check(server.requestCount == 1) { "Loader recreation lost disk cache" }
            server.enqueue(response())
            pipeline.load(targetContext, address, id(owner = MediaCacheIdentity.scope(base, "test-b")), 128)
            check(server.requestCount == 2) { "Account cache namespaces collided" }

            val shared = server.url("/object/shared.png").toString()
            server.enqueue(response().setBodyDelay(250, TimeUnit.MILLISECONDS))
            coroutineScope { (1..8).map { async { pipeline.load(targetContext, shared, id(shared), 128) } }.awaitAll() }
            check(server.requestCount == 3) { "Concurrent consumers downloaded multiple copies" }
            val survivor = server.url("/object/survivor.png").toString()
            server.enqueue(response().setBodyDelay(250, TimeUnit.MILLISECONDS))
            coroutineScope {
                val first = async { pipeline.load(targetContext, survivor, id(survivor), 128) }
                val second = async { pipeline.load(targetContext, survivor, id(survivor), 128) }
                delay(80); first.cancelAndJoin(); check(second.await().bitmap != null)
            }
            check(server.requestCount == 4) { "One cancelled consumer restarted another consumer" }

            val slow = server.url("/object/slow.png").toString()
            server.enqueue(MockResponse().setSocketPolicy(SocketPolicy.NO_RESPONSE))
            coroutineScope {
                val task = async { pipeline.load(targetContext, slow, id(slow), 128) }
                withTimeout(5_000) { while(server.requestCount < 5) delay(10) }
                task.cancelAndJoin()
            }
            withTimeout(3_000) { while(client.dispatcher.runningCallsCount() != 0) delay(10) }
            check(sharedDisk.openSnapshot(id(slow)) == null) { "Cancelled transfer committed a partial file" }

            val noStore = server.url("/object/private.png").toString()
            repeat(2) { server.enqueue(response("no-store")); pipeline.load(targetContext,noStore,id(noStore),128);pipeline.loader.memoryCache!!.clear() }
            check(server.requestCount == 7) { "Server no-store was ignored" }
            val redirect = server.url("/object/redirect.png").toString()
            server.enqueue(MockResponse().setResponseCode(302).setHeader("Cache-Control","private, no-store").setHeader("Location",server.url("/content/image.png").toString()))
            server.enqueue(response())
            pipeline.load(targetContext,redirect,id(redirect),128);pipeline.loader.memoryCache!!.clear();pipeline.load(targetContext,redirect,id(redirect),128)
            check(server.requestCount == 9) { "Final image cache was lost because redirect was no-store" }
            val bad = server.url("/object/bad.png").toString()
            server.enqueue(MockResponse().setHeader("Cache-Control","public, max-age=3600").setBody("<html>not an image</html>"))
            check(runCatching { pipeline.load(targetContext,bad,id(bad),128) }.isFailure)
            check(sharedDisk.openSnapshot(id(bad)) == null)
            server.enqueue(response());check(pipeline.load(targetContext,bad,id(bad),128).bitmap != null)
            check(server.requestCount == 11)
            val corrupt=File(targetContext.cacheDir,"corrupt-${UUID.randomUUID()}.png").apply { writeText("not a valid image") }
            val recovered=server.url("/object/own-corrupt.png").toString()
            var discarded=false
            try {
                server.enqueue(response())
                check(pipeline.load(targetContext,recovered,id(recovered),128,corrupt) { discarded=true;corrupt.delete() }.bitmap!=null)
                check(discarded&&!corrupt.exists()&&server.requestCount==12) { "Corrupt own copy blocked a valid remote image" }
            } finally { corrupt.delete() }
            File(targetContext.cacheDir,"media-pipeline-result.txt").writeText(MediaMetrics.report().joinToString("\n"))
            // 下一次 instrumentation 可在杀进程后只读此磁盘缓存，验证真实进程重启。
            File(targetContext.filesDir,"media-restart-fixture.txt").writeText("${directory.name}\n$address\n${id()}\n")
        } finally { pipeline.close(); client.dispatcher.cancelAll(); server.shutdown() }
    }
}
