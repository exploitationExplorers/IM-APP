# 入群申请群会话强提醒 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the imAdmin C2C join-request notification with a business notification that marks the actual group conversation with `[有新的进群申请]` and an unnumbered red dot until the group is opened.

**Architecture:** Backend keeps the existing `group.join.requested` outbox event and switches the worker delivery from `SendCustomC2CMessage` to `SendBusinessNotification`. The business notification carries the OpenIM group conversation ID. Frontend subscribes to `OnRecvCustomBusinessMessage`, persists a per-user pending conversation set, and decorates the matching group conversation with a highlight tag and red dot. The existing groupJoinRequest card remains for historical messages only.

**Tech Stack:** Go, PostgreSQL outbox, OpenIM HTTP API, Vue 3 Composition API, Pinia, uni-app, Vitest, H5 browser verification.

**Spec:** `docs/superpowers/specs/2026-10-30-group-join-request-conversation-highlight-design.md`

## Global Constraints

- Only current active group owner/admin users receive the notification.
- New join-request notifications must not create an `imAdmin` conversation.
- The red alert is attached to the actual group conversation.
- The conversation preview contains `[有新的进群申请]`.
- The right-side unread number is replaced by an unnumbered red dot while the join-request pending state is active.
- Entering the group conversation clears the pending state immediately.
- Muted conversations follow the existing group-@ behavior and do not show red strong reminders.
- Existing `groupJoinRequest` C2C card parsing remains backward-compatible for historical messages.
- App native verification is manual; H5 must be verified at PC and mobile viewports.

---

### Task 1: Backend business-notification delivery

**Files:**
- Modify: `IM-APP-server/internal/im/client.go:30-38`
- Modify: `IM-APP-server/internal/im/client_test.go`
- Modify: `IM-APP-server/internal/repository/group.go:1611-1621`
- Modify: `IM-APP-server/internal/service/group.go:555-607`
- Modify: `IM-APP-server/internal/service/im_sync.go:131-155`
- Test: `IM-APP-server/internal/service/group_join_request_notification_test.go`

**Interfaces:**
- Produces: `im.GroupConversationIDFromBusinessID(businessGroupID string) (string, error)`
- Produces: `repository.PendingGroupJoinRequestNotification.GroupConversationID string`
- Produces: `GroupService.sendGroupJoinRequestNotification(ctx context.Context, recipientID string, card repository.PendingGroupJoinRequestNotification) error`

- [ ] **Step 1: Write the failing group-conversation helper test**

Add to `IM-APP-server/internal/im/client_test.go`:

```go
func TestGroupConversationIDFromBusinessID(t *testing.T) {
	got, err := GroupConversationIDFromBusinessID("10223cf6-59ec-4556-8c09-141915e190ed")
	if err != nil {
		t.Fatal(err)
	}
	if got != "sg_10223cf659ec45568c09141915e190ed" {
		t.Fatalf("GroupConversationIDFromBusinessID() = %q", got)
	}
}
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
go test ./internal/im -run TestGroupConversationIDFromBusinessID -count=1
```

Expected: FAIL because `GroupConversationIDFromBusinessID` is not defined.

- [ ] **Step 3: Add the minimal helper**

In `IM-APP-server/internal/im/client.go`, after `UserIDFromBusinessID`:

```go
// GroupConversationIDFromBusinessID maps a business group UUID to the
// OpenIM group conversation ID used by the client conversation list.
func GroupConversationIDFromBusinessID(businessGroupID string) (string, error) {
	groupID, err := UserIDFromBusinessID(businessGroupID)
	if err != nil {
		return "", err
	}
	return "sg_" + groupID, nil
}
```

- [ ] **Step 4: Run the helper test and verify it passes**

Run:

```powershell
go test ./internal/im -run TestGroupConversationIDFromBusinessID -count=1
```

Expected: PASS.

- [ ] **Step 5: Replace the service test with a failing business-notification test**

