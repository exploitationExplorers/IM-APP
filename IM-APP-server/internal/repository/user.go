package repository

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"errors"
	"time"

	"im-app-server/internal/models"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type UserRepo struct {
	DB *pgxpool.Pool
}

func (r *UserRepo) FindByID(ctx context.Context, id string) (models.User, error) {
	var u models.User
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, phone, country_code, COALESCE(public_id,''), password_hash,
			nickname, avatar, bio, COALESCE(status,'active'), created_at, COALESCE(password_set, false)
		FROM users WHERE id=$1`, id,
	).Scan(&u.ID, &u.Phone, &u.CountryCode, &u.PublicID, &u.PasswordHash,
		&u.Nickname, &u.Avatar, &u.Bio, &u.Status, &u.CreatedAt, &u.PasswordSet)
	return u, err
}

func (r *UserRepo) FindByPhone(ctx context.Context, phone string) (models.User, error) {
	var u models.User
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, phone, country_code, COALESCE(public_id,''), password_hash,
			nickname, avatar, bio, COALESCE(status,'active'), created_at, COALESCE(password_set, false)
		FROM users WHERE phone=$1`, phone,
	).Scan(&u.ID, &u.Phone, &u.CountryCode, &u.PublicID, &u.PasswordHash,
		&u.Nickname, &u.Avatar, &u.Bio, &u.Status, &u.CreatedAt, &u.PasswordSet)
	return u, err
}

func (r *UserRepo) FindByPublicID(ctx context.Context, publicID string) (models.User, error) {
	var u models.User
	err := r.DB.QueryRow(ctx, `
		SELECT id::text, phone, country_code, COALESCE(public_id,''), password_hash,
			nickname, avatar, bio, COALESCE(status,'active'), created_at, COALESCE(password_set, false)
		FROM users WHERE public_id=$1`, publicID,
	).Scan(&u.ID, &u.Phone, &u.CountryCode, &u.PublicID, &u.PasswordHash,
		&u.Nickname, &u.Avatar, &u.Bio, &u.Status, &u.CreatedAt, &u.PasswordSet)
	return u, err
}

func (r *UserRepo) UpdateProfile(ctx context.Context, id string, nickname, avatar, bio *string) (models.User, error) {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return models.User{}, err
	}
	defer tx.Rollback(ctx)
	var u models.User
	err = tx.QueryRow(ctx, `
		UPDATE users SET
			nickname = COALESCE($2, nickname),
			avatar = COALESCE($3, avatar),
			bio = COALESCE($4, bio),
			updated_at = NOW()
		WHERE id=$1
		RETURNING id::text, phone, country_code, COALESCE(public_id,''), password_hash,
			nickname, avatar, bio, COALESCE(status,'active'), created_at, COALESCE(password_set, false)`,
		id, nickname, avatar, bio,
	).Scan(&u.ID, &u.Phone, &u.CountryCode, &u.PublicID, &u.PasswordHash,
		&u.Nickname, &u.Avatar, &u.Bio, &u.Status, &u.CreatedAt, &u.PasswordSet)
	if err != nil {
		return u, err
	}
	if err := EnqueueIMSyncTx(ctx, tx, IMEventUserProfileUpdated, u.ID, map[string]string{
		"nickname": u.Nickname, "avatar": u.Avatar,
	}); err != nil {
		return models.User{}, err
	}
	if err := tx.Commit(ctx); err != nil {
		return models.User{}, err
	}
	return u, nil
}

// 聊天号（users.public_id）相关的哨兵错误，供 service 翻译成给用户看的话术。
var (
	// ErrPublicIDChangeUsed 表示「改一次」的机会已经用掉了。
	ErrPublicIDChangeUsed = errors.New("public id change already used")
	// ErrPublicIDTaken 表示目标聊天号已被别人占用（含并发更新撞 UNIQUE 约束）。
	ErrPublicIDTaken = errors.New("public id already taken")
)

// 聊天号字符集一律小写：避免「看着一样、搜不到」的坑，查询侧也按小写比较。
// 系统发号对齐微信号 wxid_xxxxxxxxxx：chat_ + 14 位字母数字，例如 chat_ez1b8e1bc1dv12。
const (
	publicIDPrefix    = "chat_"
	publicIDSuffixLen = 14
	publicIDAlphanums = "abcdefghijklmnopqrstuvwxyz0123456789"
)

