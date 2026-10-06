package service

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"time"

	"im-app-server/internal/models"
	"im-app-server/internal/repository"
)

var (
	ErrNotFound      = errors.New("not found")
	ErrForbidden     = errors.New("forbidden")
	ErrAlreadyFriend = errors.New("already friend")
	ErrSelfAction    = errors.New("cannot act on self")
)

type UserService struct {
	Users    *repository.UserRepo
	Files    *repository.FileRepo
	Contacts *repository.ContactRepo
	Privacy  *repository.PrivacyRepo
	Groups   *repository.GroupRepo
}

func (s *UserService) GetProfile(ctx context.Context, uid string) (models.User, error) {
	u, err := s.Users.FindByID(ctx, uid)
	if err != nil {
		return u, ErrNotFound
	}
	u.PasswordHash = ""
	return u, nil
}

// UpdateProfile 部分更新：传了哪个字段就更新哪个；avatarFileID 解析为头像 URL
func (s *UserService) UpdateProfile(ctx context.Context, uid string, nickname, avatarFileID, bio *string) (models.User, error) {
	if nickname != nil && (len(*nickname) < 1 || len(*nickname) > 32) {
		return models.User{}, errors.New("nickname length invalid")
	}
	var avatarURL *string
	if avatarFileID != nil && *avatarFileID != "" {
		f, err := s.Files.FindReadyAvatarByID(ctx, *avatarFileID, uid)
		if err != nil {
			return models.User{}, errors.New("头像文件不存在")
		}
		if f.URL != "" {
			avatarURL = &f.URL
		}
	}
	u, err := s.Users.UpdateProfile(ctx, uid, nickname, avatarURL, bio)
	if err != nil {
		return u, err
	}
	u.PasswordHash = ""
	return u, nil
}

// 聊天号格式（用户手动设置时校验）：6–20 位、首位必须是字母、其余只能是字母或数字。
//
// 系统自动分配的号固定 8 位（repository.randomPublicID），这里放宽到 6–20 是让用户
// 有机会挑一个更好记的，对齐微信号的习惯。一律按小写处理：存小写、搜索也按小写比，
// 免得用户存了 K7m2X9qp 之后自己搜 Km2x9qp 搜不到。
var publicIDPattern = regexp.MustCompile(`^[a-z][a-z0-9]{5,19}$`)

// NormalizePublicID 归一化并校验用户填的聊天号，返回是否合法。
func NormalizePublicID(raw string) (string, bool) {
	id := strings.ToLower(strings.TrimSpace(raw))
	return id, publicIDPattern.MatchString(id)
}

// UpdatePublicID 把系统分配的聊天号换成用户自己想要的，一个账号只能改一次。
//
// ★ 「改过没有」看的是 users.public_id_changed_at，注册时自动分配的随机号不算改过，
//
//	所以新用户拿到系统号之后仍有这一次机会。
func (s *UserService) UpdatePublicID(ctx context.Context, uid, raw string) (models.User, error) {
	publicID, ok := NormalizePublicID(raw)
	if !ok {
		return models.User{}, errors.New("聊天号需 6-20 位，以字母开头，只能用字母和数字")
	}
	used, err := s.Users.PublicIDChangeUsed(ctx, uid)
	if err != nil {
		return models.User{}, err
	}
	if used {
		return models.User{}, errors.New("聊天号只能修改一次")
	}
	taken, err := s.Users.PublicIDTaken(ctx, publicID, uid)
	if err != nil {
		return models.User{}, err
	}
	if taken {
		return models.User{}, errors.New("该聊天号已被使用")
	}
	if err := s.Users.UpdatePublicID(ctx, uid, publicID); err != nil {
		// 上面查过一次，但并发下仍可能被别人抢先，统一翻译成同一句话
		switch {
		case errors.Is(err, repository.ErrPublicIDChangeUsed):
			return models.User{}, errors.New("聊天号只能修改一次")
		case errors.Is(err, repository.ErrPublicIDTaken):
			return models.User{}, errors.New("该聊天号已被使用")
		}
		return models.User{}, err
	}
	u, err := s.Users.FindByID(ctx, uid)
	if err != nil {
		return models.User{}, err
	}
	u.PasswordHash = ""
	return u, nil
}

func (s *UserService) SearchByPublicID(ctx context.Context, uid, publicID string) (*models.PublicProfile, error) {
	// 聊天号一律按小写存储（见 NormalizePublicID），搜索也必须归一化 ——
	// 否则用户照着名片输入 K7m2X9qp 会搜不到 k7m2x9qp。
	u, err := s.Users.FindByPublicID(ctx, strings.ToLower(strings.TrimSpace(publicID)))
	if err != nil {
		return nil, nil
	}
	if u.ID == uid {
		return nil, errors.New("cannot search self")
	}
	pub := repository.ToPublicProfile(u)
	return &pub, nil
}

