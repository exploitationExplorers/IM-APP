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

func (s *DataService) SetGroupMuteAll(ctx context.Context, id string, req models.MuteAllRequest, operatorID string) error {
	return s.Repo.SetGroupMuteAll(ctx, id, *req.Muted, req.Reason, operatorID)
}

func (s *DataService) SetGroupAddFriend(ctx context.Context, id string, req models.MemberAddFriendRequest, operatorID string) error {
	return s.Repo.SetGroupAddFriend(ctx, id, *req.Enabled, req.Reason, operatorID)
}

func (s *DataService) DissolveGroup(ctx context.Context, id string, req models.DissolveRequest, operatorID string) error {
	return s.Repo.DissolveGroup(ctx, id, req.Reason, operatorID)
}

func (s *DataService) ListGroupRecallLogs(ctx context.Context, id string, page, size int) ([]models.RecallLog, int64, error) {
	return s.Repo.ListGroupRecallLogs(ctx, id, size, (page-1)*size)
}

func (s *DataService) RecallMessage(ctx context.Context, groupID, messageID string, req models.AdminRecallRequest, operatorID string) error {
	return s.Repo.RecallMessage(ctx, groupID, messageID, req.Reason, operatorID)
}
