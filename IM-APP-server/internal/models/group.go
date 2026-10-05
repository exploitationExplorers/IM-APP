package models

import "time"

type GroupInfo struct {
	ID                   string            `json:"id"`
	Name                 string            `json:"name"`
	Avatar               string            `json:"avatar"`
	OwnerID              string            `json:"ownerId"`
	OwnerName            string            `json:"ownerName,omitempty"`
	MemberCount          int               `json:"memberCount"`
	MaxMembers           int               `json:"maxMembers"`
	Announcement         string            `json:"announcement,omitempty"`
	AnnouncementImages   []string          `json:"announcementImages,omitempty"`
	AllowMemberAddFriend bool              `json:"allowMemberAddFriend"`
	ConversationID       string            `json:"conversationId,omitempty"`
	MyRole               string            `json:"myRole,omitempty"`
	MyNickname           string            `json:"myNickname,omitempty"`
	JoinMode             string            `json:"joinMode"`
	AllMuted             bool              `json:"allMuted"`
	CanChat              *bool             `json:"canChat,omitempty"`
	DenyReason           string            `json:"denyReason,omitempty"`
	IsMuted              *bool             `json:"isMuted,omitempty"`
	MutedUntil           *time.Time        `json:"mutedUntil,omitempty"`
	Permissions          *GroupPermissions `json:"permissions,omitempty"`
	Remark               string            `json:"remark,omitempty"`
}

type GroupPermissions struct {
	CanEditProfile      bool `json:"canEditProfile"`
	CanEditAnnouncement bool `json:"canEditAnnouncement"`
	CanViewQRCode       bool `json:"canViewQRCode"`
	CanManageMembers    bool `json:"canManageMembers"`
	CanEditMyNickname   bool `json:"canEditMyNickname"`
	CanReport           bool `json:"canReport"`
}

type GroupMember struct {
	ID            string     `json:"id"`
	Nickname      string     `json:"nickname"`
	GroupNickname string     `json:"groupNickname"`
	DisplayName   string     `json:"displayName"`
	Avatar        string     `json:"avatar"`
	Role          string     `json:"role"`
	MemberRemark  string     `json:"memberRemark,omitempty"`
	IsMuted       bool       `json:"isMuted"`
	MutedUntil    *time.Time `json:"mutedUntil"`
}

// GroupMessagePurge 记录「某成员在群内的消息被管理员清理过」。
// 客户端据此隐藏该成员 PurgedAt 之前发的消息；晚于它的（重新入群后新发的）照常显示。
type GroupMessagePurge struct {
	UserID   string    `json:"userId"`
	PurgedAt time.Time `json:"purgedAt"`
}

// RemoveGroupMemberReq 是移除群成员的请求体，DELETE 带 body（前端 request.ts 对非 GET
// 一律把 data 放进 body，不走 query）。字段可选，老客户端不带 body 时按「仅移除」处理。
type RemoveGroupMemberReq struct {
	DeleteMessages bool `json:"deleteMessages"`
}

type CreateGroupReq struct {
	Name      string   `json:"name"`
	MemberIDs []string `json:"memberIds"`
}

type UpdateGroupSettingsReq struct {
	GroupID      string  `json:"groupId"`
	Name         *string `json:"name"`
	AvatarFileID *string `json:"avatarFileId"`
	Announcement *string `json:"announcement"`
	// 与公告一并提交：新上传 fileId；保留的已有图片 URL。仅当 announcement 非 nil 时生效。
	AnnouncementImageFileIDs *[]string `json:"announcementImageFileIds"`
	KeepAnnouncementImages   *[]string `json:"keepAnnouncementImages"`
	AllowMemberAddFriend     *bool     `json:"allowMemberAddFriend"`
	JoinMode                 *string   `json:"joinMode"`
	AllMuted                 *bool     `json:"allMuted"`
}

type UpdateMyGroupNicknameReq struct {
	Nickname string `json:"nickname"`
}

type CreateGroupReportReq struct {
	GroupID      string   `json:"groupId"`
	Reason       string   `json:"reason"`
	Description  string   `json:"description"`
	ImageFileIDs []string `json:"imageFileIds"`
}

type GroupReportResult struct {
	ID         string   `json:"id"`
	Status     string   `json:"status"`
	ImagePaths []string `json:"imagePaths"`
	CreatedAt  string   `json:"createdAt"`
}

type InviteGroupMembersReq struct {
	UserIDs []string `json:"userIds"`
}

/** 邀请入群结果：直拉人数 + 需对方验证（已发卡）人数 */
type InviteGroupMembersResult struct {
	InvitedCount    int `json:"invitedCount"`
	PendingCount    int `json:"pendingCount"`
	CardFailedCount int `json:"cardFailedCount,omitempty"`
}

/** 被邀请人点击「申请入群」后的下一步 */
type ApplyGroupInvitationResult struct {
	NextAction string     `json:"nextAction"` // joined | pending_approval | already_member
	Group      *GroupInfo `json:"group,omitempty"`
}

type CreateGroupJoinReq struct {
	Remark      string `json:"remark"`
	InviteToken string `json:"inviteToken"`
}

type GroupJoinRequestItem struct {
	ID        string      `json:"id"`
	Status    string      `json:"status"`
	Remark    string      `json:"remark"`
	CreatedAt string      `json:"createdAt"`
	HandledAt string      `json:"handledAt,omitempty"`
	Applicant UserSummary `json:"applicant"`
}

type JoinGroupResult struct {
	Group GroupInfo `json:"group"`
	Role  string    `json:"role,omitempty"`
}

type ContactTagItem struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	MemberCount int64    `json:"memberCount"`
	MemberNames []string `json:"memberNames,omitempty"`
}

type SaveContactTagReq struct {
	Name string `json:"name"`
}

type SetTagMembersReq struct {
	UserIDs []string `json:"userIds"`
}

type UpdateContactReq struct {
	Remark *string  `json:"remark"`
	TagIDs []string `json:"tagIds,omitempty"`
}

type UpdateGroupMemberRoleReq struct {
	Role string `json:"role"`
}

type MuteGroupMemberReq struct {
	GroupID      string `json:"groupId"`
	MemberUserID string `json:"memberUserId"`
	MutedSeconds *int64 `json:"mutedSeconds"`
}

type UnmuteGroupMemberReq struct {
	GroupID      string `json:"groupId"`
	MemberUserID string `json:"memberUserId"`
}

type GroupMemberMuteResult struct {
	GroupID      string     `json:"groupId"`
	MemberUserID string     `json:"memberUserId"`
	IsMuted      bool       `json:"isMuted"`
	MutedUntil   *time.Time `json:"mutedUntil"`
	ChangedAt    time.Time  `json:"changedAt"`
}

// GroupAnnouncementHistoryItem 群公告历史一条
type GroupAnnouncementHistoryItem struct {
	ID            string   `json:"id"`
	Content       string   `json:"content"`
	Images        []string `json:"images,omitempty"`
	PublisherID   string   `json:"publisherId,omitempty"`
	PublisherName string   `json:"publisherName,omitempty"`
	CreatedAt     string   `json:"createdAt"`
}

type UpdateGroupRemarkReq struct {
	Remark string `json:"remark"`
}

type UpdateMemberRemarkReq struct {
	Remark string `json:"remark"`
}
