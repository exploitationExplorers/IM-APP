/**
 * @openim/protocol@0.0.7 只发布了打包后的 lib/index.js，lib/pb/** 下面仅有类型声明；
 * 而 @openim/client-sdk 按深路径 `@openim/protocol/lib/pb/sdkws/sdkws` 引 PullOrder，
 * 打包时会解析失败。vite.config.ts 把那条深路径别名到这里，从包根取同一个枚举。
 */
import { SdkWsProto } from '@openim/protocol'

export const PullOrder = SdkWsProto.PullOrder
