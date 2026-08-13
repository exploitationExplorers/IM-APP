package service

import (
	"context"

	"im-app-admin/internal/models"
	"im-app-admin/internal/repository"
)

// DataService 用户/群组/转发/短信/运营配置业务
type DataService struct {
	Repo *repository.DataRepo
}

func (s *DataService) ListUsers(ctx context.Context, keyword string, page, size int) ([]models.AdminUser, error) {
	return s.Repo.ListUsers(ctx, keyword, size, (page-1)*size)
}

func (s *DataService) GetUserDetail(ctx context.Context, userID string) (*models.AdminUserDetail, error) {
	return s.Repo.GetUserDetail(ctx, userID)
}

func (s *DataService) UpdateUserStatus(ctx context.Context, userID, status string) error {
	return s.Repo.UpdateUserStatus(ctx, userID, status)
}

func (s *DataService) ListUserReports(ctx context.Context, userID string, page, size int) ([]models.ReportRecord, error) {
	return s.Repo.ListUserReports(ctx, userID, size, (page-1)*size)
}

func (s *DataService) ListGroups(ctx context.Context, keyword string, page, size int) ([]models.AdminGroup, error) {
	return s.Repo.ListGroups(ctx, keyword, size, (page-1)*size)
}

func (s *DataService) ListGroupMembers(ctx context.Context, groupID string) ([]models.AdminGroupMember, error) {
	return s.Repo.ListGroupMembers(ctx, groupID)
}

func (s *DataService) UpdateGroupStatus(ctx context.Context, groupID, status string) error {
	return s.Repo.UpdateGroupStatus(ctx, groupID, status)
}

func (s *DataService) MuteGroupAll(ctx context.Context, groupID string, muted bool) error {
	return s.Repo.MuteGroupAll(ctx, groupID, muted)
}

func (s *DataService) ListGroupRecallLogs(ctx context.Context, groupID string, page, size int) ([]models.RecallLog, error) {
	return s.Repo.ListGroupRecallLogs(ctx, groupID, size, (page-1)*size)
}

func (s *DataService) ListForwardTasks(ctx context.Context, status string, page, size int) ([]models.AdminForwardTask, error) {
	return s.Repo.ListForwardTasks(ctx, status, size, (page-1)*size)
}

func (s *DataService) ListSmsLogs(ctx context.Context, page, size int) ([]models.SmsLog, error) {
	return s.Repo.ListSmsLogs(ctx, size, (page-1)*size)
}

func (s *DataService) ListAppVersions(ctx context.Context) ([]models.AppVersion, error) {
	return s.Repo.ListAppVersions(ctx)
}

func (s *DataService) CreateAppVersion(ctx context.Context, v models.AppVersion) error {
	return s.Repo.CreateAppVersion(ctx, v)
}

func (s *DataService) ListPolicies(ctx context.Context) ([]models.AppPolicy, error) {
	return s.Repo.ListPolicies(ctx)
}

func (s *DataService) SavePolicy(ctx context.Context, p models.AppPolicy) error {
	return s.Repo.SavePolicy(ctx, p)
}

func (s *DataService) ListSensitiveWords(ctx context.Context) ([]models.SensitiveWord, error) {
	return s.Repo.ListSensitiveWords(ctx)
}

func (s *DataService) CreateSensitiveWord(ctx context.Context, w models.SensitiveWord) error {
	return s.Repo.CreateSensitiveWord(ctx, w)
}

func (s *DataService) DeleteSensitiveWord(ctx context.Context, id string) error {
	return s.Repo.DeleteSensitiveWord(ctx, id)
}

func (s *DataService) ListCountries(ctx context.Context) ([]models.Country, error) {
	return s.Repo.ListCountries(ctx)
}

func (s *DataService) UpdateCountry(ctx context.Context, code string, enabled bool) error {
	return s.Repo.UpdateCountry(ctx, code, enabled)
}

func (s *DataService) GetGroupDetail(ctx context.Context, groupID string) (*models.AdminGroupDetail, error) {
	return s.Repo.GetGroupDetail(ctx, groupID)
}

func (s *DataService) UpdateGroupSettings(ctx context.Context, groupID string, req models.UpdateGroupSettingsRequest) error {
	return s.Repo.UpdateGroupSettings(ctx, groupID, req)
}
