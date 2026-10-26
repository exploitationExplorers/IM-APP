package im

import (
	"context"
	"errors"
	"im-app-server/internal/models"
)

// CancelAccount 不删其他成员的消息，清理该账号的漫游记录并使全部平台令牌失效。
func (c *Client) CancelAccount(ctx context.Context, userID string) error {
	var problems []error
	// ForceLogout 在 OpenIM 3.8 按单个平台失效，platformID=0 不代表全部设备。
	for platformID := 1; platformID <= 11; platformID++ {
		if err := c.postWithAdmin(ctx, "/auth/force_logout", map[string]any{"userID": userID, "platformID": platformID}, nil); err != nil {
			problems = append(problems, err)
		}
	}
	if err := c.UpdateUser(ctx, User{UserID: userID, Nickname: "已注销用户", FaceURL: models.DefaultAvatar}); err != nil {
		problems = append(problems, err)
	}
	if err := c.postWithAdmin(ctx, "/msg/user_clear_all_msg", map[string]any{"userID": userID, "deleteSyncOpt": map[string]bool{"isSyncSelf": true, "isSyncOther": false}}, nil); err != nil {
		problems = append(problems, err)
	}
	return errors.Join(problems...)
}
