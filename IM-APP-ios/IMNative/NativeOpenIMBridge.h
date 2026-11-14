#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN
typedef void (^NativeIMResult)(NSDictionary<NSString *, id> * _Nullable result, NSError * _Nullable error);
typedef void (^NativeIMEvent)(NSString *name, NSDictionary<NSString *, id> *payload);

/// 薄桥仅解决官方 ObjC SDK 的 Swift 导入名称；没有 SDK 替身或内存聊天实现。
@interface NativeOpenIMBridge : NSObject
- (BOOL)initializeAPI:(NSString *)api ws:(NSString *)ws directory:(NSString *)directory events:(NativeIMEvent)events NS_SWIFT_NAME(initialize(api:ws:directory:events:));
- (void)loginUserID:(NSString *)userID token:(NSString *)token completion:(NativeIMResult)completion NS_SWIFT_NAME(login(userID:token:completion:));
- (void)logout:(NativeIMResult)completion NS_SWIFT_NAME(logout(completion:));
- (void)shutdown NS_SWIFT_NAME(shutdown());
- (void)conversationsOffset:(NSInteger)offset count:(NSInteger)count completion:(NativeIMResult)completion NS_SWIFT_NAME(conversations(offset:count:completion:));
- (void)conversationTarget:(NSString *)target type:(NSInteger)type completion:(NativeIMResult)completion NS_SWIFT_NAME(conversation(target:type:completion:));
- (void)historyConversation:(NSString *)conversation cursor:(NSString *)cursor count:(NSInteger)count completion:(NativeIMResult)completion NS_SWIFT_NAME(history(conversation:cursor:count:completion:));
- (nullable NSDictionary<NSString *, id> *)createText:(NSString *)text NS_SWIFT_NAME(createText(_:));
- (nullable NSDictionary<NSString *, id> *)unpack:(NSString *)serialized NS_SWIFT_NAME(unpack(_:));
- (nullable NSDictionary<NSString *, id> *)createMedia:(NSInteger)kind path:(NSString *)path filename:(NSString *)filename duration:(NSInteger)duration snapshot:(NSString *)snapshot NS_SWIFT_NAME(createMedia(kind:path:filename:duration:snapshot:));
- (nullable NSDictionary<NSString *, id> *)createQuote:(NSString *)text serialized:(NSString *)serialized NS_SWIFT_NAME(createQuote(_:serialized:));
- (nullable NSDictionary<NSString *, id> *)createForward:(NSString *)serialized NS_SWIFT_NAME(createForward(_:));
- (nullable NSDictionary<NSString *, id> *)createCard:(NSString *)user nickname:(NSString *)nickname avatar:(NSString *)avatar businessUser:(NSString *)businessUser NS_SWIFT_NAME(createCard(_:nickname:avatar:businessUser:));
- (nullable NSDictionary<NSString *, id> *)createAt:(NSString *)text users:(NSArray<NSDictionary *> *)users all:(BOOL)all quoted:(NSString *)quoted NS_SWIFT_NAME(createAt(_:users:all:quoted:));
- (nullable NSDictionary<NSString *, id> *)createCustom:(NSString *)data NS_SWIFT_NAME(createCustom(_:));
- (void)patchPin:(NSString *)conversation payload:(NSString *)payload completion:(NativeIMResult)completion NS_SWIFT_NAME(patchPin(_:payload:completion:));
- (void)markRead:(NSString *)conversation completion:(NativeIMResult)completion NS_SWIFT_NAME(markRead(_:completion:));
- (void)clear:(NSString *)conversation completion:(NativeIMResult)completion NS_SWIFT_NAME(clear(_:completion:));
- (void)deleteMessage:(NSString *)message conversation:(NSString *)conversation completion:(NativeIMResult)completion NS_SWIFT_NAME(deleteMessage(_:conversation:completion:));
- (void)pin:(NSString *)conversation pinned:(BOOL)pinned completion:(NativeIMResult)completion NS_SWIFT_NAME(pin(_:pinned:completion:));
- (void)mute:(NSString *)conversation muted:(BOOL)muted completion:(NativeIMResult)completion NS_SWIFT_NAME(mute(_:muted:completion:));
- (void)search:(NSString *)keyword conversation:(NSString *)conversation types:(NSArray<NSNumber *> *)types page:(NSInteger)page completion:(NativeIMResult)completion NS_SWIFT_NAME(search(_:conversation:types:page:completion:));
- (void)hide:(NSString *)conversation completion:(NativeIMResult)completion NS_SWIFT_NAME(hide(_:completion:));
- (void)sendSerialized:(NSString *)serialized target:(NSString *)target type:(NSInteger)type completion:(NativeIMResult)completion NS_SWIFT_NAME(send(serialized:target:type:completion:));
- (void)findConversation:(NSString *)conversation clientMsgIDs:(NSArray<NSString *> *)ids completion:(NativeIMResult)completion NS_SWIFT_NAME(find(conversation:clientMsgIDs:completion:));
- (void)background:(BOOL)background completion:(NativeIMResult)completion NS_SWIFT_NAME(background(_:completion:));
- (void)networkChanged:(NativeIMResult)completion NS_SWIFT_NAME(networkChanged(completion:));
@end
NS_ASSUME_NONNULL_END
