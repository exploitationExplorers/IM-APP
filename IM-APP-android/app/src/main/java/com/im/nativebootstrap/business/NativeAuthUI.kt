package com.im.nativebootstrap.business

import androidx.compose.foundation.*
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import kotlin.math.abs
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.im.nativebootstrap.BootstrapViewModel
import com.im.nativebootstrap.R
import com.im.nativebootstrap.NativeNotices
import kotlinx.coroutines.delay

@Composable fun NativeAuthPage(mode:String,model:BootstrapViewModel,endpoint:String,back:()->Unit,legal:(String)->Unit) {
    val state by model.state.collectAsStateWithLifecycle()
    val register=mode=="register"
    var country by remember(mode){mutableStateOf("+86")};var countryMenu by remember{mutableStateOf(false)}
    var phone by remember(mode){mutableStateOf("")};var code by remember(mode){mutableStateOf("")};var password by remember(mode){mutableStateOf("")};var confirm by remember(mode){mutableStateOf("")}
    var agreed by remember(mode){mutableStateOf(false)};var reveal by remember{mutableStateOf(false)};var step by remember(mode){mutableStateOf(1)}
    var countdown by remember(mode){mutableIntStateOf(0)};var sending by remember{mutableStateOf(false)};var note by remember(mode){mutableStateOf("")};var resetBusy by remember{mutableStateOf(false)}
    LaunchedEffect(note){if(note.isNotBlank()){NativeNotices.show(note);note=""}}
    LaunchedEffect(countdown){if(countdown>0){delay(1000);countdown--}}
    Column(Modifier.fillMaxSize().drawBehind {
        val dx=-0.559193f;val dy=-0.829038f
        val extent=(abs(size.width*dx)+abs(size.height*dy))/2f
        val center=Offset(size.width/2f,size.height/2f)
        drawRect(Brush.linearGradient(colorStops=arrayOf(0.0661f to Color(0xFF2F9DE2),0.3526f to Color(0xFF1C41C7),0.9313f to Color(0xFF0C1B54)),start=center-Offset(dx*extent,dy*extent),end=center+Offset(dx*extent,dy*extent)))
    }.systemBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal=28.dp)) {
        Text("‹",Modifier.padding(top=12.dp).clickable{if(!register&&step==2)step=1 else back()},fontSize=32.sp,color=Color.White)
        Column(Modifier.fillMaxWidth().widthIn(max=400.dp),horizontalAlignment=Alignment.CenterHorizontally) {
            Spacer(Modifier.height(20.dp));Image(painterResource(R.drawable.uni_logo),"易可聊",Modifier.size(56.dp).clip(RoundedCornerShape(15.dp)))
            Text(if(register)"注册" else if(step==1)"忘记密码" else "设置新密码",Modifier.padding(top=20.dp,bottom=28.dp),fontSize=26.sp,color=Color.White,fontWeight=FontWeight.Bold)
            if(register||step==1) {
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(10.dp)) {
                    Box {Box(Modifier.width(78.dp).height(52.dp).clip(RoundedCornerShape(12.dp)).background(Color(0xFFF8FAFC)).clickable{countryMenu=true},contentAlignment=Alignment.Center){Text("$country ▾",fontSize=15.sp)}
                        DropdownMenu(countryMenu,{countryMenu=false}){listOf("中国" to "+86","中国香港" to "+852","美国" to "+1","新加坡" to "+65","马来西亚" to "+60").forEach{(name,value)->DropdownMenuItem(text={Text("$name $value")},onClick={country=value;countryMenu=false})}}
                    }
                    AuthField(phone,{phone=it.filter(Char::isDigit).take(15)},"请输入手机号码",Modifier.weight(1f),keyboard=KeyboardType.Phone)
                }
                Spacer(Modifier.height(16.dp))
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color(0xFFF8FAFC)),verticalAlignment=Alignment.CenterVertically){AuthField(code,{code=it.filter(Char::isDigit).take(6)},"请输入验证码",Modifier.weight(1f),keyboard=KeyboardType.Number);Text(if(countdown>0)"${countdown}s" else if(sending)"发送中" else "获取验证码",Modifier.clickable(enabled=countdown==0&&!sending){
                    when {register&&!agreed->note="请先阅读并同意用户协议与隐私政策";!phoneValid(country,phone)->note="请输入正确的手机号码";else->{sending=true;model.authRequest(endpoint,"/auth/sms/send",obj("countryCode" to country,"phone" to phone,"scene" to if(register)"register" else "reset")){result->sending=false;result.fold({value->countdown=if(value.isJsonObject)value.asJsonObject.text("retryAfterSec").toIntOrNull()?:60 else 60;note="验证码已发送"},{error->note=error.message?:"验证码发送失败"})}}}
                }.padding(horizontal=14.dp),fontSize=13.sp,color=Color(0xFF0A2FC2))}
            }
            if(register||step==2) {
                Spacer(Modifier.height(16.dp));AuthField(password,{password=it},if(register)"设置登录密码（至少 6 位）" else "请输入新密码",secret=!reveal)
                if(register){Spacer(Modifier.height(16.dp));AuthField(confirm,{confirm=it},"再次确认密码",secret=!reveal)}
                Text(if(reveal)"隐藏密码" else "显示密码",Modifier.align(Alignment.End).clickable{reveal=!reveal}.padding(vertical=10.dp),fontSize=12.sp,color=Color.White)
            }
            if(register) {
                Row(Modifier.fillMaxWidth().padding(vertical=18.dp),verticalAlignment=Alignment.CenterVertically){Box(Modifier.size(18.dp).clip(CircleShape).border(1.dp,Color.White,CircleShape).background(if(agreed)Color.White else Color.Transparent).clickable{agreed=!agreed},contentAlignment=Alignment.Center){if(agreed)Text("✓",color=Color(0xFF0A2FC2),fontSize=12.sp)};Text(" 我已阅读并同意 ",fontSize=11.sp,color=Color.White);Text("用户协议",Modifier.clickable{legal("agreement")},fontSize=11.sp,color=Color.White);Text(" 和 ",fontSize=11.sp,color=Color.White);Text("隐私政策",Modifier.clickable{legal("privacy")},fontSize=11.sp,color=Color.White)}
            }
            Box(Modifier.fillMaxWidth().height(50.dp).clip(RoundedCornerShape(12.dp)).background(Color.White).clickable(enabled=!state.busy&&!resetBusy){
                when {
                    register&&!agreed->note="请先阅读并同意用户协议与隐私政策"
                    !phoneValid(country,phone)->note="请输入正确的手机号码"
                    code.isBlank()->note="请输入验证码"
                    !register&&step==1->step=2
                    password.length<6->note="请设置至少 6 位密码"
                    register&&password!=confirm->note="两次输入的密码不一致"
                    register->{model.login(endpoint,country,phone,password,true,code);password="";confirm=""}
                    else->{resetBusy=true;model.authRequest(endpoint,"/auth/password/reset",obj("phone" to phone,"countryCode" to country,"code" to code,"password" to password)){result->resetBusy=false;result.fold({password="";note="密码已重置，请使用新密码登录";back()},{error->note=error.message?:"重置失败";if(note.contains("验证码")){step=1;code=""}})}}
                }
            },contentAlignment=Alignment.Center){Text(if(state.busy||resetBusy)"提交中…" else if(register)"注册" else if(step==1)"下一步" else "确认",fontSize=16.sp,color=Color(0xFF0A2FC2),fontWeight=FontWeight.Medium)}
            Spacer(Modifier.height(36.dp))
        }
    }
}
private fun phoneValid(country:String,phone:String)=when(country){"+86"->Regex("1\\d{10}").matches(phone);"+852","+65"->Regex("\\d{8}").matches(phone);"+1"->Regex("\\d{10}").matches(phone);else->Regex("\\d{9,10}").matches(phone)}
@Composable private fun AuthField(value:String,change:(String)->Unit,hint:String,modifier:Modifier=Modifier.fillMaxWidth(),secret:Boolean=false,keyboard:KeyboardType=KeyboardType.Text) {
    Box(modifier.height(52.dp).clip(RoundedCornerShape(12.dp)).background(Color(0xFFF8FAFC)).padding(horizontal=16.dp),contentAlignment=Alignment.CenterStart){BasicTextField(value,change,Modifier.fillMaxWidth(),singleLine=true,textStyle=TextStyle(fontSize=15.sp,color=Color(0xFF212121)),cursorBrush=SolidColor(Color(0xFF0A2FC2)),visualTransformation=if(secret)PasswordVisualTransformation() else VisualTransformation.None,keyboardOptions=KeyboardOptions(keyboardType=keyboard),decorationBox={inner->Box {if(value.isEmpty())Text(hint,fontSize=15.sp,color=Color(0xFF636E86));inner()}})}
}
