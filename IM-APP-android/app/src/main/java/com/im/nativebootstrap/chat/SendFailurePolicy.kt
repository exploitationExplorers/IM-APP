package com.im.nativebootstrap.chat

/** 固定 Core 的本地参数/资源校验拒绝，发生于网络提交前；超时、未知及重复消息绝不据此重发。 */
object SendFailurePolicy {
    fun rejectedBeforeSubmission(code:Int?)=code in setOf(10002,10004,10100,10101,10200,10205,10302,10400,10401)
}
