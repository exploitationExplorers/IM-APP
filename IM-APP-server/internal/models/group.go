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
}
