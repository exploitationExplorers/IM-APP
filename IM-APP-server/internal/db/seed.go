package db

import (
	"context"
	"log"

	"github.com/jackc/pgx/v5/pgxpool"
	"golang.org/x/crypto/bcrypt"
)

// SeedDemo 在空库时写入联调账号、好友与会话，便于前端直连真实 API。
func SeedDemo(ctx context.Context, pool *pgxpool.Pool) error {
	var count int
	if err := pool.QueryRow(ctx, `SELECT COUNT(*) FROM users`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		_, _ = pool.Exec(ctx, `UPDATE users SET nickname=$1, public_id=COALESCE(NULLIF(public_id,''),'chat10001') WHERE phone='13800138000'`, "\u5f20\u4e09")
		_, _ = pool.Exec(ctx, `UPDATE users SET nickname=$1, public_id=COALESCE(NULLIF(public_id,''),'chat10002') WHERE phone='13800138001'`, "\u674e\u56db")
		_, _ = pool.Exec(ctx, `UPDATE users SET nickname=$1, public_id=COALESCE(NULLIF(public_id,''),'chat10003') WHERE phone='13800138002'`, "\u738b\u4e94")
		_, _ = pool.Exec(ctx, `UPDATE conversations SET title=$1 WHERE type='private'`, "\u674e\u56db")
		_, _ = pool.Exec(ctx, `UPDATE conversations SET title=$1 WHERE type='group'`, "\u4ea7\u54c1\u8ba8\u8bba\u7fa4")
		_, _ = pool.Exec(ctx, `UPDATE groups SET name=$1`, "\u4ea7\u54c1\u8ba8\u8bba\u7fa4")
		log.Printf("demo data refreshed")
		return nil
	}

	hash, err := bcrypt.GenerateFromPassword([]byte("123456"), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	pwd := string(hash)

	nickMe := "\u5f20\u4e09"
	nickPeer := "\u674e\u56db"
	nickPeer2 := "\u738b\u4e94"
	groupTitle := "\u4ea7\u54c1\u8ba8\u8bba\u7fa4"
	groupName := "\u4ea7\u54c1\u8ba8\u8bba\u7fa4"
	msg1 := "\u4f60\u597d\uff0c\u9879\u76ee\u8fdb\u5ea6\u600e\u4e48\u6837\u4e86\uff1f"
	msg2 := "\u660e\u5929\u4e0b\u5348\u4e09\u70b9\u5f00\u4f1a\uff0c\u8bb0\u5f97\u51c6\u65f6\u53c2\u52a0"
	msg3 := "\u65b0\u7248\u672c\u9700\u6c42\u6587\u6863\u5df2\u4e0a\u4f20"
	frMsg := "\u4f60\u597d\uff0c\u6211\u662f\u8d75\u516d\uff0c\u52a0\u4e2a\u597d\u53cb\u5427"

	var meID, peerID, peer2ID, peer3ID string
	err = pool.QueryRow(ctx, `
		INSERT INTO users(phone, country_code, password_hash, nickname, avatar, public_id)
		VALUES('13800138000', '+86', $1, $2, '', 'chat10001')
		RETURNING id::text`, pwd, nickMe).Scan(&meID)
	if err != nil {
		return err
	}
	err = pool.QueryRow(ctx, `
		INSERT INTO users(phone, country_code, password_hash, nickname, avatar, public_id)
		VALUES('13800138001', '+86', $1, $2, '', 'chat10002')
		RETURNING id::text`, pwd, nickPeer).Scan(&peerID)
	if err != nil {
		return err
	}
	err = pool.QueryRow(ctx, `
		INSERT INTO users(phone, country_code, password_hash, nickname, avatar, public_id)
		VALUES('13800138002', '+86', $1, $2, '', 'chat10003')
		RETURNING id::text`, pwd, nickPeer2).Scan(&peer2ID)
	if err != nil {
		return err
	}
	err = pool.QueryRow(ctx, `
		INSERT INTO users(phone, country_code, password_hash, nickname, avatar, public_id)
		VALUES('13800138003', '+86', $1, $2, '', 'chat10004')
		RETURNING id::text`, pwd, "\u8d75\u516d").Scan(&peer3ID)
	if err != nil {
		return err
	}

	_, _ = pool.Exec(ctx, `
		INSERT INTO friendships(user_id, friend_id, remark) VALUES
		($1::uuid, $2::uuid, ''),
		($2::uuid, $1::uuid, ''),
		($1::uuid, $3::uuid, ''),
		($3::uuid, $1::uuid, '')`, meID, peerID, peer2ID)

	var convID string
	err = pool.QueryRow(ctx, `
		INSERT INTO conversations(type, title, avatar)
		VALUES('private', $1, '')
		RETURNING id::text`, nickPeer).Scan(&convID)
	if err != nil {
		return err
	}
	_, _ = pool.Exec(ctx, `
		INSERT INTO conversation_members(conversation_id, user_id, unread_count) VALUES
		($1::uuid, $2::uuid, 0),
		($1::uuid, $3::uuid, 0)`, convID, meID, peerID)

	_, _ = pool.Exec(ctx, `
		INSERT INTO messages(conversation_id, sender_id, type, content) VALUES
		($1::uuid, $2::uuid, 'text', $3),
		($1::uuid, $2::uuid, 'text', $4)`, convID, peerID, msg1, msg2)

	var groupConv string
	err = pool.QueryRow(ctx, `
		INSERT INTO conversations(type, title, avatar)
		VALUES('group', $1, '')
		RETURNING id::text`, groupTitle).Scan(&groupConv)
	if err != nil {
		return err
	}
	_, _ = pool.Exec(ctx, `
		INSERT INTO conversation_members(conversation_id, user_id, unread_count) VALUES
		($1::uuid, $2::uuid, 3),
		($1::uuid, $3::uuid, 0),
		($1::uuid, $4::uuid, 0)`, groupConv, meID, peerID, peer2ID)
	_, _ = pool.Exec(ctx, `
		INSERT INTO messages(conversation_id, sender_id, type, content)
		VALUES($1::uuid, $2::uuid, 'text', $3)`, groupConv, peer2ID, msg3)

	_, _ = pool.Exec(ctx, `
		INSERT INTO groups(id, name, avatar, owner_id)
		VALUES($1::uuid, $2, '', $3::uuid)`, groupConv, groupName, meID)

	_, _ = pool.Exec(ctx, `
		INSERT INTO group_members(group_id, user_id, role) VALUES
		($1::uuid, $2::uuid, 'owner'),
		($1::uuid, $3::uuid, 'member'),
		($1::uuid, $4::uuid, 'member')`, groupConv, meID, peerID, peer2ID)

	_, _ = pool.Exec(ctx, `
		INSERT INTO friend_requests(from_user, to_user, message, status)
		VALUES($1::uuid, $2::uuid, $3, 'pending')`, peer3ID, meID, frMsg)

	log.Printf("demo seed ready: login 13800138000 / 123456, publicId chat10001")
	return nil
}