func (s *UserService) GetPublicProfile(ctx context.Context, viewerID, userID, groupPublicID string) (models.PublicProfile, error) {
	u, err := s.Users.FindByID(ctx, userID)
	if err != nil {
		return models.PublicProfile{}, ErrNotFound
	}
	pub := repository.ToPublicProfile(u)
	// 从群成员资料进入时：普通成员只能看到脱敏聊天号；群主/管理员可见完整 ID（可加任意成员）
	if groupPublicID != "" && viewerID != "" && viewerID != userID && s.Groups != nil {
		internalID, ierr := s.Groups.InternalIDByPublicID(ctx, groupPublicID)
		if ierr == nil {
			role, rerr := s.Groups.MemberRoleOf(ctx, internalID, viewerID)
			if rerr == nil && role != "owner" && role != "admin" {
				pub.PublicID = MaskPublicID(pub.PublicID)
			}
		}
	}
	return pub, nil
}

func (s *UserService) Qrcode(ctx context.Context, uid string) (models.UserQRCodeResult, error) {
	u, err := s.Users.FindByID(ctx, uid)
	if err != nil {
		return models.UserQRCodeResult{}, ErrNotFound
	}
	// 返回该用户唯一二维码（无则生成）
	qr, err := s.Users.EnsureQRCode(ctx, uid)
	if err != nil {
		return models.UserQRCodeResult{}, err
	}
	payload, _ := json.Marshal(map[string]string{
		"type":  "user",
		"token": qr.Token,
	})
	return models.UserQRCodeResult{
		Payload:   string(payload),
		ExpiresAt: qr.ExpiresAt.UTC().Format(time.RFC3339),
		User: models.UserSummary{
			ID:       u.ID,
			PublicID: u.PublicID,
			Nickname: u.Nickname,
			Avatar:   u.Avatar,
		},
	}, nil
}

func (s *UserService) VerifyPassword(ctx context.Context, uid, oldPassword string) error {
	if oldPassword == "" {
		return errors.New("请输入旧密码")
	}
	u, err := s.Users.FindByID(ctx, uid)
	if err != nil {
		return ErrNotFound
	}
	if !u.PasswordSet {
		return errors.New("尚未设置密码")
	}
	if err := serviceComparePassword(u.PasswordHash, oldPassword); err != nil {
		return errors.New("旧密码不正确")
	}
	return nil
}

func (s *UserService) ChangePassword(ctx context.Context, uid, newPassword, oldPassword string) error {
	if len(newPassword) < 6 {
		return errors.New("密码至少 6 位")
	}
	u, err := s.Users.FindByID(ctx, uid)
	if err != nil {
		return ErrNotFound
	}
	if u.PasswordSet {
		if oldPassword == "" {
			return errors.New("请输入旧密码")
		}
		if err := serviceComparePassword(u.PasswordHash, oldPassword); err != nil {
			return errors.New("旧密码不正确")
		}
	}
	hash, err := serviceHashPassword(newPassword)
	if err != nil {
		return err
	}
	return s.Users.UpdatePassword(ctx, uid, hash)
}

func (s *UserService) ResolveUserQRCode(ctx context.Context, uid, token string) (models.UserQRCodeResolveResult, error) {
	if token == "" {
		return models.UserQRCodeResolveResult{}, errors.New("无效的二维码")
	}
	u, err := s.Users.ResolveUserQRCode(ctx, token)
	if err != nil {
		return models.UserQRCodeResolveResult{}, ErrNotFound
	}
	relation, _ := s.relationWith(ctx, uid, u.ID)
	return models.UserQRCodeResolveResult{
		User:     withRelationProfile(u, relation),
		Relation: relation,
	}, nil
}

func (s *UserService) relationWith(ctx context.Context, uid, otherID string) (string, error) {
	if uid == otherID {
		return "self", nil
	}
	if s.Contacts != nil {
		blocked, _ := s.Contacts.IsBlocked(ctx, uid, otherID)
		if blocked {
			return "blocked", nil
		}
		blockedBy, _ := s.Contacts.IsBlocked(ctx, otherID, uid)
		if blockedBy {
			return "blocked", nil
		}
		ok, _ := s.Contacts.IsFriend(ctx, uid, otherID)
		if ok {
			return "friend", nil
		}
		pending, _ := s.Contacts.HasPendingRequest(ctx, uid, otherID)
		if pending {
			return "pending", nil
		}
	}
	return "none", nil
}

func withRelationProfile(u models.User, relation string) models.PublicProfile {
	p := repository.ToPublicProfile(u)
	p.Relation = relation
	return p
}

func (s *UserService) GetPrivacySettings(ctx context.Context, uid string) (models.PrivacySettings, error) {
	if s.Privacy == nil {
		return models.PrivacySettings{
			RequireFriendApproval: false,
			RequireGroupApproval:  false,
		}, nil
	}
	return s.Privacy.Get(ctx, uid)
}

func (s *UserService) UpdatePrivacySettings(ctx context.Context, uid string, in models.PrivacySettings) (models.PrivacySettings, error) {
	if s.Privacy == nil {
		return in, errors.New("隐私设置不可用")
	}
	return s.Privacy.Update(ctx, uid, in)
}
