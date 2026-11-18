#import "NativeOpenIMBridge.h"
#import <OpenIMSDK/OpenIMSDK.h>
#import <MJExtension/MJExtension.h>
#import <OpenIMSDK/CallbackProxy.h>
@import OpenIMCore;

@interface NativeOpenIMBridge () <OIMConversationListener, OIMAdvancedMsgListener, OIMCustomBusinessListener>
@property(nonatomic, copy, nullable) NativeIMEvent events;
@property(nonatomic, assign) BOOL alive;
@property(nonatomic, assign) BOOL loginInFlight;
@property(nonatomic, assign) NSUInteger pinSession;
@property(nonatomic, strong) NSUUID *pinOperation;
@property(nonatomic, assign) NSTimeInterval pinReadDeadline;
@property(nonatomic, assign) BOOL pinWritePending;
@end

@implementation NativeOpenIMBridge

static NSError *NativeError(NSInteger code) {
    // 不向界面泄漏 SDK 原始 JSON、token 或后端地址。
    return [NSError errorWithDomain:@"NativeOpenIM" code:code userInfo:@{NSLocalizedDescriptionKey:
        [NSString stringWithFormat:@"聊天请求失败（%ld），请稍后重试。", (long)code]}];
}

static NSError *NativeReadError(NSInteger code, NSString *message, NSString *operation) {
    NSString *text = message.lowercaseString ?: @"";
    NSString *reason = @"unknown";
    if (code == 1506) reason = @"kicked";
    else if ((code >= 1501 && code <= 1505) || code == 1507) reason = @"authentication";
    else if ([text containsString:@"not logged in"] || [text containsString:@"not login"]) reason = @"notLoggedIn";
    else if ([text containsString:@"not initialized"] || [text containsString:@"not init"]) reason = @"notInitialized";
    else if ([text containsString:@"token"] && ([text containsString:@"expired"] || [text containsString:@"invalid"])) reason = @"authentication";
    else if (code == 10004 || [text containsString:@"resource load"] || [text containsString:@"initialization incomplete"]) reason = @"resourceNotReady";
    else if ([text containsString:@"database is locked"] || [text containsString:@"database is busy"]) reason = @"storageBusy";
    else if ([text containsString:@"no such table"] || [text containsString:@"no such column"]) reason = @"storageSchema";
    else if ([text containsString:@"database disk image is malformed"] || [text containsString:@"file is not a database"]) reason = @"storageCorrupt";
    else if ([text containsString:@"permission denied"] || [text containsString:@"unable to open database"]) reason = @"storageAccess";
    else if ([text containsString:@"no space left"] || [text containsString:@"database or disk is full"]) reason = @"storageFull";
    else if ([text containsString:@"deadline exceeded"] || [text containsString:@"timeout"] || [text containsString:@"timed out"]) reason = @"timeout";
    else if ([text containsString:@"network"] || [text containsString:@"websocket"] || [text containsString:@"connection refused"]) reason = @"network";
    // 不保存原始 message，只传递固定操作名和错误分类。
    NSMutableDictionary *info = [NativeError(code).userInfo mutableCopy];
    info[@"NativeIMReason"] = reason; info[@"NativeIMOperation"] = operation;
    return [NSError errorWithDomain:@"NativeOpenIM" code:code userInfo:info];
}

static NSInteger CredentialErrorCode(NSString *message) {
    // 仅提取白名单错误码，绝不将原始消息（可能带票据）传入 Swift 或持久化。
    NSRegularExpression *pattern = [NSRegularExpression regularExpressionWithPattern:@"(?:errCode|code)[\\\"']?\\s*[:=]\\s*(150[1-7])\\b" options:NSRegularExpressionCaseInsensitive error:nil];
    NSTextCheckingResult *match = [pattern firstMatchInString:message ?: @"" options:0 range:NSMakeRange(0, message.length)];
    return match.numberOfRanges > 1 ? [[message substringWithRange:[match rangeAtIndex:1]] integerValue] : 0;
}

