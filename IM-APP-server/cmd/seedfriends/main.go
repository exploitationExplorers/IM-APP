// 把库里已有的压测用户挂到指定登录账号的好友关系上。
// 默认不新建用户，匹配 nickname LIKE '压测好友%'（号段 17600000001 起那批）。
//
// 先核对：
//
//	go run ./cmd/seedfriends -inspect
//
// 只写 PostgreSQL 双向好友（测选人/建任务）：
//
//	go run ./cmd/seedfriends -owner=13800138000
//
// 还要测消息真发出去：
//
//	go run ./cmd/seedfriends -owner=13800138000 -sync-openim
//
// 只拆掉该账号与压测好友的关系，不删除用户：
//
//	go run ./cmd/seedfriends -owner=13800138000 -unlink
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"im-app-server/internal/config"
	"im-app-server/internal/db"
	"im-app-server/internal/im"
	"im-app-server/internal/models"
)

const (
	defaultOwnerPhone = "13800138000"
	loadNicknameLike  = "压测好友%"
	registerBatch     = 50
	importBatch       = 1000
)

func main() {
	ownerPhone := flag.String("owner", defaultOwnerPhone, "要挂好友的登录账号本地手机号")
	inspect := flag.Bool("inspect", false, "只统计压测用户和现有好友数，不写库")
	unlink := flag.Bool("unlink", false, "删除该账号与压测好友的双向关系，不删用户")
	syncOpenIM := flag.Bool("sync-openim", false, "同时向 OpenIM 注册这批用户并导入好友")
	flag.Parse()

	cfg := config.Load()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Minute)
	defer cancel()

	pool, err := db.Connect(cfg.DatabaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer pool.Close()

	stats, err := inspectLoadUsers(ctx, pool, *ownerPhone)
	if err != nil {
		log.Fatalf("inspect: %v", err)
	}
	log.Printf("load users=%d  phone=%s..%s  nick=%s..%s",
		stats.LoadUsers, stats.MinPhone, stats.MaxPhone, stats.MinNick, stats.MaxNick)
	if stats.OwnerID == "" {
		log.Printf("owner %s not found", *ownerPhone)
	} else {
		log.Printf("owner %s  nickname=%s  publicId=%s  id=%s  current friends=%d  already linked load friends=%d",
			*ownerPhone, stats.OwnerNick, stats.OwnerPublicID, stats.OwnerID, stats.OwnerFriends, stats.LinkedLoad)
	}

	if *inspect {
		return
	}
	if stats.LoadUsers == 0 {
		log.Fatal("没有找到压测用户（nickname LIKE '压测好友%'），拒绝新建，避免再灌一套号")
	}
	if stats.OwnerID == "" {
		log.Fatalf("登录账号 %s 不存在，请改 -owner", *ownerPhone)
	}

	if *unlink {
		removed, err := unlinkLoadFriends(ctx, pool, stats.OwnerID)
		if err != nil {
			log.Fatalf("unlink: %v", err)
		}
		log.Printf("removed friendship rows=%d", removed)
		return
	}

	linked, err := linkLoadFriends(ctx, pool, stats.OwnerID)
	if err != nil {
		log.Fatalf("link: %v", err)
	}
	var totalFriends int
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM friendships WHERE user_id=$1::uuid`, stats.OwnerID).Scan(&totalFriends); err != nil {
		log.Fatalf("count friends: %v", err)
	}
	log.Printf("new friendship rows=%d  owner friend count=%d", linked, totalFriends)

	if !*syncOpenIM {
		log.Printf("PostgreSQL 好友已挂上。只测选人/建任务可直接用 %s 登录；真发出去请加 -sync-openim", *ownerPhone)
		return
	}

	client := im.NewClient(cfg.OpenIM)
	if !client.Available() {
		log.Fatal("OpenIM 未配置，无法 -sync-openim")
	}
	if err := syncOpenIMUsers(ctx, pool, client, stats.OwnerID); err != nil {
		log.Fatalf("openim: %v", err)
	}
	log.Printf("OpenIM 注册与好友导入完成")
}

type loadStats struct {
	LoadUsers     int
	MinPhone      string
	MaxPhone      string
	MinNick       string
	MaxNick       string
	OwnerID       string
	OwnerNick     string
	OwnerPublicID string
	OwnerFriends  int
	LinkedLoad    int
}

func inspectLoadUsers(ctx context.Context, pool *pgxpool.Pool, ownerPhone string) (loadStats, error) {
	var s loadStats
	err := pool.QueryRow(ctx, `
		SELECT COUNT(*),
			COALESCE(MIN(phone),''), COALESCE(MAX(phone),''),
			COALESCE(MIN(nickname),''), COALESCE(MAX(nickname),'')
		FROM users WHERE nickname LIKE $1`, loadNicknameLike).Scan(
		&s.LoadUsers, &s.MinPhone, &s.MaxPhone, &s.MinNick, &s.MaxNick)
	if err != nil {
		return s, err
	}

	err = pool.QueryRow(ctx, `
		SELECT id::text, nickname, COALESCE(public_id,'')
		FROM users WHERE phone=$1`, ownerPhone).Scan(&s.OwnerID, &s.OwnerNick, &s.OwnerPublicID)
	if errors.Is(err, pgx.ErrNoRows) {
		return s, nil
	}
	if err != nil {
		return s, err
	}

	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*) FROM friendships WHERE user_id=$1::uuid`, s.OwnerID).Scan(&s.OwnerFriends); err != nil {
		return s, err
	}
	if err := pool.QueryRow(ctx, `
		SELECT COUNT(*)
		FROM friendships f
		JOIN users u ON u.id=f.friend_id
		WHERE f.user_id=$1::uuid AND u.nickname LIKE $2`, s.OwnerID, loadNicknameLike).Scan(&s.LinkedLoad); err != nil {
		return s, err
	}
	return s, nil
}