Replace `TestSendGroupJoinRequestCardUsesAdminAndStableMessageID` in `IM-APP-server/internal/service/group_join_request_notification_test.go` with:

```go
func TestSendGroupJoinRequestNotificationUsesBusinessNotification(t *testing.T) {
	var sends int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/auth/get_admin_token":
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"token":"admin-token","expireTimeSeconds":"3600"}}`))
		case "/msg/send_business_notification":
			var body map[string]any
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				t.Fatal(err)
			}
			if body["sendUserID"] != "imAdmin" ||
				body["recvUserID"] != "22222222222242228222222222222222" ||
				body["key"] != "group_join_request" ||
				body["reliabilityLevel"] != float64(2) {
				t.Fatalf("unexpected business notification body: %#v", body)
			}
			var payload map[string]any
			if err := json.Unmarshal([]byte(body["data"].(string)), &payload); err != nil {
				t.Fatal(err)
			}
			if payload["requestId"] != "request-1" ||
				payload["groupId"] != "qun_review" ||
				payload["groupConversationId"] != "sg_22222222222242228222222222222222" ||
				payload["applicantNickname"] != "申请人" {
				t.Fatalf("unexpected notification payload: %#v", payload)
			}
			sends++
			_, _ = w.Write([]byte(`{"errCode":0,"data":{"serverMsgID":"server-1","clientMsgID":"client-1"}}`))
		case "/msg/send_msg":
			t.Fatal("join request must not create a C2C conversation")
		default:
			t.Fatalf("unexpected path %s", r.URL.Path)
		}
	}))
	defer server.Close()

	client := im.NewClient(config.OpenIMConfig{
		APIURL: server.URL, Secret: "secret", AdminUser: "imAdmin",
	})
	service := &GroupService{IM: client}
	card := repository.PendingGroupJoinRequestNotification{
		RequestID:          "request-1",
		GroupPublicID:      "qun_review",
		GroupConversationID: "sg_22222222222242228222222222222222",
		GroupName:          "审核群",
		ApplicantID:        "33333333-3333-4333-8333-333333333333",
		ApplicantName:      "申请人",
		ApplicantAvatar:    "https://cdn.example/avatar.png",
	}
	recipient := "22222222-2222-4222-8222-222222222222"
	if err := service.sendGroupJoinRequestNotification(context.Background(), recipient, card); err != nil {
		t.Fatal(err)
	}
	if sends != 1 {
		t.Fatalf("send calls=%d, want 1", sends)
	}
}
```

- [ ] **Step 6: Run the service test and verify it fails**

Run:

```powershell
go test ./internal/service -run TestSendGroupJoinRequestNotificationUsesBusinessNotification -count=1
```

Expected: FAIL because the method still sends a C2C CustomMessage and the struct lacks `GroupConversationID`.

- [ ] **Step 7: Add the notification field**

In `IM-APP-server/internal/repository/group.go`:

```go
type PendingGroupJoinRequestNotification struct {
	RequestID           string
	GroupPublicID       string
	GroupConversationID string
	GroupName           string
	ApplicantID         string
	ApplicantName       string
	ApplicantAvatar     string
	RecipientIDs        []string
}
```

- [ ] **Step 8: Replace the service sender**

Replace `sendGroupJoinRequestCard` with:

```go
func (s *GroupService) sendGroupJoinRequestNotification(
	ctx context.Context,
	recipientID string,
	card repository.PendingGroupJoinRequestNotification,
) error {
	if s.IM == nil || !s.IM.Available() {
		return errors.New("openim unavailable")
	}
	if strings.TrimSpace(card.GroupConversationID) == "" {
		return errors.New("group conversation id is required")
	}
	recvID, err := im.UserIDFromBusinessID(recipientID)
	if err != nil {
		return err
	}
	if s.Users != nil {
		recipient, err := s.Users.FindByID(ctx, recipientID)
		if err != nil {
			return err
		}
		if err := s.IM.EnsureUser(ctx, im.User{
			UserID: recvID, Nickname: recipient.Nickname, FaceURL: recipient.Avatar,
		}); err != nil {
			return err
		}
	}
	payload, err := json.Marshal(map[string]any{
		"requestId":          card.RequestID,
		"groupId":            card.GroupPublicID,
		"groupConversationId": card.GroupConversationID,
		"groupName":          card.GroupName,
		"applicantId":        card.ApplicantID,
		"applicantNickname":  card.ApplicantName,
		"applicantAvatar":    card.ApplicantAvatar,
	})
	if err != nil {
		return err
	}
	_, err = s.IM.SendBusinessNotification(
		ctx,
		recvID,
		"",
		"group_join_request",
		string(payload),
		true,
	)
	return err
}
```

- [ ] **Step 9: Compute the actual OpenIM conversation ID in the worker**

In `IM-APP-server/internal/service/im_sync.go`, after `PendingJoinRequestNotification` succeeds:

```go
groupConversationID, err := im.GroupConversationIDFromBusinessID(event.AggregateID)
if err != nil {
	return fmt.Errorf("build group conversation id: %w", err)
}
card.GroupConversationID = groupConversationID
```

Change the loop call to:

```go
if err := sender.sendGroupJoinRequestNotification(ctx, recipientID, card); err != nil {
	return err
}
```

- [ ] **Step 10: Run backend tests**

Run:

```powershell
go test ./internal/im ./internal/service -count=1
```

Expected: PASS.

- [ ] **Step 11: Commit**

```powershell
git add IM-APP-server/internal/im/client.go IM-APP-server/internal/im/client_test.go IM-APP-server/internal/repository/group.go IM-APP-server/internal/service/group.go IM-APP-server/internal/service/im_sync.go IM-APP-server/internal/service/group_join_request_notification_test.go
git commit -m "feat: send join request alerts as business notifications"
```

---

### Task 2: Frontend business-notification parser

**Files:**
- Modify: `IM-APP-fronend/src/types/chat.ts:28-36`
- Modify: `IM-APP-fronend/src/utils/groupJoinRequest.ts`
- Test: `IM-APP-fronend/tests/group-join-request.test.ts`

**Interfaces:**
- Produces: `GroupJoinRequestPayload.groupConversationId?: string`
- Produces: `parseGroupJoinRequestBusinessNotification(raw: unknown): GroupJoinRequestPayload | null`

- [ ] **Step 1: Write failing parser tests**

Add to `IM-APP-fronend/tests/group-join-request.test.ts`:

```ts
it('解析业务通知中的群会话 ID', () => {
  expect(
    parseGroupJoinRequestBusinessNotification({
      key: 'group_join_request',
      data: JSON.stringify({
        requestId: 'request-4',
        groupId: 'qun_review',
        groupConversationId: 'sg_22222222222242228222222222222222',
        groupName: '审核群',
        applicantId: 'user-4',
        applicantNickname: '申请人D',
        applicantAvatar: '',
      }),
    }),
  ).toMatchObject({
    requestId: 'request-4',
    groupConversationId: 'sg_22222222222242228222222222222222',
  })
})