static NSString *MessageText(OIMMessageInfo *message) {
    NSString *text;
    switch (message.contentType) {
        case OIMMessageContentTypeText: text = message.textElem.content ?: @""; break;
        case OIMMessageContentTypeImage: text = @"[图片]"; break;
        case OIMMessageContentTypeAudio: text = @"[语音]"; break;
        case OIMMessageContentTypeVideo: text = @"[视频]"; break;
        case OIMMessageContentTypeFile: text = @"[文件]"; break;
        case OIMMessageContentTypeCard: text = [NSString stringWithFormat:@"[名片] %@", message.cardElem.nickname ?: @""]; break;
        case OIMMessageContentTypeMerge: text = message.mergeElem.title ?: @"聊天记录"; break;
        case OIMMessageContentTypeQuote: text = message.quoteElem.text.length ? message.quoteElem.text : @"[引用消息]"; break;
        case OIMMessageContentTypeAt: text = [message.atTextElem.mj_keyValues[@"text"] isKindOfClass:NSString.class] ? message.atTextElem.mj_keyValues[@"text"] : @"[@消息]"; break;
        case OIMMessageContentTypeAdvancedText: text = message.advancedTextElem.text ?: @""; break;
        case OIMMessageContentTypeRevoke: text = @"[消息已撤回]"; break;
        default: text = message.contentType >= 1000 ? @"[系统通知]" : @"[此类型消息待支持]"; break;
    }
    if (message.status == OIMMessageStatusRevoke) text = @"[消息已撤回]";
    return text;
}

static NSDictionary *MessageData(OIMMessageInfo *message) {
    NSString *text = MessageText(message);
    NSString *url = @"", *thumbnail = @"", *local = @"", *filename = @"";
    NSInteger duration = 0, mediaBytes = 0;
    if (message.contentType == OIMMessageContentTypeImage) {
        url = message.pictureElem.sourcePicture.url.length ? message.pictureElem.sourcePicture.url : (message.pictureElem.bigPicture.url ?: @"");
        if (!url.length) url = message.pictureElem.snapshotPicture.url ?: @"";
        thumbnail = message.pictureElem.snapshotPicture.url.length ? message.pictureElem.snapshotPicture.url : url; local = message.pictureElem.sourcePath ?: @"";
    } else if (message.contentType == OIMMessageContentTypeVideo) {
        url = message.videoElem.videoUrl ?: @""; thumbnail = message.videoElem.snapshotUrl ?: @"";
        local = message.videoElem.videoPath ?: @""; duration = message.videoElem.duration; mediaBytes = message.videoElem.videoSize;
    } else if (message.contentType == OIMMessageContentTypeAudio) {
        url = message.soundElem.sourceUrl ?: @""; local = message.soundElem.soundPath ?: @""; duration = message.soundElem.duration;
    } else if (message.contentType == OIMMessageContentTypeFile) {
        url = message.fileElem.sourceUrl ?: @""; local = message.fileElem.filePath ?: @""; filename = message.fileElem.fileName ?: @""; mediaBytes = message.fileElem.fileSize;
    }
    return @{@"id": message.clientMsgID ?: @"", @"senderID": message.sendID ?: @"",
             @"recvID": message.recvID ?: @"", @"groupID": message.groupID ?: @"",
             @"sessionType": @(message.sessionType), @"text": text,
             @"timestamp": @((int64_t)(message.sendTime > 0 ? message.sendTime : message.createTime)),
             @"status": @(message.status), @"contentType": @(message.contentType),
             @"seq": @(message.seq), @"isRead": @(message.isRead), @"avatar": message.senderFaceUrl ?: @"", @"senderName": message.senderNickname ?: @"",
             @"mediaURL": url, @"thumbnail": thumbnail, @"localPath": local, @"filename": filename, @"duration": @(duration), @"mediaBytes": @(mediaBytes),
             @"serialized": message.mj_JSONString ?: @""};
}

static NSArray *MessageList(NSArray<OIMMessageInfo *> *list) {
    NSMutableArray *items = [NSMutableArray new];
    for (OIMMessageInfo *message in list) { if (message.clientMsgID.length) [items addObject:MessageData(message)]; }
    return items;
}

