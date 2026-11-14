package com.im.nativebootstrap.business

import java.time.Instant
import java.time.ZoneId
import java.time.temporal.ChronoUnit

private fun contactInstant(value:String)=runCatching{Instant.parse(value)}.getOrNull()

fun contactEventTime(value:String,now:Instant=Instant.now(),zone:ZoneId=ZoneId.systemDefault()):String {
    val time=contactInstant(value)?.atZone(zone)?:return ""
    val today=now.atZone(zone).toLocalDate()
    val days=ChronoUnit.DAYS.between(time.toLocalDate(),today)
    val day=when{
        days<=0->"今天"
        days==1L->"昨天"
        days<7->"星期"+"一二三四五六日"[time.dayOfWeek.value-1]
        time.year==today.year->"${time.monthValue}月${time.dayOfMonth}日"
        else->"${time.year}年${time.monthValue}月${time.dayOfMonth}日"
    }
    val hour=(time.hour%12).takeIf{it!=0}?:12
    return "$day ${if(time.hour<12)"上午" else "下午"} $hour:${time.minute.toString().padStart(2,'0')}"
}

fun contactLastSeen(value:String,now:Instant=Instant.now()):String {
    val time=contactInstant(value)?:return ""
    val seconds=ChronoUnit.SECONDS.between(time,now).coerceAtLeast(0)
    return when{
        seconds<60->"刚刚在线"
        seconds<3600->"${seconds/60}分钟前在线"
        seconds<86400->"今天在线"
        seconds<172800->"昨天在线"
        seconds<604800->"1周内有上线"
        seconds<2592000->"1个月内有上线"
        else->"很久未上线"
    }
}