func linkLoadFriends(ctx context.Context, pool *pgxpool.Pool, ownerID string) (int64, error) {
	tag, err := pool.Exec(ctx, `
		INSERT INTO friendships(user_id, friend_id)
		SELECT $1::uuid, u.id FROM users u
		WHERE u.nickname LIKE $2 AND u.id <> $1::uuid
		ON CONFLICT DO NOTHING`, ownerID, loadNicknameLike)
	if err != nil {
		return 0, err
	}
	n := tag.RowsAffected()
	tag, err = pool.Exec(ctx, `
		INSERT INTO friendships(user_id, friend_id)
		SELECT u.id, $1::uuid FROM users u
		WHERE u.nickname LIKE $2 AND u.id <> $1::uuid
		ON CONFLICT DO NOTHING`, ownerID, loadNicknameLike)
	if err != nil {
		return 0, err
	}
	return n + tag.RowsAffected(), nil
}

func unlinkLoadFriends(ctx context.Context, pool *pgxpool.Pool, ownerID string) (int64, error) {
	tag, err := pool.Exec(ctx, `
		DELETE FROM friendships f
		USING users u
		WHERE ((f.user_id=$1::uuid AND f.friend_id=u.id)
		    OR (f.friend_id=$1::uuid AND f.user_id=u.id))
		  AND u.nickname LIKE $2`, ownerID, loadNicknameLike)
	if err != nil {
		return 0, err
	}
	return tag.RowsAffected(), nil
}

func syncOpenIMUsers(ctx context.Context, pool *pgxpool.Pool, client *im.Client, ownerID string) error {
	var ownerNick, ownerAvatar string
	if err := pool.QueryRow(ctx, `
		SELECT nickname, COALESCE(NULLIF(avatar,''), $2) FROM users WHERE id=$1::uuid`,
		ownerID, models.DefaultAvatar).Scan(&ownerNick, &ownerAvatar); err != nil {
		return err
	}
	ownerIM, err := im.UserIDFromBusinessID(ownerID)
	if err != nil {
		return err
	}
	if err := client.EnsureUser(ctx, im.User{UserID: ownerIM, Nickname: ownerNick, FaceURL: ownerAvatar}); err != nil {
		return fmt.Errorf("register owner: %w", err)
	}

	rows, err := pool.Query(ctx, `
		SELECT id::text, nickname, COALESCE(NULLIF(avatar,''), $2)
		FROM users WHERE nickname LIKE $1
		ORDER BY phone`, loadNicknameLike, models.DefaultAvatar)
	if err != nil {
		return err
	}
	defer rows.Close()

	type row struct {
		id, nick, avatar string
	}
	users := make([]row, 0, 10000)
	for rows.Next() {
		var item row
		if err := rows.Scan(&item.id, &item.nick, &item.avatar); err != nil {
			return err
		}
		users = append(users, item)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	friendIMIDs := make([]string, 0, len(users))
	batch := make([]im.User, 0, registerBatch)
	flush := func() error {
		if len(batch) == 0 {
			return nil
		}
		if err := client.RegisterUsers(ctx, batch); err != nil {
			for _, u := range batch {
				if err := client.EnsureUser(ctx, u); err != nil {
					return err
				}
			}
		}
		batch = batch[:0]
		return nil
	}
	for i, item := range users {
		openID, err := im.UserIDFromBusinessID(item.id)
		if err != nil {
			return err
		}
		friendIMIDs = append(friendIMIDs, openID)
		batch = append(batch, im.User{UserID: openID, Nickname: item.nick, FaceURL: item.avatar})
		if len(batch) >= registerBatch {
			if err := flush(); err != nil {
				return fmt.Errorf("register batch at %d: %w", i, err)
			}
			if (i+1)%500 == 0 {
				log.Printf("openim registered %d/%d", i+1, len(users))
			}
		}
	}
	if err := flush(); err != nil {
		return err
	}

	for i := 0; i < len(friendIMIDs); i += importBatch {
		end := i + importBatch
		if end > len(friendIMIDs) {
			end = len(friendIMIDs)
		}
		if err := client.ImportFriends(ctx, ownerIM, friendIMIDs[i:end]); err != nil {
			return fmt.Errorf("import friends %d-%d: %w", i, end, err)
		}
		log.Printf("openim imported friends %d/%d", end, len(friendIMIDs))
	}
	return nil
}