static NSDictionary *ConversationData(OIMConversationInfo *conversation) {
    return @{@"id": conversation.conversationID ?: @"", @"type": @(conversation.conversationType),
             @"target": (conversation.conversationType == OIMConversationTypeC2C ? conversation.userID : conversation.groupID) ?: @"",
             @"title": conversation.showName ?: @"", @"unread": @(conversation.unreadCount),
             @"ex": conversation.ex ?: @"",
             @"avatar": conversation.faceURL ?: @"", @"muted": @(conversation.recvMsgOpt != 0),
             @"latestMessageID": conversation.latestMsg.clientMsgID ?: @"", @"latestSeq": @(conversation.latestMsg.seq), @"latestSender": conversation.latestMsg.sendID ?: @"",
             @"timestamp": @(conversation.latestMsgSendTime), @"pinned": @(conversation.isPinned),
             @"preview": conversation.latestMsg.status == OIMMessageStatusRevoke || conversation.latestMsg.contentType == OIMMessageContentTypeRevoke
                 ? @"[撤回]" : (conversation.latestMsg ? MessageText(conversation.latestMsg) : @"暂无消息")};
}

static NSArray *ConversationList(NSArray<OIMConversationInfo *> *list) {
    NSMutableArray *items = [NSMutableArray new];
    for (OIMConversationInfo *conversation in list) {
        if (conversation.conversationID.length) [items addObject:ConversationData(conversation)];
    }
    return items;
}

- (void)emit:(NSString *)name payload:(NSDictionary *)payload {
    dispatch_async(dispatch_get_main_queue(), ^{
        if (self.alive && self.events) self.events(name, payload);
    });
}

- (BOOL)initializeAPI:(NSString *)api ws:(NSString *)ws directory:(NSString *)directory events:(NativeIMEvent)events {
    NSAssert(NSThread.isMainThread, @"SDK singleton 必须在主队列串行操作");
    self.events = events;
    self.alive = YES;
    OIMInitConfig *config = [OIMInitConfig new];
    config.platform = iPhone; // iPad 亦使用本次服务签发的平台 1，禁止默认自动变成 9。
    config.apiAddr = api;
    config.wsAddr = ws;
    config.dataDir = [directory stringByAppendingString:@"/"];
    config.logFilePath = config.dataDir;
    config.logLevel = 0;
    config.isLogStandardOutput = NO;
    __weak typeof(self) weak = self;
    BOOL initialized = [OIMManager.manager initSDKWithConfig:config
        onConnecting:^{ [weak emit:@"connecting" payload:@{}]; }
        onConnectFailure:^(NSInteger code, NSString *msg) { [weak emit:@"connectFailed" payload:@{@"code": @(code)}]; }
        onConnectSuccess:^{ [weak emit:@"connected" payload:@{}]; }
        onKickedOffline:^{ [weak emit:@"kicked" payload:@{@"code": @1506}]; }
        onUserTokenExpired:^{ [weak emit:@"tokenExpired" payload:@{@"code": @1501}]; }
        onUserTokenInvalid:^(NSString *msg) { [weak emit:@"tokenInvalid" payload:@{@"code": @(CredentialErrorCode(msg))}]; }];
    if (initialized) {
        [OIMManager.callbacker addConversationListener:self];
        [OIMManager.callbacker addAdvancedMsgListener:self];
        [OIMManager.callbacker addCustomBusinessListener:self];
    } else { self.alive = NO; }
    return initialized;
}

- (void)loginUserID:(NSString *)userID token:(NSString *)token completion:(NativeIMResult)completion {
    if (self.loginInFlight) { completion(nil, NativeReadError(-1, @"login in progress", @"login")); return; }
    self.loginInFlight = YES;
    [OIMManager.manager login:userID token:token onSuccess:^(NSString *data) {
        self.loginInFlight = NO;
        completion(@{}, nil);
    } onFailure:^(NSInteger code, NSString *msg) { self.loginInFlight = NO; completion(nil, NativeReadError(code, msg, @"login")); }];
}

- (NSInteger)loginStatus { return [OIMManager.manager getLoginStatus]; }
- (BOOL)loginPending { return self.loginInFlight; }