// randomChar 用拒绝采样取一个字符。256 不能整除字符集长度时，直接取模会让前几个
// 字符出现得更频繁，丢掉尾部多余字节即可消除偏置。
func randomChar(charset string) (byte, error) {
	n := len(charset)
	if n == 0 || n > 256 {
		return 0, errors.New("invalid charset")
	}
	// 可接受的字节上界（含）；n 整除 256 时全部字节都可用
	hi := 255
	if rem := 256 % n; rem != 0 {
		hi = 256 - rem - 1
	}
	var b [1]byte
	for {
		if _, err := rand.Read(b[:]); err != nil {
			return 0, err
		}
		if int(b[0]) <= hi {
			return charset[int(b[0])%n], nil
		}
	}
}

// randomPublicID 生成 chat_ 加 14 位随机小写字母数字。
//
// 用 crypto/rand 而不是 math/rand：聊天号可以被搜索，不能让人顺着随机种子猜出一批有效号。
func randomPublicID() (string, error) {
	out := make([]byte, publicIDSuffixLen)
	for i := 0; i < publicIDSuffixLen; i++ {
		c, err := randomChar(publicIDAlphanums)
		if err != nil {
			return "", err
		}
		out[i] = c
	}
	return publicIDPrefix + string(out), nil
}

// NextPublicID 分配一个未被占用的随机聊天号。
//
// 老部署用的是 chat10001 这种「COUNT(*)+10000」递增号：能枚举、还能从号码推出注册顺序。
// 已在库里的老号不动（换号走用户在资料页的「改一次」）。
//
// 唯一性最终由 users.public_id 的 UNIQUE 约束兜底；这里先查一次，
// 重试 8 次仍冲突就直接报错（正常永远走不到）。
func (r *UserRepo) NextPublicID(ctx context.Context) (string, error) {
	for attempt := 0; attempt < 8; attempt++ {
		id, err := randomPublicID()
		if err != nil {
			return "", err
		}
		var taken bool
		if err := r.DB.QueryRow(ctx,
			`SELECT EXISTS(SELECT 1 FROM users WHERE public_id=$1)`, id).Scan(&taken); err != nil {
			return "", err
		}
		if !taken {
			return id, nil
		}
	}
	return "", errors.New("failed to allocate a unique public id")
}

// PublicIDTaken 判断某个聊天号是否已被占用；excludeUID 用于把用户自己排掉
// （允许把号设成自己当前用的那个）。
func (r *UserRepo) PublicIDTaken(ctx context.Context, publicID, excludeUID string) (bool, error) {
	var taken bool
	err := r.DB.QueryRow(ctx, `
		SELECT EXISTS(
			SELECT 1 FROM users WHERE public_id=$1 AND ($2='' OR id<>$2::uuid)
		)`, publicID, excludeUID).Scan(&taken)
	return taken, err
}

// PublicIDChangeUsed 报告该用户是否已经用掉「改一次」的机会。
func (r *UserRepo) PublicIDChangeUsed(ctx context.Context, uid string) (bool, error) {
	var used bool
	err := r.DB.QueryRow(ctx,
		`SELECT COALESCE(public_id_changed_at IS NOT NULL, false) FROM users WHERE id=$1::uuid`,
		uid).Scan(&used)
	return used, err
}

// UpdatePublicID 改聊天号并标记「改过一次」。
//
// WHERE 里带着 public_id_changed_at IS NULL：并发发两次只有一次能生效，
// 另一次 RowsAffected=0 → ErrPublicIDChangeUsed，不用另外加锁。
func (r *UserRepo) UpdatePublicID(ctx context.Context, uid, publicID string) error {
	tag, err := r.DB.Exec(ctx, `
		UPDATE users SET public_id=$2, public_id_changed_at=NOW()
		WHERE id=$1::uuid AND public_id_changed_at IS NULL`, uid, publicID)
	if err != nil {
		// 唯一约束冲突：查过之后仍被别人抢先占用
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return ErrPublicIDTaken
		}
		return err
	}
	if tag.RowsAffected() == 0 {
		return ErrPublicIDChangeUsed
	}
	return nil
}

