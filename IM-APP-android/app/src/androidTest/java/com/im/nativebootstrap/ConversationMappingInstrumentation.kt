package com.im.nativebootstrap

import android.app.Activity
import android.app.Application
import android.app.Instrumentation
import android.os.Bundle
import android.os.Looper
import android.os.SystemClock
import com.google.gson.Gson
import com.im.nativebootstrap.chat.*
import io.openim.android.sdk.models.ConversationInfo
import io.openim.android.sdk.models.Message
import java.io.File
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** 同一合成消息比较旧主线程映射与生产异步映射，不登录、不调用后端。 */
class ConversationMappingInstrumentation:Instrumentation() {
    override fun onCreate(arguments:Bundle?) {super.onCreate(arguments);start()}
    override fun onStart() {
        val output=Bundle()
        val gateway=OpenIMGateway(targetContext.applicationContext as Application)
        try {
            val gson=Gson()
            val fixtures=(1..1500).map {index->gson.fromJson("{}",ConversationInfo::class.java).apply {
                conversationID="si_mapping-$index";conversationType=1;userID="mapping-peer-$index";showName="Synthetic $index"
                latestMsgSendTime=1_800_000_000_000L+index;unreadCount=index%5;isPinned=index%79==0;recvMsgOpt=0;faceURL="";ex=""
                latestMsg="""{"clientMsgID":"mapping-message-$index","sendID":"synthetic-sender","sendTime":1800000000000,"createTime":1800000000000,"contentType":102,"status":2,"seq":$index,"pictureElem":{"sourcePicture":{"url":"https://example.invalid/image-$index.jpg","width":720,"height":1280}},"senderNickname":"Synthetic sender"}"""
            }}
            // 对应改动前的图片消息分支：同一 latestMsg 分别为摘要、seq、完整模型解析 3 次。
            fun previous(info:ConversationInfo):ChatConversation {
                val preview=if(gson.fromJson(info.latestMsg,Message::class.java).contentType==102)"[图片]" else ""
                val seq=gson.fromJson(info.latestMsg,Message::class.java).seq.toLong()
                val message=gson.fromJson(info.latestMsg,Message::class.java)
                val latest=ChatMessage(message.clientMsgID.orEmpty(),"[图片]",false,message.sendTime,message.status,message.seq.toLong(),gson.toJson(message),message.senderNickname.orEmpty())
                return ChatConversation(ChatTarget(info.conversationID,info.conversationType,info.userID.orEmpty(),info.groupID.orEmpty()),info.showName,preview,info.latestMsgSendTime,info.unreadCount,info.isPinned,info.faceURL.orEmpty(),seq,info.recvMsgOpt!=0,null,latest)
            }
            fixtures.take(120).map(::previous)
            var baseline=emptyList<ChatConversation>();var mainBaselineNs=0L
            runOnMainSync {val start=System.nanoTime();baseline=fixtures.map(::previous);mainBaselineNs=System.nanoTime()-start}
            val queueField=OpenIMGateway::class.java.getDeclaredField("conversationMapping").apply {isAccessible=true}
            val queue=queueField.get(gateway) as ConversationMappingQueue
            val owner=queue.owner()!!
            val method=OpenIMGateway::class.java.getDeclaredMethod("enqueueConversations",ConversationMappingQueue.Owner::class.java,List::class.java,kotlin.jvm.functions.Function1::class.java).apply {isAccessible=true}
            val done=CountDownLatch(1);var actual=emptyList<ChatConversation>();var callbackMain=true;var end=0L
            val callback:(List<ChatConversation>)->Unit={rows->actual=rows;callbackMain=Looper.myLooper()==Looper.getMainLooper();end=System.nanoTime();done.countDown()}
            var enqueued=0L;var enqueueNs=0L
            runOnMainSync {enqueued=System.nanoTime();method.invoke(gateway,owner,fixtures,callback);enqueueNs=System.nanoTime()-enqueued}
            check(done.await(30,TimeUnit.SECONDS)) {"Production conversation mapping timed out"}
            check(!callbackMain) {"Model mapping completion still blocked the main thread"}
            check(actual==baseline) {"Optimized mapping changed the fixture models"}
            check(enqueueNs<mainBaselineNs) {"Main enqueue did not reduce work: $enqueueNs >= $mainBaselineNs"}
            val metrics="rows=1500\nbaseline_main_ms=${mainBaselineNs/1_000_000.0}\noptimized_main_enqueue_ms=${enqueueNs/1_000_000.0}\noptimized_worker_and_queue_ms=${(end-enqueued)/1_000_000.0}\ncallback_main=$callbackMain\nmodels_equal=true\nscope=synthetic same image fixtures; old mapping branch reproduced in test, actual new production enqueue; not real account or device benchmark\n"
            File(targetContext.cacheDir,"conversation-mapping-metrics.txt").writeText(metrics)
            output.putString("conversationMapping","passed:1500 production mappings off main; exact models match prior three-parse fixture mapping")
            output.putString("metrics",metrics)
            gateway.shutdown()
            finish(Activity.RESULT_OK,output)
        } catch(error:Throwable) {
            gateway.shutdown()
            output.putString("conversationMapping","failed:${error.javaClass.simpleName}:${error.message}")
            finish(Activity.RESULT_CANCELED,output)
        }
    }
}
