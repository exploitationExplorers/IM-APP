package models

import "time"

type User struct {
	ID           string    `json:"id"`
	Phone        string    `json:"phone"`
	CountryCode  string    `json:"countryCode"`
	PublicID     string    `json:"publicId"`
	PasswordHash string    `json:"-"`
	Nickname     string    `json:"nickname"`
	Avatar       string    `json:"avatar"`
	Bio          string    `json:"bio"`
	Status       string    `json:"status,omitempty"`
	CreatedAt    time.Time `json:"createdAt"`
}

type QrcodePayload struct {
	PublicID  string `json:"publicId"`
	Nickname  string `json:"nickname"`
	Avatar    string `json:"avatar"`
	Payload   string `json:"payload"`
}

type LoginResult struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

type Conversation struct {
	ID            string    `json:"id"`
	Type          string    `json:"type"`
	Title         string    `json:"title"`
	Avatar        string    `json:"avatar"`
	LastMessage   string    `json:"lastMessage"`
	LastMessageAt time.Time `json:"lastMessageAt"`
	UnreadCount   int       `json:"unreadCount"`
	HighlightTag  string    `json:"highlightTag,omitempty"`
	PeerUserID    string    `json:"peerUserId,omitempty"`
}

type Message struct {
	ID             string    `json:"id"`
	ConversationID string    `json:"conversationId"`
	SenderID       string    `json:"senderId"`
	Type           string    `json:"type"`
	Content        string    `json:"content"`
	CreatedAt      time.Time `json:"createdAt"`
}

type Contact struct {
	ID           string           `json:"id"`
	PublicID     string           `json:"publicId,omitempty"`
	Nickname     string           `json:"nickname"`
	Avatar       string           `json:"avatar"`
	Remark       string           `json:"remark"`
	Tags         []ContactTagItem `json:"tags,omitempty"`
	CommonGroups []GroupPreview   `json:"commonGroups"`
}

// PublicProfile 他人可见的公开资料（不含手机号）
type PublicProfile struct {
	ID        string `json:"id"`
	PublicID  string `json:"publicId"`
	Nickname  string `json:"nickname"`
	Avatar    string `json:"avatar"`
	Bio       string `json:"bio,omitempty"`
	Status    string `json:"status,omitempty"`
	CreatedAt string `json:"createdAt,omitempty"`
	Relation  string `json:"relation,omitempty"` // self|none|pending|friend|blocked
}

type GroupPreview struct {
	ID             string `json:"id"`
	Name           string `json:"name"`
	Avatar         string `json:"avatar"`
	Role           string `json:"role,omitempty"`
	ConversationID string `json:"conversationId,omitempty"`
}

type FriendRequest struct {
	ID        string    `json:"id"`
	FromUser  Contact   `json:"fromUser"`
	Message   string    `json:"message"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt"`
}

// PrivacySettings 对齐参考站：默认加好友无需验证
type PrivacySettings struct {
	RequireFriendApproval bool `json:"requireFriendApproval"`
	RequireGroupApproval  bool `json:"requireGroupApproval"`
}

// SendFriendResult status: pending|accepted
type SendFriendResult struct {
	OK     bool   `json:"ok"`
	ID     string `json:"id,omitempty"`
	Status string `json:"status"`
}
