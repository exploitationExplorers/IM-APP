package com.im.nativebootstrap

/** 按用户滚动需求预取；新页推进后可继续，同一游标的状态回调不能重复请求。 */
internal data class HistoryLoadSignal(val scrolling:Boolean,val awayFromLatest:Boolean,val nearOldest:Boolean,val loading:Boolean,val end:Boolean,val progress:Long=0,val messageCount:Int=0)

internal class HistoryLoadGate {
    private var requestedProgress:Long?=null
    private var demand=false
    private var previousScrolling=false
    private var lastCount=-1
    private var emptyPages=0
    fun shouldLoad(value:HistoryLoadSignal):Boolean {
        val gestureStarted=value.scrolling&&!previousScrolling
        previousScrolling=value.scrolling
        if(!value.nearOldest||!value.awayFromLatest) { demand=false;requestedProgress=null;emptyPages=0;return false }
        if(value.scrolling)demand=true
        if(gestureStarted) { demand=true;emptyPages=0;requestedProgress=null }
        if(!demand||value.loading||value.end||requestedProgress==value.progress)return false
        // 被边界过滤的空页最多自动续取三次，避免一次滑动扫完整个历史库。
        if(lastCount==value.messageCount) { if(emptyPages>=3)return false;emptyPages++ } else emptyPages=0
        lastCount=value.messageCount
        requestedProgress=value.progress
        return true
    }
}
