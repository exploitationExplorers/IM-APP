package service

// 账号注销业务编排（iOS 上架合规：Apple 5.1.1(v) 要求 App 内可删除账号及关联数据）
//
// 关键设计：
//  1. 业务侧物理删除 users 行 —— users.phone / phone_e164 是唯一键，
//     删行后手机号自然释放，用户可同号重新注册。
//     登录态 auth_sessions 与绝大多数关联表已带 ON DELETE CASCADE，随行清理。
//  2. 群主不自动转让 —— 转让给谁无法由系统决定，改为在 Preview 阶段返回 blockers
//     让用户先处理；groups.owner_id 保持 NO ACTION 作为最后一道防线。
//  3. IM / 对象存储清理是旁路的，失败只记 audit 表，**绝不让主流程回滚**，
//     否则会出现「用户点了注销却没销掉」这种最坏结果。

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"log"
	"strings"
	"time"

	"im-app-server/internal/im"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

const (
	// AccountDeletionConfirmPhrase 二级确认短语：前端需让用户原样输入。
	AccountDeletionConfirmPhrase = "DELETE_MY_ACCOUNT"
	// AccountDeletionSMSScene 注销专用短信 scene，与登录/注册额度互不干扰。
	AccountDeletionSMSScene = "delete_account"
	// AccountDeletionVerifyMethod 审计记录里的验证方式标记。
	AccountDeletionVerifyMethod = "sms"
	// accountDeletionIMCleanupTimeout 旁路清理（踢线 + 匿名化）的总时限。
	// 超时只把清理结果记为 failed，不影响注销本身——业务数据已经删掉了。
	accountDeletionIMCleanupTimeout = 8 * time.Second
)

// AccountDeletionBlockedError 存在前置阻碍（如仍是群主）时返回。
type AccountDeletionBlockedError struct {
	Blockers []models.AccountDeletionBlocker
}

func (e *AccountDeletionBlockedError) Error() string {
	return fmt.Sprintf("account deletion blocked by %d blocker(s)", len(e.Blockers))
}

// AccountDeletionService 注销流程编排。
type AccountDeletionService struct {
	Deletions *repository.AccountDeletionRepo
	Users     *repository.UserRepo
	IM        *im.Client
	// HashKey 用于审计表里的 HMAC 哈希（审计表不落任何明文个人数据）。
	// 复用服务端长期密钥即可；换了密钥只会让历史哈希无法复现核对，
	// 不影响已完成的删除。
	HashKey string
}

// Preview 返回注销前置检查与影响范围。
func (s *AccountDeletionService) Preview(ctx context.Context, userID string) (models.AccountDeletionPreview, error) {
	blockers, err := s.Deletions.OwnedActiveGroups(ctx, userID)
	if err != nil {
		return models.AccountDeletionPreview{}, err
	}
	summary, err := s.Deletions.Summary(ctx, userID)
	if err != nil {
		return models.AccountDeletionPreview{}, err
	}
	if blockers == nil {
		blockers = []models.AccountDeletionBlocker{}
	}
	return models.AccountDeletionPreview{
		CanDelete:          len(blockers) == 0,
		Blockers:           blockers,
		Summary:            summary,
		ConfirmPhrase:      AccountDeletionConfirmPhrase,
		VerificationMethod: AccountDeletionVerifyMethod,
	}, nil
}

// AccountDeletionInput 注销入参。
type AccountDeletionInput struct {
	UserID string
	// 用户提交的手机号，必须与账号登记的一致（防越权注销他人账号）
	CountryCode     string
	Phone           string
	RequestIP       string
	RequestUserAgent string
}