it('拒绝缺少群会话 ID 的业务通知', () => {
  expect(
    parseGroupJoinRequestBusinessNotification({
      key: 'group_join_request',
      data: JSON.stringify({
        requestId: 'request-5',
        groupId: 'qun_review',
      }),
    }),
  ).toBeNull()
})
```

- [ ] **Step 2: Run the parser tests and verify they fail**

Run:

```powershell
npm run test:unit -- tests/group-join-request.test.ts
```

Expected: FAIL because `parseGroupJoinRequestBusinessNotification` is not exported.

- [ ] **Step 3: Add the optional field and parser**

In `IM-APP-fronend/src/types/chat.ts`:

```ts
export interface GroupJoinRequestPayload {
  requestId: string
  groupId: string
  groupConversationId?: string
  groupName: string
  applicantId: string
  applicantNickname: string
  applicantAvatar: string
}
```

In `IM-APP-fronend/src/utils/groupJoinRequest.ts`, add `groupConversationId` to the normalized object:

```ts
const groupConversationId = String(pickField(obj, 'groupConversationId') ?? '').trim()
return {
  requestId,
  groupId,
  ...(groupConversationId ? { groupConversationId } : {}),
  groupName: String(pickField(obj, 'groupName') ?? '群聊'),
  applicantId: String(pickField(obj, 'applicantId') ?? '').trim(),
  applicantNickname: String(pickField(obj, 'applicantNickname') ?? '申请人').trim(),
  applicantAvatar: String(pickField(obj, 'applicantAvatar') ?? ''),
}
```

Add:

```ts
export function parseGroupJoinRequestBusinessNotification(
  raw: unknown,
): GroupJoinRequestPayload | null {
  const obj = parseObject(raw)
  if (!obj) return null
  const key = String(pickField(obj, 'key') ?? '')
  if (key !== 'group_join_request') return null
  const payload = parseGroupJoinRequestPayload(pickField(obj, 'data'))
  return payload?.groupConversationId ? payload : null
}
```

- [ ] **Step 4: Run the parser tests and verify they pass**

Run:

```powershell
npm run test:unit -- tests/group-join-request.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add IM-APP-fronend/src/types/chat.ts IM-APP-fronend/src/utils/groupJoinRequest.ts IM-APP-fronend/tests/group-join-request.test.ts
git commit -m "feat: parse join request business notifications"
```

---

### Task 3: Per-user join-request pending storage

**Files:**
- Create: `IM-APP-fronend/src/utils/conversation-highlight.ts`
- Create: `IM-APP-fronend/tests/conversation-highlight.test.ts`

**Interfaces:**
- Produces: `JOIN_REQUEST_HIGHLIGHT_TAG = '[有新的进群申请]'`
- Produces: `hasPendingJoinRequest(userId: string, conversationId: string): boolean`
- Produces: `setPendingJoinRequest(userId: string, conversationId: string, pending: boolean): void`

- [ ] **Step 1: Write failing storage tests**

Create `IM-APP-fronend/tests/conversation-highlight.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  hasPendingJoinRequest,
  setPendingJoinRequest,
} from '@/utils/conversation-highlight'