- (void)logout:(NativeIMResult)completion {
    self.pinSession += 1;
    self.pinOperation = nil;
    self.pinWritePending = NO;
    [OIMManager.manager logoutWithOnSuccess:^(NSString *data) { completion(@{}, nil); }
                                  onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
}

- (BOOL)shutdown {
    NSAssert(NSThread.isMainThread, @"SDK singleton 必须在主队列串行操作");
    // 固定版 Core 的 unInit 不替代 logout；旧库/线程释放前禁止重置全局实例。
    NSInteger status = [self loginStatus];
    if (self.loginInFlight || status == 2 || status == 3) return NO;
    self.alive = NO;
    self.events = nil;
    [OIMManager.callbacker removeConversationListener:self];
    [OIMManager.callbacker removeAdvancedMsgListener:self];
    [OIMManager.callbacker removeCustomBusinessListener:self];
    [OIMManager.manager unInitSDK];
    OIMManager.manager.token = nil;
    return YES;
}

- (void)conversationsOffset:(NSInteger)offset count:(NSInteger)count completion:(NativeIMResult)completion {
    [OIMManager.manager getConversationListSplitWithOffset:offset count:count onSuccess:^(NSArray<OIMConversationInfo *> *items) {
        completion(@{@"items": ConversationList(items ?: @[])}, nil);
    } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeReadError(code, msg, @"conversationPage")); }];
}

- (void)allConversations:(NativeIMResult)completion {
    [OIMManager.manager getAllConversationListWithOnSuccess:^(NSArray<OIMConversationInfo *> *items) {
        completion(@{@"items": ConversationList(items ?: @[])}, nil);
    } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeReadError(code, msg, @"conversationSnapshot")); }];
}

