package service

import (
	"context"

	"im-app-admin/internal/models"
)

// ===== 群组 =====

func (s *DataService) ListGroups(ctx context.Context, keyword, status string, page, size int) ([]models.AppGroup, int64, error) {
	return s.Repo.ListGroups(ctx, keyword, status, size, (page-1)*size)
}

func (s *DataService) GetGroupDetail(ctx context.Context, id string) (*models.AppGroupDetail, error) {
	return s.Repo.GetGroupDetail(ctx, id)
}

func (s *DataService) ListGroupMembers(ctx context.Context, id string) ([]models.AppGroupMember, error) {
	return s.Repo.ListGroupMembers(ctx, id)
}

func (s *DataService) ListGroupReports(ctx context.Context, id string, page, size int) ([]models.Report, int64, error) {
	return s.Repo.ListGroupReports(ctx, id, size, (page-1)*size)
}

// SetGroupMuteAll 全员禁言/解除：方案 A —— 调 server（含 OpenIM 同步）+ 本地写群状态审计
func (s *DataService) SetGroupMuteAll(ctx context.Context, id string, req models.MuteAllRequest, operatorID string) error {
	if err := s.callServerGroupAction(ctx, "mute", id, map[string]any{
		"adminId": operatorID, "muted": *req.Muted, "reason": req.Reason,
	}); err != nil {
		return err
	}
	return s.Repo.LogGroupMute(ctx, id, *req.Muted, req.Reason, operatorID)
}

// SetGroupAddFriend 群内互加好友开关：方案 A —— 调 server（含 OpenIM 同步）
func (s *DataService) SetGroupAddFriend(ctx context.Context, id string, req models.MemberAddFriendRequest, operatorID string) error {
	return s.callServerGroupAction(ctx, "add-friend", id, map[string]any{
		"adminId": operatorID, "enabled": *req.Enabled,
	})
}

// DissolveGroup 解散群：方案 A —— 动作前快照群状态，再调 server 内部接口解散（含 OpenIM 同步），成功后本地写群状态审计
func (s *DataService) DissolveGroup(ctx context.Context, id string, req models.DissolveRequest, operatorID string) error {
	from, err := s.Repo.GetGroupStatus(ctx, id)
	if err != nil {
		return err
	}
	if err := s.callServerGroupAction(ctx, "dismiss", id, map[string]any{
		"adminId": operatorID, "reason": req.Reason,
	}); err != nil {
		return err
	}
	return s.Repo.LogGroupDissolve(ctx, id, from, req.Reason, operatorID)
}

// ListGroupStatusLogs 群状态变更记录（分页）
func (s *DataService) ListGroupStatusLogs(ctx context.Context, id string, page, size int) ([]models.GroupStatusLog, int64, error) {
	return s.Repo.ListGroupStatusLogs(ctx, id, size, (page-1)*size)
}

// callServerGroupAction 调 server /internal/admin 接口执行群管理操作（由 server 改库 + 同步 OpenIM）
func (s *DataService) callServerGroupAction(ctx context.Context, action, groupID string, payload map[string]any) error {
	_, err := callServerInternal(ctx, s.ServerBaseURL, s.ServerInternalKey,
		"/internal/admin/groups/"+groupID+"/"+action, payload)
	return err
}

func (s *DataService) ListGroupRecallLogs(ctx context.Context, id string, page, size int) ([]models.RecallLog, int64, error) {
	return s.Repo.ListGroupRecallLogs(ctx, id, size, (page-1)*size)
}

// RecallMessage 管理撤回消息：方案 A —— 有 clientMsgId/conversationId 时调 server 真正撤回 OpenIM + 本地审计；
// 无 OpenIM 定位信息时退化为本地标记+审计（不真正撤回 OpenIM）
func (s *DataService) RecallMessage(ctx context.Context, groupID, messageID string, req models.AdminRecallRequest, operatorID string) error {
	if req.ClientMsgID != "" || req.ConversationID != "" {
		if _, err := callServerInternal(ctx, s.ServerBaseURL, s.ServerInternalKey,
			"/internal/admin/messages/"+messageID+"/recall",
			map[string]any{
				"adminId": operatorID, "reason": req.Reason,
				"clientMsgId": req.ClientMsgID, "conversationId": req.ConversationID, "seq": req.Seq,
			}); err != nil {
			return err
		}
		return s.Repo.LogMessageRecall(ctx, groupID, messageID, req.Reason, operatorID)
	}
	return s.Repo.RecallMessage(ctx, groupID, messageID, req.Reason, operatorID)
}
