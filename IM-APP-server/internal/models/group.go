package models

type GroupInfo struct {
	ID                    string `json:"id"`
	Name                  string `json:"name"`
	Avatar                string `json:"avatar"`
	OwnerID               string `json:"ownerId"`
	MemberCount           int    `json:"memberCount"`
	Announcement          string `json:"announcement,omitempty"`
	AllowMemberAddFriend  bool   `json:"allowMemberAddFriend"`
	ConversationID        string `json:"conversationId,omitempty"`
}

type GroupMember struct {
	ID       string `json:"id"`
	Nickname string `json:"nickname"`
	Avatar   string `json:"avatar"`
	Role     string `json:"role"`
}

type CreateGroupReq struct {
	Name      string   `json:"name"`
	MemberIDs []string `json:"memberIds"`
}

type UpdateGroupSettingsReq struct {
	Announcement         *string `json:"announcement"`
	AllowMemberAddFriend *bool   `json:"allowMemberAddFriend"`
	JoinMode             *string `json:"joinMode"`
	AllMuted             *bool   `json:"allMuted"`
}

type InviteGroupMembersReq struct {
	UserIDs []string `json:"userIds"`
}

type CreateGroupJoinReq struct {
	Remark      string `json:"remark"`
	InviteToken string `json:"inviteToken"`
}

type UpdateMemberRoleReq struct {
	Role string `json:"role"` // admin|member
}

type MuteMemberReq struct {
	MutedUntil string `json:"mutedUntil"` // RFC3339 or empty to unmute
}

type GroupJoinRequestItem struct {
	ID        string        `json:"id"`
	Status    string        `json:"status"`
	Remark    string        `json:"remark"`
	CreatedAt string        `json:"createdAt"`
	HandledAt string        `json:"handledAt,omitempty"`
	Applicant UserSummary   `json:"applicant"`
}

type JoinGroupResult struct {
	Group GroupInfo   `json:"group"`
	Role  string      `json:"role,omitempty"`
}

type ContactTagItem struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	MemberCount int64  `json:"memberCount"`
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