func (r *UserRepo) Create(ctx context.Context, phone, countryCode, passwordHash, nickname, publicID string) (models.User, error) {
	var u models.User
	err := r.DB.QueryRow(ctx, `
		INSERT INTO users(phone, country_code, password_hash, nickname, avatar, public_id, password_set)
		VALUES($1,$2,$3,$4,'',$5,$6)
		RETURNING id::text, phone, country_code, COALESCE(public_id,''), password_hash,
			nickname, avatar, bio, COALESCE(status,'active'), created_at, COALESCE(password_set, false)`,
		phone, countryCode, passwordHash, nickname, publicID, passwordHash != "",
	).Scan(&u.ID, &u.Phone, &u.CountryCode, &u.PublicID, &u.PasswordHash,
		&u.Nickname, &u.Avatar, &u.Bio, &u.Status, &u.CreatedAt, &u.PasswordSet)
	return u, err
}

func PublicUser(u models.User) models.User {
	u.PasswordHash = ""
	u.Phone = ""
	return u
}

func ToPublicProfile(u models.User) models.PublicProfile {
	return models.PublicProfile{
		ID:        u.ID,
		PublicID:  u.PublicID,
		Nickname:  u.Nickname,
		Avatar:    u.Avatar,
		Bio:       u.Bio,
		Status:    u.Status,
		CreatedAt: u.CreatedAt.UTC().Format(time.RFC3339),
	}
}

func (r *UserRepo) QrcodePayload(u models.User) models.QrcodePayload {
	payload, _ := json.Marshal(map[string]string{
		"type":     "user",
		"publicId": u.PublicID,
	})
	return models.QrcodePayload{
		PublicID: u.PublicID,
		Nickname: u.Nickname,
		Avatar:   u.Avatar,
		Payload:  string(payload),
	}
}

// ResolveUserQRCode 按 token 解析用户二维码
func (r *UserRepo) ResolveUserQRCode(ctx context.Context, token string) (models.User, error) {
	var u models.User
	err := r.DB.QueryRow(ctx, `
		SELECT u.id::text, u.phone, u.country_code, COALESCE(u.public_id,''), '',
			u.nickname, u.avatar, u.bio, COALESCE(u.status,'active'), u.created_at
		FROM user_qrcodes q
		JOIN users u ON u.id = q.user_id
		WHERE q.token=$1 AND q.revoked_at IS NULL
		  AND (q.expires_at IS NULL OR q.expires_at > NOW())`, token,
	).Scan(&u.ID, &u.Phone, &u.CountryCode, &u.PublicID, &u.PasswordHash,
		&u.Nickname, &u.Avatar, &u.Bio, &u.Status, &u.CreatedAt)
	return u, err
}

// UpdatePassword 更新登录密码
func (r *UserRepo) UpdatePassword(ctx context.Context, userID, passwordHash string) error {
	tag, err := r.DB.Exec(ctx, `
		UPDATE users SET password_hash=$1, password_set=true, updated_at=NOW() WHERE id=$2::uuid`, passwordHash, userID)
	if err != nil {
		return err
	}
	if tag.RowsAffected() == 0 {
		return pgx.ErrNoRows
	}
	return nil
}
func (r *UserRepo) EnsureQRCode(ctx context.Context, userID string) (models.UserQR, error) {
	var token string
	var expiresAt *time.Time
	err := r.DB.QueryRow(ctx, `
		SELECT token, expires_at FROM user_qrcodes
		WHERE user_id=$1::uuid AND revoked_at IS NULL
		  AND (expires_at IS NULL OR expires_at > NOW())
		ORDER BY created_at DESC LIMIT 1`, userID,
	).Scan(&token, &expiresAt)
	if err == nil {
		exp := time.Time{}
		if expiresAt != nil {
			exp = *expiresAt
		}
		return models.UserQR{Token: token, ExpiresAt: exp}, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return models.UserQR{}, err
	}
	token = uuid.NewString()
	exp := time.Now().Add(365 * 24 * time.Hour)
	if _, err := r.DB.Exec(ctx, `
		INSERT INTO user_qrcodes(user_id, token, expires_at) VALUES($1::uuid,$2,$3)
		ON CONFLICT (token) DO NOTHING`, userID, token, exp); err != nil {
		return models.UserQR{}, err
	}
	return models.UserQR{Token: token, ExpiresAt: exp}, nil
}
