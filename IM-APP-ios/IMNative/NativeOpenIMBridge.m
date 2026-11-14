#import "NativeOpenIMBridge.h"
#import <OpenIMSDK/OpenIMSDK.h>
#import <MJExtension/MJExtension.h>
#import <OpenIMSDK/CallbackProxy.h>
@import OpenIMCore;

@interface NativeOpenIMBridge () <OIMConversationListener, OIMAdvancedMsgListener>
@property(nonatomic, copy, nullable) NativeIMEvent events;
@property(nonatomic, assign) BOOL alive;
@end

@implementation NativeOpenIMBridge

static NSError *NativeError(NSInteger code) {
    // 不向界面泄漏 SDK 原始 JSON、token 或后端地址。
    return [NSError errorWithDomain:@"NativeOpenIM" code:code userInfo:@{NSLocalizedDescriptionKey:
        [NSString stringWithFormat:@"聊天请求失败（%ld），请稍后重试。", (long)code]}];
}

static NSDictionary *MessageData(OIMMessageInfo *message) {
    NSString *text;
    switch (message.contentType) {
        case OIMMessageContentTypeText: text = message.textElem.content ?: @""; break;
        case OIMMessageContentTypeImage: text = @"[图片]"; break;
        case OIMMessageContentTypeAudio: text = @"[语音]"; break;
        case OIMMessageContentTypeVideo: text = @"[视频]"; break;
        case OIMMessageContentTypeFile: text = @"[文件]"; break;
        case OIMMessageContentTypeCard: text = [NSString stringWithFormat:@"[名片] %@", message.cardElem.nickname ?: @""]; break;
        case OIMMessageContentTypeMerge: text = message.mergeElem.title ?: @"聊天记录"; break;
        case OIMMessageContentTypeQuote: text = [NSString stringWithFormat:@"%@\n引用：%@", message.quoteElem.text ?: @"", message.quoteElem.quoteMessage.textElem.content ?: @"[消息]"]; break;
        case OIMMessageContentTypeAt: text = [message.atTextElem.mj_keyValues[@"text"] isKindOfClass:NSString.class] ? message.atTextElem.mj_keyValues[@"text"] : @"[@消息]"; break;
        case OIMMessageContentTypeAdvancedText: text = message.advancedTextElem.text ?: @""; break;
        case OIMMessageContentTypeRevoke: text = @"[消息已撤回]"; break;
        default: text = message.contentType >= 1000 ? @"[系统通知]" : @"[此类型消息待支持]"; break;
    }
    if (message.status == OIMMessageStatusRevoke) text = @"[消息已撤回]";
    NSString *url = @"", *thumbnail = @"", *local = @"", *filename = @"";
    NSInteger duration = 0;
    if (message.contentType == OIMMessageContentTypeImage) {
        url = message.pictureElem.sourcePicture.url.length ? message.pictureElem.sourcePicture.url : (message.pictureElem.bigPicture.url ?: @"");
        if (!url.length) url = message.pictureElem.snapshotPicture.url ?: @"";
        thumbnail = message.pictureElem.snapshotPicture.url.length ? message.pictureElem.snapshotPicture.url : url; local = message.pictureElem.sourcePath ?: @"";
    } else if (message.contentType == OIMMessageContentTypeVideo) {
        url = message.videoElem.videoUrl ?: @""; thumbnail = message.videoElem.snapshotUrl ?: @"";
        local = message.videoElem.videoPath ?: @""; duration = message.videoElem.duration;
    } else if (message.contentType == OIMMessageContentTypeAudio) {
        url = message.soundElem.sourceUrl ?: @""; local = message.soundElem.soundPath ?: @""; duration = message.soundElem.duration;
    } else if (message.contentType == OIMMessageContentTypeFile) {
        url = message.fileElem.sourceUrl ?: @""; local = message.fileElem.filePath ?: @""; filename = message.fileElem.fileName ?: @"";
    }
    return @{@"id": message.clientMsgID ?: @"", @"senderID": message.sendID ?: @"",
             @"recvID": message.recvID ?: @"", @"groupID": message.groupID ?: @"",
             @"sessionType": @(message.sessionType), @"text": text,
             @"timestamp": @((int64_t)(message.sendTime > 0 ? message.sendTime : message.createTime)),
             @"status": @(message.status), @"contentType": @(message.contentType),
             @"seq": @(message.seq), @"isRead": @(message.isRead), @"avatar": message.senderFaceUrl ?: @"", @"senderName": message.senderNickname ?: @"",
             @"mediaURL": url, @"thumbnail": thumbnail, @"localPath": local, @"filename": filename, @"duration": @(duration),
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
             @"latestSeq": @(conversation.latestMsg.seq), @"latestSender": conversation.latestMsg.sendID ?: @"",
             @"timestamp": @(conversation.latestMsgSendTime), @"pinned": @(conversation.isPinned),
             @"preview": conversation.latestMsg ? MessageData(conversation.latestMsg)[@"text"] : @"暂无消息"};
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
        onKickedOffline:^{ [weak emit:@"kicked" payload:@{}]; }
        onUserTokenExpired:^{ [weak emit:@"tokenExpired" payload:@{}]; }
        onUserTokenInvalid:^(NSString *msg) { [weak emit:@"tokenInvalid" payload:@{}]; }];
    if (initialized) {
        [OIMManager.callbacker addConversationListener:self];
        [OIMManager.callbacker addAdvancedMsgListener:self];
    } else { self.alive = NO; }
    return initialized;
}

