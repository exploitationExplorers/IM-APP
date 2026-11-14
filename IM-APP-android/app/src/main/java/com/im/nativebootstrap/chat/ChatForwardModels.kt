package com.im.nativebootstrap.chat

data class ChatForwardTarget(
    val id:String,val name:String,val kind:String,val avatar:String="",
    val businessUserId:String="",val businessGroupId:String="",val imGroupId:String="",val tagId:String="",
)
data class ChatForwardPage(val items:List<ChatForwardTarget>,val nextCursor:String="",val nextOffset:Int=0,val end:Boolean=true,val total:Int=0)
data class ChatForwardSelection(val targets:List<ChatForwardTarget>,val allFriends:Boolean=false,val excludedUserIds:Set<String> = emptySet())
data class ChatForwardResult(val queued:Boolean,val messages:Int,val targets:Int,val taskIds:List<String> = emptyList())
data class ChatForwardProgress(val id:String,val status:String,val total:Int,val success:Int,val failed:Int,val pending:Int)