// Delete 执行注销：校验 → 采集 → 原子删除 → 旁路清理。
func (s *AccountDeletionService) Delete(ctx context.Context, in AccountDeletionInput) (models.DeleteAccountResult, error) {
	user, err := s.Users.FindByID(ctx, in.UserID)
	if err != nil {
		return models.DeleteAccountResult{}, ErrNotFound
	}

	// 越权防护：登录态所属的账号必须与提交的手机号一致
	ownerE164, _ := NormalizeE164(user.CountryCode, user.Phone)
	wantE164, err := NormalizeE164(in.CountryCode, in.Phone)
	if err != nil || wantE164 == "" || !strings.EqualFold(ownerE164, wantE164) {
		return models.DeleteAccountResult{}, ErrForbidden
	}

	// 双保险：前端已按 Preview 拦过一次，这里再查，防止并发或接口被绕过
	blockers, err := s.Deletions.OwnedActiveGroups(ctx, in.UserID)
	if err != nil {
		return models.DeleteAccountResult{}, err
	}
	if len(blockers) > 0 {
		return models.DeleteAccountResult{}, &AccountDeletionBlockedError{Blockers: blockers}
	}

	summary, err := s.Deletions.Summary(ctx, in.UserID)
	if err != nil {
		return models.DeleteAccountResult{}, err
	}

	recordID, err := s.Deletions.DeleteAtomically(ctx, repository.AccountDeletionRecord{
		UserID:               in.UserID,
		PhoneE164Hash:        s.hmacHex(ownerE164),
		NicknameHash:         s.hmacHex(user.Nickname),
		CountryCode:          user.CountryCode,
		RequestIP:            in.RequestIP,
		RequestUserAgent:     in.RequestUserAgent,
		VerificationMethod:   AccountDeletionVerifyMethod,
		Summary:              summary,
		IMCleanupStatus:      "pending",
		StorageCleanupStatus: "skipped", // 对象存储交给桶生命周期规则，不在此清理
	})
	if err != nil {
		return models.DeleteAccountResult{}, err
	}

	// 走到这里业务数据已删除，之后的清理失败只留痕，不影响返回成功
	imStatus := "skipped"
	if s.IM != nil && s.IM.Available() {
		imStatus = "done"
		if imUserID, convErr := im.UserIDFromBusinessID(in.UserID); convErr != nil {
			imStatus = "failed"
			log.Printf("[account-deletion] user=%s im id convert failed: %v", in.UserID, convErr)
		} else {
			// 旁路清理绝不能拖住注销请求：ForceLogoutAll 会按平台逐个踢，
			// OpenIM 不可达时每次调用都要等满客户端超时（10s），9 个平台能拖到
			// 一分多钟，用户只会看到「注销一直转圈」。这里给整体设上限，
			// 超时的清理结果记为 failed，留待后台补偿。
			cleanupCtx, cancel := context.WithTimeout(ctx, accountDeletionIMCleanupTimeout)
			defer cancel()

			// OpenIM v3 没有删除用户接口（v3.8.3 路由已核对），
			// 只能强制下线 + 匿名化昵称头像；业务侧 users 行已删，
			// 用户再也拿不到 OpenIM token，效果等价于账号失效。
			if err := s.IM.ForceLogoutAll(cleanupCtx, imUserID); err != nil {
				imStatus = "failed"
				log.Printf("[account-deletion] user=%s force logout failed: %v", in.UserID, err)
			}
			if err := s.IM.AnonymizeUser(cleanupCtx, imUserID); err != nil && imStatus == "done" {
				imStatus = "failed"
				log.Printf("[account-deletion] user=%s anonymize failed: %v", in.UserID, err)
			}
		}
	}
	if err := s.Deletions.MarkCleanup(ctx, recordID, imStatus, "", "skipped", ""); err != nil {
		log.Printf("[account-deletion] user=%s mark cleanup failed: %v", in.UserID, err)
	}

	return models.DeleteAccountResult{
		OK:        true,
		DeletedAt: time.Now().UTC().Format(time.RFC3339),
		RecordID:  recordID,
		IMCleanup: imStatus,
	}, nil
}

// hmacHex 对敏感值做不可逆哈希，供审计表留痕。
func (s *AccountDeletionService) hmacHex(value string) string {
	key := strings.TrimSpace(s.HashKey)
	if key == "" {
		key = "account-deletion-audit"
	}
	mac := hmac.New(sha256.New, []byte(key))
	mac.Write([]byte(value))
	return hex.EncodeToString(mac.Sum(nil))
}
