package com.im.nativebootstrap

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.im.nativebootstrap.core.BusinessLoginFlow
import com.im.nativebootstrap.core.BusinessSession
import com.im.nativebootstrap.data.APIException
import com.im.nativebootstrap.data.BusinessProfile
import com.im.nativebootstrap.data.NativeAPI
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.UUID

data class SampleMessage(val id: String, val text: String, val mine: Boolean)
data class BootstrapState(
    val busy: Boolean = false,
    val notice: String = "",
    val authenticated: Boolean = false,
    val profile: BusinessProfile? = null,
    val profileWarning: String? = null,
    val sample: Boolean = false,
    val chatOpen: Boolean = false,
    val messages: List<SampleMessage> = emptyList(),
)

class BootstrapViewModel(application: Application) : AndroidViewModel(application) {
    private val mutableState = MutableStateFlow(BootstrapState())
    val state = mutableState.asStateFlow()
    private val businessSession = BusinessSession()
    private val loginFlow = BusinessLoginFlow(businessSession)
    private var operation = 0L
    private var loginJob: Job? = null
    private val deviceId by lazy { DeviceIdentity.get(application) }

    fun login(baseURL: String, country: String, phone: String, secret: String, password: Boolean) {
        if (mutableState.value.busy) return
        operation += 1
        val activeOperation = operation
        val attempt = businessSession.beginLogin()
        mutableState.value = BootstrapState(busy = true, notice = "正在登录")
        loginJob = viewModelScope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    loginFlow.login(attempt, NativeAPI(baseURL), country, phone, secret, deviceId, password)
                }
                if (activeOperation != operation || result == null) return@launch
                mutableState.value = BootstrapState(authenticated = true, profile = result.profile, profileWarning = result.profileWarning)
            } catch (_: kotlinx.coroutines.CancellationException) {
                // 退出/换号先使业务代次失效；迟到网络结果不会进入新账号。
            } catch (error: Exception) {
                if (activeOperation != operation) return@launch
                val message = if (error is APIException || error is IllegalArgumentException) error.message else "请求未完成，请检查网络后重试。"
                businessSession.logout()
                mutableState.value = BootstrapState(notice = message ?: "请求未完成")
            } finally {
                if (activeOperation == operation) loginJob = null
            }
        }
    }

    fun sendSms(baseURL: String, country: String, phone: String) {
        if (mutableState.value.busy) return
        operation += 1
        val activeOperation = operation
        mutableState.value = BootstrapState(busy = true, notice = "正在申请验证码")
        loginJob = viewModelScope.launch {
            try {
                val receipt = withContext(Dispatchers.IO) { NativeAPI(baseURL).sendSms(country, phone, deviceId) }
                if (activeOperation == operation) mutableState.value = BootstrapState(notice = "申请已受理，请 ${receipt.retryAfterSec} 秒后再试；验证码有效期 ${receipt.expiresIn} 秒。")
            } catch (_: kotlinx.coroutines.CancellationException) {
            } catch (_: Exception) {
                if (activeOperation == operation) mutableState.value = BootstrapState(notice = "验证码申请失败，请检查网络和手机号。")
            } finally {
                if (activeOperation == operation) loginJob = null
            }
        }
    }

    fun startSample() {
        logout()
        mutableState.value = BootstrapState(sample = true, notice = "本地样例 · 不会向任何用户发送消息")
    }
    fun openChat() {
        if (!mutableState.value.sample) return
        mutableState.value = mutableState.value.copy(chatOpen = true, messages = listOf(SampleMessage("welcome", "这里可以验证文本列表与输入交互。内容仅存于当前内存，退出样例即清除。", false)))
    }
    fun closeChat() { mutableState.value = mutableState.value.copy(chatOpen = false, messages = emptyList()) }
    fun sendSample(text: String) {
        if (!mutableState.value.sample || !mutableState.value.chatOpen || text.isBlank()) return
        mutableState.value = mutableState.value.copy(messages = mutableState.value.messages + SampleMessage(UUID.randomUUID().toString(), text.trim(), true))
    }
    fun logout() {
        operation += 1
        loginJob?.cancel()
        loginJob = null
        businessSession.logout()
        mutableState.value = BootstrapState()
    }
    override fun onCleared() {
        logout()
        super.onCleared()
    }
}