- (void)conversationTarget:(NSString *)target type:(NSInteger)type completion:(NativeIMResult)completion {
    if ((type != 1 && type != 3) || !target.length) { completion(nil, NativeError(-1)); return; }
    [OIMManager.manager getOneConversationWithSessionType:(OIMConversationType)type sourceID:target onSuccess:^(OIMConversationInfo *item) {
        if (!item.conversationID.length) { completion(nil, NativeError(-1)); return; }
        completion(ConversationData(item), nil);
    } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
}

- (void)historyConversation:(NSString *)conversation cursor:(NSString *)cursor count:(NSInteger)count completion:(NativeIMResult)completion {
    OIMGetAdvancedHistoryMessageListParam *request = [OIMGetAdvancedHistoryMessageListParam new];
    request.conversationID = conversation;
    request.startClientMsgID = cursor;
    request.count = count;
    request.viewType = OIMGetHistoryViewTypeHistory;
    // 官方固定版请求模型没有 lastMinSeq 属性；只用真实支持的 clientMsgID 游标。
    [OIMManager.manager getAdvancedHistoryMessageList:request onSuccess:^(OIMGetAdvancedHistoryMessageListInfo *result) {
        if (!result || result.errCode != 0) { completion(nil, NativeError(result ? result.errCode : -1)); return; }
        completion(@{@"items": MessageList(result.messageList ?: @[]), @"isEnd": @(result.isEnd), @"lastMinSeq": @(result.lastMinSeq)}, nil);
    } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
}

- (void)localHistoryConversation:(NSString *)conversation position:(NSInteger)position page:(NSInteger)page count:(NSInteger)count completion:(NativeIMResult)completion {
    if (!conversation.length || position <= 0 || page < 1 || count < 1 || count > 40) { completion(nil, NativeError(-1)); return; }
    OIMSearchParam *request = [OIMSearchParam new];
    request.conversationID = conversation; request.keywordList = @[];
    // 仅搜索官方 filterMsg 支持的类型，避免未支持类型占用 SQL 页后被过滤。
    // 这是本地预览，完整历史及结束水位仍由 advanced history 确认。
    request.messageTypeList = @[@101,@102,@103,@104,@105,@106,@107,@108,@109,@110,@114];
    request.searchTimePosition = position; request.searchTimePeriod = 0; request.pageIndex = page; request.count = count;
    [OIMManager.manager searchLocalMessages:request onSuccess:^(OIMSearchResultInfo *result) {
        if (!result) { completion(nil, NativeError(-1)); return; }
        NSMutableArray *items = [NSMutableArray new];
        NSInteger localCount = 0;
        for (OIMSearchResultItemInfo *group in result.searchResultItems) {
            if (![group.conversationID isEqualToString:conversation]) continue;
            localCount += group.messageList.count;
            for (OIMMessageInfo *message in group.messageList) {
                // 搜索不执行高级历史的阅后即焚过滤；此类消息仅由完整 SDK 通道展示。
                if (message.attachedInfoElem.isPrivateChat || !message.clientMsgID.length) continue;
                [items addObject:MessageData(message)];
            }
        }
        completion(@{@"items": items, @"localExhausted": @(localCount < count)}, nil);
    } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
}

- (NSDictionary *)createText:(NSString *)text {
    OIMMessageInfo *message = [OIMMessageInfo createTextMessage:text];
    if (!message.clientMsgID.length) return nil;
    return MessageData(message);
}

- (NSDictionary *)createCard:(NSString *)user nickname:(NSString *)nickname avatar:(NSString *)avatar businessUser:(NSString *)businessUser {
    OIMCardElem *card = [OIMCardElem new]; card.userID = user; card.nickname = nickname; card.faceURL = avatar;
    card.ex = [@{@"businessUserId": businessUser} mj_JSONString];
    OIMMessageInfo *message = [OIMMessageInfo createCardMessage:card];
    return message.clientMsgID.length ? MessageData(message) : nil;
}

- (NSDictionary *)createAt:(NSString *)text users:(NSArray<NSDictionary *> *)users all:(BOOL)all quoted:(NSString *)quoted {
    OIMMessageInfo *quote = quoted.length ? [OIMMessageInfo mj_objectWithKeyValues:quoted] : nil;
    OIMMessageInfo *message;
    if (all) message = [OIMMessageInfo createTextAtAllMessage:text displayText:@"@所有人" message:quote];
    else {
        NSMutableArray *ids = [NSMutableArray new], *infos = [NSMutableArray new];
        for (NSDictionary *user in users) { if (![user[@"id"] isKindOfClass:NSString.class]) continue; OIMAtInfo *info = [OIMAtInfo new]; info.atUserID = user[@"id"]; info.groupNickname = [user[@"name"] isKindOfClass:NSString.class] ? user[@"name"] : @""; [ids addObject:info.atUserID]; [infos addObject:info]; }
        message = [OIMMessageInfo createTextAtMessage:text atUsersID:ids atUsersInfo:infos message:quote];
    }
    return message.clientMsgID.length ? MessageData(message) : nil;
}

- (NSDictionary *)createCustom:(NSString *)data {
    OIMMessageInfo *message = [OIMMessageInfo createCustomMessage:data extension:@"" description:@""];
    return message.clientMsgID.length ? MessageData(message) : nil;
}

- (void)patchPin:(NSString *)conversation payload:(NSString *)payload completion:(NativeIMResult)completion {
    NSTimeInterval now = NSProcessInfo.processInfo.systemUptime;
    if (self.pinOperation && (self.pinWritePending || now < self.pinReadDeadline)) {
        completion(nil, [NSError errorWithDomain:@"NativeMessagePin" code:2 userInfo:@{NSLocalizedDescriptionKey:@"上一笔置顶操作仍在确认，请刷新后重试。"}]);
        return;
    }
    NSUUID *operation = NSUUID.UUID;
    self.pinOperation = operation;
    self.pinReadDeadline = now + 24;
    NSUInteger session = self.pinSession;
    NativeIMResult finish = ^(NSDictionary *result, NSError *error) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if ([self.pinOperation isEqual:operation]) {
                self.pinOperation = nil;
                self.pinWritePending = NO;
            }
            completion(result, error);
        });
    };
    [OIMManager.manager getMultipleConversation:@[conversation] onSuccess:^(NSArray<OIMConversationInfo *> *items) {
        dispatch_async(dispatch_get_main_queue(), ^{
            if (!self.alive || session != self.pinSession || ![self.pinOperation isEqual:operation] ||
                NSProcessInfo.processInfo.systemUptime >= self.pinReadDeadline) {
                finish(nil, NativeError(-1));
                return;
            }
            OIMConversationInfo *current = items.firstObject;
            if (!current || ![current.conversationID isEqualToString:conversation]) { finish(nil, NativeError(-1)); return; }
            NSDictionary *original = [current.ex mj_JSONObject];
            NSMutableDictionary *extra = [original isKindOfClass:NSDictionary.class] ? [original mutableCopy] : [NSMutableDictionary new];
            NSDictionary *decoded = [payload mj_JSONObject];
            if (![decoded isKindOfClass:NSDictionary.class]) { finish(nil, NativeError(-1)); return; }
            NSMutableDictionary *pinned = [decoded mutableCopy];
            id revision = extra[@"nativeMessagePinRevision"];
            int64_t stored = [revision isKindOfClass:NSNumber.class] ? [revision longLongValue] : 0;
            if ([pinned[@"requiresNewerRevision"] boolValue] && [pinned[@"pinnedAt"] longLongValue] <= stored) {
                finish(@{}, nil);
                return;
            }
            [pinned removeObjectForKey:@"requiresNewerRevision"];
            if ([pinned[@"action"] isEqual:@"unpin"]) {
                NSNumber *expected = pinned[@"expectedPinnedAt"];
                if (expected) {
                    id active = extra[@"pinnedMessage"];
                    if (![active isKindOfClass:NSDictionary.class]) { finish(nil, NativeError(-1)); return; }
                    id activeID = active[@"clientMsgID"] ?: active[@"ClientMsgID"];
                    id activeScope = active[@"scope"] ?: @"shared";
                    id activeTime = active[@"pinnedAt"] ?: @0;
                    if (![activeID isEqual:pinned[@"clientMsgID"]] || ![activeScope isEqual:pinned[@"scope"]] || ![activeTime isEqual:expected]) {
                        finish(nil, [NSError errorWithDomain:@"NativeMessagePin" code:1 userInfo:@{NSLocalizedDescriptionKey:@"置顶消息已变化，请刷新后重试。"}]);
                        return;
                    }
                }
                [extra removeObjectForKey:@"pinnedMessage"];
            } else {
                extra[@"pinnedMessage"] = pinned;
            }
            if (pinned[@"pinnedAt"]) extra[@"nativeMessagePinRevision"] = pinned[@"pinnedAt"];
            self.pinWritePending = YES;
            [OIMManager.manager setConversation:conversation req:@{@"ex": [extra mj_JSONString] ?: @""}
                onSuccess:^(NSString *data) { finish(@{}, nil); }
                onFailure:^(NSInteger code, NSString *msg) { finish(nil, NativeError(code)); }];
        });
    } onFailure:^(NSInteger code, NSString *msg) { finish(nil, NativeError(code)); }];
}

