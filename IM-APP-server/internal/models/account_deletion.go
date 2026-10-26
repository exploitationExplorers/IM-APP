package models

// 账号注销 DTO（iOS 上架合规：Apple 5.1.1(v) 要求 App 内可删除账号及关联数据）

// AccountDeletionBlocker 注销的前置阻碍项。
// 存在 blockers 时不允许提交注销，前端应逐条提示并给出可跳转的解决入口。
type AccountDeletionBlocker struct {
	Code string `json:"code"` // 机器可读：group_owner
	// 面向用户的中文说明，可直接展示
	Message string `json:"message"`
	// 建议动作：transfer（转让群主）| dismiss（解散群）
	Action string `json:"action"`
	// 关联群信息，前端据此跳转群管理页；非群类 blocker 时为空
	GroupID       string `json:"groupId,omitempty"`
	GroupPublicID string `json:"groupPublicId,omitempty"`
	GroupName     string `json:"groupName,omitempty"`
}

// AccountDeletionSummary 注销影响范围快照，删除前采集并写入审计表。
type AccountDeletionSummary struct {
	FriendCount     int `json:"friendCount"`
	GroupCount      int `json:"groupCount"`
	OwnedGroupCount int `json:"ownedGroupCount"`
	FavoriteCount   int `json:"favoriteCount"`
	FileCount       int `json:"fileCount"`
}

// AccountDeletionPreview GET /api/v1/me/deletion-preview 的响应。
type AccountDeletionPreview struct {
	// 无 blockers 时为 true；前端据此决定「下一步」是否可用
	CanDelete bool `json:"canDelete"`
	// 空数组表示无阻碍
	Blockers []AccountDeletionBlocker `json:"blockers"`
	Summary  AccountDeletionSummary   `json:"summary"`
	// 二级确认要求的输入文本，前端需让用户原样输入/长按确认
	ConfirmPhrase string `json:"confirmPhrase"`
	// 验证码通道说明（注销走独立 scene，与登录/注册额度互不干扰）
	VerificationMethod string `json:"verificationMethod"`
}

// DeleteAccountRequest POST /api/v1/me/account/delete 的请求体。
type DeleteAccountRequest struct {
	CountryCode string `json:"countryCode"`
	Phone       string `json:"phone"`
	// 短信验证码（scene=delete_account）
	Code string `json:"code"`
	// 二级确认：必须等于 preview 返回的 ConfirmPhrase
	Acknowledge string `json:"acknowledge"`
}

// DeleteAccountResult POST /api/v1/me/account/delete 的响应。
type DeleteAccountResult struct {
	OK bool `json:"ok"`
	// 注销完成时间（RFC3339）
	DeletedAt string `json:"deletedAt"`
	// 审计记录 ID，供申诉/核对
	RecordID string `json:"recordId"`
	// IM 侧清理结果：done|failed|skipped。failed 不代表注销失败，
	// 业务数据已删除，IM 残留由后台补偿任务处理。
	IMCleanup string `json:"imCleanup"`
}
