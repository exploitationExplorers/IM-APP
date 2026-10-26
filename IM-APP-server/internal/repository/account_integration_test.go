package repository_test

import (
	"context"
	"errors"
	"im-app-server/internal/db"
	"im-app-server/internal/repository"
	"path/filepath"
	"strings"
	"testing"
)

func TestAccountDeletionPostgresIntegration(t *testing.T) {
	pool := mediaTestPool(t)
	ctx := context.Background()
	// helper 已创建专用随机 schema；此处替换它的精简 fixture，使用真实迁移。
	if _, err := pool.Exec(ctx, `DROP TABLE favorites CASCADE; DROP TABLE users CASCADE`); err != nil {
		t.Fatal(err)
	}
	if err := db.RunMigrationsDir(ctx, pool, filepath.Join("..", "..", "migrations")); err != nil {
		t.Fatal(err)
	}
	const uid = "11111111-1111-4111-8111-111111111111"
	const peer = "22222222-2222-4222-8222-222222222222"
	const gid = "33333333-3333-4333-8333-333333333333"
	const cid = "44444444-4444-4444-8444-444444444444"
	_, err := pool.Exec(ctx, `
  INSERT INTO users(id,phone,phone_e164,password_hash,nickname,public_id) VALUES
   ('11111111-1111-4111-8111-111111111111','13800138001','+8613800138001','verified-hash','Original','original1'),
   ('22222222-2222-4222-8222-222222222222','13800138002','+8613800138002','peer-hash','Peer','original2');
  INSERT INTO groups(id,name,owner_id) VALUES('33333333-3333-4333-8333-333333333333','Test','11111111-1111-4111-8111-111111111111');
  INSERT INTO group_members(group_id,user_id,role) VALUES
   ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','member'),
   ('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','owner');
  INSERT INTO conversations(id,type) VALUES('44444444-4444-4444-8444-444444444444','private');
  INSERT INTO messages(conversation_id,sender_id,content) VALUES
   ('44444444-4444-4444-8444-444444444444','11111111-1111-4111-8111-111111111111','own'),
   ('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','peer');
  INSERT INTO friendships(user_id,friend_id) VALUES
   ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'),
   ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111');
  INSERT INTO auth_sessions(user_id,refresh_token_hash,expires_at) VALUES('11111111-1111-4111-8111-111111111111','refresh-hash',NOW()+INTERVAL '1 day');
  INSERT INTO files(owner_id,object_key) VALUES('11111111-1111-4111-8111-111111111111','test/own.png');
  INSERT INTO forward_media_snapshots(user_id,source_hash,snapshot) VALUES('11111111-1111-4111-8111-111111111111','source','{}');
 `)
	if err != nil {
		t.Fatal(err)
	}
	repo := &repository.AccountRepo{DB: pool}
	if err := repo.Cancel(ctx, uid, "old-hash"); !errors.Is(err, repository.ErrAccountChanged) {
		t.Fatal(err)
	}
	if err := repo.Cancel(ctx, uid, "verified-hash"); !errors.Is(err, repository.ErrAccountOwnsGroups) {
		t.Fatal(err)
	}
	if active, err := repo.Active(ctx, uid); err != nil || !active {
		t.Fatal("failed attempts changed state", active, err)
	}
	if _, err = pool.Exec(ctx, `UPDATE groups SET owner_id=$2::uuid WHERE id=$1::uuid`, gid, peer); err != nil {
		t.Fatal(err)
	}
	if err = repo.Cancel(ctx, uid, "verified-hash"); err != nil {
		t.Fatal(err)
	}
	if active, err := repo.Active(ctx, uid); err != nil || active {
		t.Fatal("canceled account still active", active, err)
	}
	for _, query := range []string{
		`SELECT COUNT(*) FROM auth_sessions WHERE user_id=$1::uuid`,
		`SELECT COUNT(*) FROM group_members WHERE user_id=$1::uuid`,
		`SELECT COUNT(*) FROM friendships WHERE user_id=$1::uuid OR friend_id=$1::uuid`,
		`SELECT COUNT(*) FROM forward_media_snapshots WHERE user_id=$1::uuid`,
	} {
		var count int
		if err = pool.QueryRow(ctx, query, uid).Scan(&count); err != nil || count != 0 {
			t.Fatal(query, count, err)
		}
	}
	var messages int
	if err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM messages WHERE conversation_id=$1::uuid AND sender_id=$2::uuid`, cid, peer).Scan(&messages); err != nil || messages != 1 {
		t.Fatal("peer history was removed", messages, err)
	}
	var phone, hash, nickname string
	if err = pool.QueryRow(ctx, `SELECT phone,password_hash,nickname FROM users WHERE id=$1::uuid`, uid).Scan(&phone, &hash, &nickname); err != nil || !strings.HasPrefix(phone, "del_") || hash != "" || nickname != "已注销用户" {
		t.Fatal("identity was not anonymized", err)
	}
	var jobs int
	if err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM im_sync_outbox WHERE event_type='user.canceled' AND aggregate_id=$1::uuid`, uid).Scan(&jobs); err != nil || jobs != 1 {
		t.Fatal("cleanup intent not durable", jobs, err)
	}
	if err = repo.Cancel(ctx, uid, "verified-hash"); err != nil {
		t.Fatal("repeat cleanup failed", err)
	}
	if err = pool.QueryRow(ctx, `SELECT COUNT(*) FROM im_sync_outbox WHERE event_type='user.canceled' AND aggregate_id=$1::uuid`, uid).Scan(&jobs); err != nil || jobs != 1 {
		t.Fatal("duplicate cleanup job", jobs, err)
	}
}