- (NSDictionary *)unpack:(NSString *)serialized {
    OIMMessageInfo *message = [OIMMessageInfo mj_objectWithKeyValues:serialized];
    return message.clientMsgID.length ? MessageData(message) : nil;
}
- (NSDictionary *)createMedia:(NSInteger)kind path:(NSString *)path filename:(NSString *)filename duration:(NSInteger)duration snapshot:(NSString *)snapshot {
    OIMMessageInfo *message;
    switch (kind) {
        case 102: message = [OIMMessageInfo createImageMessageFromFullPath:path]; break;
        case 103: message = [OIMMessageInfo createSoundMessageFromFullPath:path duration:duration]; break;
        case 104: message = [OIMMessageInfo createVideoMessageFromFullPath:path videoType:path.pathExtension duration:duration snapshotPath:snapshot]; break;
        case 105: message = [OIMMessageInfo createFileMessageFromFullPath:path fileName:filename]; break;
        default: return nil;
    }
    return message.clientMsgID.length ? MessageData(message) : nil;
}
- (NSDictionary *)createQuote:(NSString *)text serialized:(NSString *)serialized {
    OIMMessageInfo *original = [OIMMessageInfo mj_objectWithKeyValues:serialized];
    if (!original.clientMsgID.length) return nil;
    return MessageData([OIMMessageInfo createQuoteMessage:text message:original]);
}
- (NSDictionary *)createForward:(NSString *)serialized {
    OIMMessageInfo *original = [OIMMessageInfo mj_objectWithKeyValues:serialized];
    return original.clientMsgID.length ? MessageData([OIMMessageInfo createForwardMessage:original]) : nil;
}
- (void)markRead:(NSString *)conversation completion:(NativeIMResult)completion {
    [OIMManager.manager markConversationMessageAsRead:conversation onSuccess:^(NSString *data) { completion(@{}, nil); } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
}
- (void)clear:(NSString *)conversation completion:(NativeIMResult)completion {
    [OIMManager.manager clearConversationAndDeleteAllMsg:conversation onSuccess:^(NSString *data) { completion(@{}, nil); } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
}
- (void)deleteMessage:(NSString *)message conversation:(NSString *)conversation completion:(NativeIMResult)completion {
    [OIMManager.manager deleteMessageFromLocalStorage:conversation clientMsgID:message onSuccess:^(NSString *data) { completion(@{}, nil); } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
}
- (void)pin:(NSString *)conversation pinned:(BOOL)pinned completion:(NativeIMResult)completion {
    [OIMManager.manager pinConversation:conversation isPinned:pinned onSuccess:^(NSString *data) { completion(@{}, nil); } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
}
- (void)mute:(NSString *)conversation muted:(BOOL)muted completion:(NativeIMResult)completion {
    [OIMManager.manager setConversationRecvMessageOpt:conversation status:(OIMReceiveMessageOpt)(muted ? 2 : 0) onSuccess:^(NSString *data) { completion(@{}, nil); } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
}
- (void)hide:(NSString *)conversation completion:(NativeIMResult)completion {
    [OIMManager.manager hideConversation:conversation onSuccess:^(NSString *data) { completion(@{}, nil); } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
}
- (void)search:(NSString *)keyword conversation:(NSString *)conversation types:(NSArray<NSNumber *> *)types page:(NSInteger)page completion:(NativeIMResult)completion {
    OIMSearchParam *request = [OIMSearchParam new]; request.conversationID = conversation;
    request.keywordList = keyword.length ? @[keyword] : @[]; request.messageTypeList = types; request.keywordListMatchType = 1;
    request.searchTimePosition = 0; request.searchTimePeriod = 0; request.pageIndex = page; request.count = 40;
    [OIMManager.manager searchLocalMessages:request onSuccess:^(OIMSearchResultInfo *result) {
        NSMutableArray *rows = [NSMutableArray new];
        for (OIMSearchResultItemInfo *item in result.searchResultItems) {
            for (NSDictionary *data in MessageList(item.messageList)) {
                NSMutableDictionary *row = data.mutableCopy; row[@"conversationID"] = item.conversationID ?: @"";
                row[@"conversationTitle"] = item.showName ?: @""; [rows addObject:row];
            }
        }
        completion(@{@"items": rows, @"total": @(result.totalCount)}, nil);
    } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
}

- (void)sendSerialized:(NSString *)serialized target:(NSString *)target type:(NSInteger)type completion:(NativeIMResult)completion {
    OIMMessageInfo *message = [OIMMessageInfo mj_objectWithKeyValues:serialized];
    if (!message.clientMsgID.length || (type != 1 && type != 3) || !target.length) { completion(nil, NativeError(-1)); return; }
    // 与原 App 参数一致：目标同时写入消息与调用参数，推送对象必须是完整 JSON。
    message.recvID = type == 1 ? target : @""; message.groupID = type == 3 ? target : @""; message.sessionType = (OIMConversationType)type;
    OIMOfflinePushInfo *push = [OIMOfflinePushInfo new]; push.title = @"你收到一条新消息"; push.desc = @""; push.ex = @""; push.iOSPushSound = @"+1"; push.iOSBadgeCount = YES;
    OIMMessageInfoCallback success = ^(OIMMessageInfo *result) {
        if (![result.clientMsgID isEqualToString:message.clientMsgID] || result.status != OIMMessageStatusSendSuccess) { completion(nil, NativeError(-1)); return; }
        completion(MessageData(result), nil);
    };
    OIMFailureCallback failure = ^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); };
    // 转发已上传媒体不能读取原发送者设备上的 sourcePath，也不能再次上传原对象。
    BOOL remote = (message.contentType == OIMMessageContentTypeImage && (message.pictureElem.sourcePicture.url.length || message.pictureElem.bigPicture.url.length))
        || (message.contentType == OIMMessageContentTypeAudio && message.soundElem.sourceUrl.length)
        || (message.contentType == OIMMessageContentTypeVideo && message.videoElem.videoUrl.length)
        || (message.contentType == OIMMessageContentTypeFile && message.fileElem.sourceUrl.length);
    if (remote) {
        [OIMManager.manager sendMessageNotOss:message recvID:message.recvID groupID:message.groupID isOnlineOnly:NO offlinePushInfo:push onSuccess:success onProgress:^(NSInteger progress) {} onFailure:failure];
    } else {
        [OIMManager.manager sendMessage:message recvID:message.recvID groupID:message.groupID isOnlineOnly:NO offlinePushInfo:push onSuccess:success onProgress:^(NSInteger progress) {} onFailure:failure];
    }
}

- (void)findConversation:(NSString *)conversation clientMsgIDs:(NSArray<NSString *> *)ids completion:(NativeIMResult)completion {
    OIMFindMessageListParam *request = [OIMFindMessageListParam new];
    request.conversationID = conversation;
    request.clientMsgIDList = ids;
    [OIMManager.manager findMessageList:@[request] onSuccess:^(OIMSearchResultInfo *result) {
        NSMutableArray *items = [NSMutableArray new];
        for (OIMSearchResultItemInfo *group in result.findResultItems) {
            if ([group.conversationID isEqualToString:conversation]) [items addObjectsFromArray:MessageList(group.messageList)];
        }
        completion(@{@"items": items}, nil);
    } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
}

- (void)background:(BOOL)background completion:(NativeIMResult)completion {
    CallbackProxy *callback = [[CallbackProxy alloc] initWithOnSuccess:^(NSString *data) { completion(@{}, nil); }
        onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
    Open_im_sdkSetAppBackgroundStatus(callback, [OIMManager.manager operationId], background);
}

- (void)networkChanged:(NativeIMResult)completion {
    CallbackProxy *callback = [[CallbackProxy alloc] initWithOnSuccess:^(NSString *data) { completion(@{}, nil); }
        onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
    Open_im_sdkNetworkStatusChanged(callback, [OIMManager.manager operationId]);
}

- (void)onSyncServerStart:(BOOL)reInstall { [self emit:@"syncStart" payload:@{}]; }
- (void)onRecvCustomBusinessMessage:(NSDictionary<NSString *, id> *)businessMessage {
    if ([businessMessage isKindOfClass:NSDictionary.class]) [self emit:@"businessNotification" payload:businessMessage];
}

- (void)onSyncServerFinish:(BOOL)reInstall { [self emit:@"syncFinish" payload:@{}]; }
- (void)onSyncServerFailed:(BOOL)reInstall { [self emit:@"syncFailed" payload:@{}]; }
- (void)onSyncServerProgress:(NSInteger)progress { [self emit:@"syncProgress" payload:@{@"progress": @(progress)}]; }
- (void)onNewConversation:(NSArray<OIMConversationInfo *> *)items { [self emit:@"conversations" payload:@{@"items": ConversationList(items)}]; }
- (void)onConversationChanged:(NSArray<OIMConversationInfo *> *)items { [self emit:@"conversations" payload:@{@"items": ConversationList(items)}]; }
- (void)onRecvNewMessage:(OIMMessageInfo *)message { [self emit:@"message" payload:MessageData(message)]; }
- (void)onRecvC2CReadReceipt:(NSArray<OIMReceiptInfo *> *)items {
    for (OIMReceiptInfo *item in items) [self emit:@"read" payload:@{@"ids": item.msgIDList ?: @[]}];
}
- (void)onRecvMessageRevoked:(OIMMessageRevokedInfo *)info {
    [self emit:@"revoked" payload:@{@"id": info.clientMsgID ?: @"", @"revokerID": info.revokerID ?: @"",
                                  @"revokerNickname": info.revokerNickname ?: @""}];
}
- (void)onMsgDeleted:(OIMMessageInfo *)message { [self emit:@"deleted" payload:@{@"id": message.clientMsgID ?: @""}]; }
@end