const storage = new Map<string, unknown>()

beforeEach(() => {
  storage.clear()
  vi.stubGlobal('uni', {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: unknown) => storage.set(key, value),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('join request conversation highlight', () => {
  it('stores and clears a pending conversation per user', () => {
    setPendingJoinRequest('user-a', 'sg_group', true)
    expect(hasPendingJoinRequest('user-a', 'sg_group')).toBe(true)
    setPendingJoinRequest('user-a', 'sg_group', false)
    expect(hasPendingJoinRequest('user-a', 'sg_group')).toBe(false)
  })

  it('isolates different users', () => {
    setPendingJoinRequest('user-a', 'sg_group', true)
    expect(hasPendingJoinRequest('user-b', 'sg_group')).toBe(false)
  })

  it('ignores corrupted storage', () => {
    storage.set('im_join_request_pending_user-a', 'bad')
    expect(hasPendingJoinRequest('user-a', 'sg_group')).toBe(false)
  })
})
```

- [ ] **Step 2: Run the tests and verify they fail**

Run:

```powershell
npm run test:unit -- tests/conversation-highlight.test.ts
```

Expected: FAIL because the utility does not exist.

- [ ] **Step 3: Implement the utility**

Create `IM-APP-fronend/src/utils/conversation-highlight.ts`:

```ts
export const JOIN_REQUEST_HIGHLIGHT_TAG = '[有新的进群申请]'

const PREFIX = 'im_join_request_pending_'

function keyOf(userId: string): string {
  return `${PREFIX}${userId || 'anon'}`
}

function readPending(userId: string): Record<string, boolean> {
  try {
    const raw = uni.getStorageSync(keyOf(userId))
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
    const out: Record<string, boolean> = {}
    for (const [conversationId, value] of Object.entries(raw as Record<string, unknown>)) {
      if (conversationId && value === true) out[conversationId] = true
    }
    return out
  } catch {
    return {}
  }
}

export function hasPendingJoinRequest(userId: string, conversationId: string): boolean {
  return !!conversationId && readPending(userId)[conversationId] === true
}

export function setPendingJoinRequest(
  userId: string,
  conversationId: string,
  pending: boolean,
): void {
  if (!conversationId) return
  const next = readPending(userId)
  if (pending) next[conversationId] = true
  else delete next[conversationId]
  uni.setStorageSync(keyOf(userId), next)
}
```

- [ ] **Step 4: Run the tests and verify they pass**

Run:

```powershell
npm run test:unit -- tests/conversation-highlight.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add IM-APP-fronend/src/utils/conversation-highlight.ts IM-APP-fronend/tests/conversation-highlight.test.ts
git commit -m "feat: persist join request conversation highlights"
```

---

### Task 4: Chat store integration and red-dot rendering

**Files:**
- Modify: `IM-APP-fronend/src/types/chat.ts`
- Modify: `IM-APP-fronend/src/stores/chat.ts`
- Modify: `IM-APP-fronend/src/components/ConversationItem.vue`
- Modify: `IM-APP-fronend/src/utils/group-announcement.ts`
- Test: `IM-APP-fronend/tests/retention-store.test.ts`

**Interfaces:**
- Consumes: `parseGroupJoinRequestBusinessNotification`
- Consumes: `hasPendingJoinRequest`, `setPendingJoinRequest`, `JOIN_REQUEST_HIGHLIGHT_TAG`
- Produces: `Conversation.joinRequestPending?: boolean`
- Produces: `highlightTagsOf(groupAtType, hasUnreadAnnouncement, joinRequestPending?)`

- [ ] **Step 1: Write the failing store test**

Add this test to the existing `describe(...)` block in `IM-APP-fronend/tests/retention-store.test.ts`; that file already provides `store`, `mocks`, `IMEvents`, and the Pinia/OpenIM harness:

```ts
it('marks the group conversation on a business notification and clears it on read', async () => {
  store.conversations = [{ ...conversation(b), groupAtType: 0, highlightTags: [] }]
  const receive = mocks.events.get(IMEvents.OnRecvCustomBusinessMessage)!
  receive({
    key: 'group_join_request',
    data: JSON.stringify({
      requestId: 'request-1',
      groupId: 'qun_review',
      groupConversationId: b,
      groupName: '审核群',
      applicantId: 'user-1',
      applicantNickname: '申请人',
      applicantAvatar: '',
    }),
  })

  expect(store.conversations.find((c) => c.id === b)).toMatchObject({
    joinRequestPending: true,
    highlightTags: ['[有新的进群申请]'],
  })

  await store.markAsRead(b)
  expect(store.conversations.find((c) => c.id === b)).toMatchObject({
    joinRequestPending: false,
    highlightTags: [],
  })
})
```

- [ ] **Step 2: Run the store test and verify it fails**

Run:

```powershell
npm run test:unit -- tests/retention-store.test.ts
```

Expected: FAIL because `OnRecvCustomBusinessMessage` is not subscribed and `joinRequestPending` is not rendered.

- [ ] **Step 3: Add the conversation field and tag helper**

In `IM-APP-fronend/src/types/chat.ts`:

```ts
joinRequestPending?: boolean
```

In `IM-APP-fronend/src/utils/group-announcement.ts`:

```ts
export const JOIN_REQUEST_HIGHLIGHT_TAG = '[有新的进群申请]'

export function highlightTagsOf(
  groupAtType: number | undefined,
  hasUnreadAnnouncement: boolean,
  joinRequestPending = false,
): string[] {
  const tags: string[] = []
  if (isAtMeType(groupAtType)) tags.push('[有人@我]')
  if (groupAtType === GroupAtType.AtGroupNotice || hasUnreadAnnouncement) {
    tags.push('[有新公告]')
  }
  if (joinRequestPending) tags.push(JOIN_REQUEST_HIGHLIGHT_TAG)
  return tags
}
```

- [ ] **Step 4: Integrate the business event and pending state in the store**

In `IM-APP-fronend/src/stores/chat.ts`:

```ts
import { parseGroupJoinRequestBusinessNotification } from '@/utils/groupJoinRequest'
import {
  hasPendingJoinRequest,
  setPendingJoinRequest,
} from '@/utils/conversation-highlight'
```

Add a handler:

```ts
function applyJoinRequestNotification(raw: unknown) {
  const payload = parseGroupJoinRequestBusinessNotification(raw)
  if (!payload?.groupConversationId) return
  if (payload.groupConversationId === activeConversationId) {
    setPendingJoinRequest(imUserId.value, payload.groupConversationId, false)
    return
  }
  setPendingJoinRequest(imUserId.value, payload.groupConversationId, true)
  const conv = conversations.value.find((c) => c.id === payload.groupConversationId)
  if (!conv) return
  patchConversation(payload.groupConversationId, {
    joinRequestPending: true,
    highlightTags: highlightTagsOf(
      effectiveGroupAtType(conv.groupAtType, conv.unreadCount),
      false,
      true,
    ),
  })
}
```

In `subscribeRealtime()`, add:

```ts
onIMEvent<unknown>(IMEvents.OnRecvCustomBusinessMessage, applyJoinRequestNotification),
```

In `decorateConversation()`:

```ts
const joinRequestPending = hasPendingJoinRequest(imUserId.value, conv.id)
const next = {
  ...conv,
  joinRequestPending,
  highlightTags: highlightTagsOf(
    effectiveGroupAtType(conv.groupAtType, conv.unreadCount),
    unread,
    joinRequestPending,
  ),
}
```

In `setUnreadAnnouncement()`, pass the current pending state into the tag helper:

```ts
const joinRequestPending = hasPendingJoinRequest(imUserId.value, conversationId)
patchConversation(conversationId, {
  highlightTags: highlightTagsOf(
    effectiveGroupAtType(conv.groupAtType, conv.unreadCount),
    unread,
    joinRequestPending,
  ),
})
```

At the end of `keepNewerPreview()`, recompute the pending state instead of letting an SDK snapshot erase it:

```ts
const joinRequestPending = hasPendingJoinRequest(imUserId.value, merged.id)
const hasUnreadAnn = unreadAnnouncementState(announcementOwnerId(), merged.id) === true
merged = {
  ...merged,
  joinRequestPending,
  highlightTags: highlightTagsOf(
    effectiveGroupAtType(merged.groupAtType, merged.unreadCount),
    hasUnreadAnn,
    joinRequestPending,
  ),
}
```

In `markAsRead()`:

```ts
if (conv.type === 'group') {
  setPendingJoinRequest(imUserId.value, conversationId, false)
}
if (conv.type === 'group' && isAtMeType(conv.groupAtType)) {
  patchConversation(conversationId, {
    groupAtType: GroupAtType.AtNormal,
    joinRequestPending: false,
    highlightTags: highlightTagsOf(GroupAtType.AtNormal, false, false),
  })
  await resetConversationGroupAtType(conversationId).catch(() => undefined)
} else if (conv.type === 'group') {
  patchConversation(conversationId, {
    joinRequestPending: false,
    highlightTags: highlightTagsOf(
      effectiveGroupAtType(conv.groupAtType, 0),
      false,
      false,
    ),
  })
}
```

- [ ] **Step 5: Add the red dot to `ConversationItem.vue`**

Add:

```ts
const showJoinRequestDot = computed(
  () => !isMuted.value && props.item.joinRequestPending === true,
)
```

In the template, before the existing unread badge:

```vue
<view
  v-if="showJoinRequestDot"
  class="badge badge-dot"
/>
<view
  v-else-if="item.unreadCount > 0 && isMuted"
  class="badge badge-muted"
/>
```

Add CSS:

```scss
.badge-dot {
  width: 20rpx;
  height: 20rpx;
  min-width: 20rpx;
  padding: 0;
  border-radius: 50%;
  background: #e54d42;
}
```

- [ ] **Step 6: Hide historical imAdmin join-request conversations**

In `loadConversations()`, after mapping and before assigning `conversations.value`, filter:

```ts
const mappedConversations = list.map((item) => {
  const mapped = decorateConversation(toConversation(item))
  const prev = prevById.get(mapped.id)
  return prev ? keepNewerPreview(prev, mapped) : mapped
})
const legacyAdminJoinRequestIds = mappedConversations
  .filter(
    (conv) =>
      conv.type === 'private' &&
      (conv.peerUserId === 'imAdmin' || conv.id.endsWith('_imAdmin')) &&
      conv.lastMessage === '[入群申请]',
  )
  .map((conv) => conv.id)

if (legacyAdminJoinRequestIds.length) {
  void Promise.all(
    legacyAdminJoinRequestIds.map((id) => hideConversation(id).catch(() => undefined)),
  )
}

conversations.value = sortConversations(
  mappedConversations.filter(
    (conv) => !legacyAdminJoinRequestIds.includes(conv.id),
  ),
)
```

Do not delete messages or other imAdmin conversations.

- [ ] **Step 7: Run the store test and verify it passes**

Run:

```powershell
npm run test:unit -- tests/retention-store.test.ts
```

Expected: PASS.

- [ ] **Step 8: Run frontend tests and type check**

Run:

```powershell
npm run test:unit
npm run type-check
```

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add IM-APP-fronend/src/types/chat.ts IM-APP-fronend/src/stores/chat.ts IM-APP-fronend/src/components/ConversationItem.vue IM-APP-fronend/src/utils/group-announcement.ts IM-APP-fronend/tests/retention-store.test.ts
git commit -m "feat: show join request alerts on group conversations"
```

---

### Task 5: End-to-end verification and cleanup

**Files:**
- No production files expected.
- Verify: `IM-APP-fronend/dist/build/h5` is rebuilt only if deploying.

**Interfaces:**
- Consumes all prior tasks.

- [ ] **Step 1: Run backend and frontend regression suites**

Run:

```powershell
go test ./... -count=1
npm run test:unit
npm run type-check
```

Expected: PASS.

- [ ] **Step 2: Verify H5 PC**

Use the local H5 verification workflow:

- Open `http://localhost:5173/#/`
- Log in with the local test account.
- Trigger a join request from a test user.
- As owner/admin, verify the actual group row shows `[有新的进群申请]` and a red dot.
- Open the group and verify the red tag/dot disappear.
- Verify no new `imAdmin` conversation is created.

- [ ] **Step 3: Verify H5 mobile**

Repeat the same flow at `390x844`; verify the group row, red dot, and clear-on-enter behavior.

- [ ] **Step 4: App native manual check**

Report as manual:

- Verify `OnRecvCustomBusinessMessage` reaches the App native bridge.
- Verify the group row updates and the red dot clears on entering the group.
- If the event is not delivered, do not mark complete; add a pending-count reconciliation task.

- [ ] **Step 5: Final status**

Report:

- Tests run and results.
- H5 PC/mobile evidence.
- App manual verification status.
- Any remaining risk, especially business-notification delivery on native.

