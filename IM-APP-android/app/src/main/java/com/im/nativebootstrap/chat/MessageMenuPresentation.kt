package com.im.nativebootstrap.chat

internal enum class MessageMenuAction {
    RETRY, RECONCILE, RECALL, FORWARD, QUOTE, COPY, SELECT_TEXT, SAVE_IMAGE, SAVE_VIDEO, ADD_STICKER,
    FAVORITE, PIN, REPORT, MENTION, MUTE, UNMUTE, DELETE, MULTI, KICK_AND_DELETE, KICK, PURGE,
}

internal data class MessageMenuEntry(val action:MessageMenuAction,val label:String,val wide:Boolean=false)
internal data class MessageMenuContext(
    val contentType:Int,
    val mine:Boolean,
    val group:Boolean,
    val canManage:Boolean=false,
    val canRecall:Boolean=false,
    val senderInGroup:Boolean=false,
    val muted:Boolean=false,
    val pinned:Boolean=false,
    val delivery:OutboxState?=null,
)

/** 顺序沿用旧端；未确认的待发消息只允许固定 ID 核对，明确失败才可重试。 */
internal fun messageMenuEntries(input:MessageMenuContext):List<MessageMenuEntry> = buildList {
    fun item(action:MessageMenuAction,label:String,wide:Boolean=false) { add(MessageMenuEntry(action,label,wide)) }
    val pending=input.delivery in setOf(OutboxState.PENDING,OutboxState.SENDING,OutboxState.UNCERTAIN,OutboxState.FAILED)
    if(pending) {
        if(input.delivery==OutboxState.FAILED)item(MessageMenuAction.RETRY,"重新发送")
        item(MessageMenuAction.RECONCILE,"核对发送状态")
    } else {
        if(input.canRecall)item(MessageMenuAction.RECALL,"撤回")
        item(MessageMenuAction.FORWARD,"转发")
        item(MessageMenuAction.QUOTE,"引用")
    }
    when(input.contentType) {
        101,106,114 -> {
            item(MessageMenuAction.COPY,"复制")
            item(MessageMenuAction.SELECT_TEXT,"选择文字")
        }
        102 -> {
            item(MessageMenuAction.SAVE_IMAGE,"保存图片")
            if(!pending)item(MessageMenuAction.ADD_STICKER,"加入表情包")
        }
        104 -> item(MessageMenuAction.SAVE_VIDEO,"保存视频")
    }
    if(pending)return@buildList
    if(input.contentType in setOf(101,102,103,104,105,106,108,114))item(MessageMenuAction.FAVORITE,"收藏")
    item(MessageMenuAction.PIN,if(input.pinned)"取消置顶" else "置顶")
    if(!input.mine&&input.group) {
        item(MessageMenuAction.REPORT,"检举")
        if(input.senderInGroup)item(MessageMenuAction.MENTION,"@TA")
    }
    if(!input.mine&&input.canManage)item(if(input.muted)MessageMenuAction.UNMUTE else MessageMenuAction.MUTE,if(input.muted)"解除禁言" else "禁言")
    item(MessageMenuAction.DELETE,"删除")
    item(MessageMenuAction.MULTI,"多选")
    if(!input.mine&&input.canManage) {
        if(input.senderInGroup) {
            item(MessageMenuAction.KICK_AND_DELETE,"移除并删除其消息",wide=true)
            item(MessageMenuAction.KICK,"仅移除该成员",wide=true)
        } else item(MessageMenuAction.PURGE,"删除其全部消息",wide=true)
    }
}
