package models

type GroupInfo struct {
	ID                   string            `json:"id"`
	Name                 string            `json:"name"`
	Avatar               string            `json:"avatar"`
	OwnerID              string            `json:"ownerId"`
	MemberCount          int               `json:"memberCount"`
	Announcement         string            `json:"announcement,omitempty"`
	AllowMemberAddFriend bool              `json:"allowMemberAddFriend"`
	ConversationID       string            `json:"conversationId,omitempty"`
	MyRole               string            `json:"myRole,omitempty"`
	MyNickname           string            `json:"myNickname,omitempty"`
	JoinMode             string            `json:"joinMode"`
	AllMuted             bool              `json:"allMuted"`
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
	ID            string `json:"id"`
	Nickname      string `json:"nickname"`
	GroupNickname string `json:"groupNickname"`
	DisplayName   string `json:"displayName"`
	Avatar        string `json:"avatar"`
	Role          string `json:"role"`
	MemberRemark  string `json:"memberRemark,omitempty"`
}

type CreateGroupReq struct {
	Name      string   `json:"name"`
	MemberIDs []string `json:"memberIds"`
}

type UpdateGroupSettingsReq struct {
	Name                 *string `json:"name"`
	AvatarFileID         *string `json:"avatarFileId"`
	Announcement         *string `json:"announcement"`
	AllowMemberAddFriend *bool   `json:"allowMemberAddFriend"`
	JoinMode             *string `json:"joinMode"`
	AllMuted             *bool   `json:"allMuted"`
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

type UpdateGroupMemberMuteReq struct {
	MutedSeconds int64 `json:"mutedSeconds"`
}

type UpdateGroupMuteReq struct {
	Muted bool `json:"muted"`
}

type UpdateGroupRemarkReq struct {
	Remark string `json:"remark"`
}

type UpdateMemberRemarkReq struct {
	Remark string `json:"remark"`
}