- (void)loginUserID:(NSString *)userID token:(NSString *)token completion:(NativeIMResult)completion {
    [OIMManager.manager login:userID token:token onSuccess:^(NSString *data) {
        completion(@{}, nil);
    } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
}

- (void)logout:(NativeIMResult)completion {
    [OIMManager.manager logoutWithOnSuccess:^(NSString *data) { completion(@{}, nil); }
                                  onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
}

- (void)shutdown {
    NSAssert(NSThread.isMainThread, @"SDK singleton 必须在主队列串行操作");
    self.alive = NO;
    self.events = nil;
    [OIMManager.callbacker removeConversationListener:self];
    [OIMManager.callbacker removeAdvancedMsgListener:self];
    [OIMManager.manager unInitSDK];
    OIMManager.manager.token = nil;
}

- (void)conversationsOffset:(NSInteger)offset count:(NSInteger)count completion:(NativeIMResult)completion {
    [OIMManager.manager getConversationListSplitWithOffset:offset count:count onSuccess:^(NSArray<OIMConversationInfo *> *items) {
        completion(@{@"items": ConversationList(items ?: @[])}, nil);
    } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
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
    [OIMManager.manager getMultipleConversation:@[conversation] onSuccess:^(NSArray<OIMConversationInfo *> *items) {
        OIMConversationInfo *current = items.firstObject;
        if (!current || ![current.conversationID isEqualToString:conversation]) { completion(nil, NativeError(-1)); return; }
        NSDictionary *original = [current.ex mj_JSONObject];
        NSMutableDictionary *extra = [original isKindOfClass:NSDictionary.class] ? [original mutableCopy] : [NSMutableDictionary new];
        if (payload.length) { NSDictionary *pinned = [payload mj_JSONObject]; if (![pinned isKindOfClass:NSDictionary.class]) { completion(nil, NativeError(-1)); return; } if ([pinned[@"action"] isEqual:@"unpin"]) [extra removeObjectForKey:@"pinnedMessage"]; else extra[@"pinnedMessage"] = pinned; if (pinned[@"pinnedAt"]) extra[@"nativeMessagePinRevision"] = pinned[@"pinnedAt"]; }
        else [extra removeObjectForKey:@"pinnedMessage"];
        [OIMManager.manager setConversation:conversation req:@{@"ex": extra.count ? [extra mj_JSONString] : @""} onSuccess:^(NSString *data) { completion(@{}, nil); } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
    } onFailure:^(NSInteger code, NSString *msg) { completion(nil, NativeError(code)); }];
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
- (void)onSyncServerFinish:(BOOL)reInstall { [self emit:@"syncFinish" payload:@{}]; }
- (void)onSyncServerFailed:(BOOL)reInstall { [self emit:@"syncFailed" payload:@{}]; }
- (void)onSyncServerProgress:(NSInteger)progress { [self emit:@"syncProgress" payload:@{@"progress": @(progress)}]; }
- (void)onNewConversation:(NSArray<OIMConversationInfo *> *)items { [self emit:@"conversations" payload:@{@"items": ConversationList(items)}]; }
- (void)onConversationChanged:(NSArray<OIMConversationInfo *> *)items { [self emit:@"conversations" payload:@{@"items": ConversationList(items)}]; }
- (void)onRecvNewMessage:(OIMMessageInfo *)message { [self emit:@"message" payload:MessageData(message)]; }
- (void)onRecvC2CReadReceipt:(NSArray<OIMReceiptInfo *> *)items {
    for (OIMReceiptInfo *item in items) [self emit:@"read" payload:@{@"ids": item.msgIDList ?: @[]}];
}
- (void)onRecvMessageRevoked:(OIMMessageRevokedInfo *)info { [self emit:@"revoked" payload:@{@"id": info.clientMsgID ?: @""}]; }
- (void)onMsgDeleted:(OIMMessageInfo *)message { [self emit:@"deleted" payload:@{@"id": message.clientMsgID ?: @""}]; }
@end
