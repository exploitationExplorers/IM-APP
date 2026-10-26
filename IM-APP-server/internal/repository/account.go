package repository

import (
	"context"
	"errors"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
	"im-app-server/internal/models"
)

var (
	ErrAccountOwnsGroups = errors.New("请先转让或解散您创建的群，再注销账号")
	ErrAccountChanged    = errors.New("账号状态或密码已改变，请重新验证")
)

type AccountRepo struct{ DB *pgxpool.Pool }

func (r *AccountRepo) Active(ctx context.Context, userID string) (bool, error) {
	var active bool
	err := r.DB.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM users WHERE id=$1::uuid AND status='active' AND canceled_at IS NULL)`, userID).Scan(&active)
	return active, err
}

func (r *AccountRepo) OwnedGroupCount(ctx context.Context, userID string) (int, error) {
	var count int
	err := r.DB.QueryRow(ctx, `SELECT COUNT(*) FROM groups WHERE owner_id=$1::uuid AND status='active'`, userID).Scan(&count)
	return count, err
}

// Cancel 不可逆清除身份与私人数据；只保留匿名 UUID 供已送达消息及治理记录引用。
func (r *AccountRepo) Cancel(ctx context.Context, userID, expectedHash string) error {
	tx, err := r.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	var hash, phone, status string
	err = tx.QueryRow(ctx, `SELECT password_hash, COALESCE(phone_e164,''), status FROM users WHERE id=$1::uuid FOR UPDATE`, userID).Scan(&hash, &phone, &status)
	if err != nil {
		return err
	}
	if status == "canceled" {
		return nil
	}
	if status != "active" || hash != expectedHash {
		return ErrAccountChanged
	}
	var owns bool
	if err = tx.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM groups WHERE owner_id=$1::uuid AND status='active')`, userID).Scan(&owns); err != nil {
		return err
	}
	if owns {
		return ErrAccountOwnsGroups
	}

	// 在删除关系前写入同一事务的同步任务；失败回滚，重试不丢清理意图。
	rows, err := tx.Query(ctx, `SELECT group_id::text FROM group_members WHERE user_id=$1::uuid`, userID)
	if err != nil {
		return err
	}
	var groups []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		groups = append(groups, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, groupID := range groups {
		if err = EnqueueIMSyncAggregateTx(ctx, tx, "group", groupID, IMEventGroupMemberLeft, map[string]string{"userId": userID, "reason": "quit"}); err != nil {
			return err
		}
	}
	rows, err = tx.Query(ctx, `SELECT friend_id::text FROM friendships WHERE user_id=$1::uuid UNION SELECT user_id::text FROM friendships WHERE friend_id=$1::uuid`, userID)
	if err != nil {
		return err
	}
	var friends []string
	for rows.Next() {
		var id string
		if err = rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		friends = append(friends, id)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return err
	}
	for _, id := range friends {
		if err = EnqueueIMSyncTx(ctx, tx, IMEventFriendDeleted, userID, map[string]string{"friendUserId": id}); err != nil {
			return err
		}
	}
	statements := []string{
		`DELETE FROM auth_sessions WHERE user_id=$1::uuid`,
		`DELETE FROM group_members WHERE user_id=$1::uuid`,
		`DELETE FROM conversation_members WHERE user_id=$1::uuid`,
		`DELETE FROM messages WHERE sender_id=$1::uuid`,
		`DELETE FROM friendships WHERE user_id=$1::uuid OR friend_id=$1::uuid`,
		`DELETE FROM friend_requests WHERE from_user=$1::uuid OR to_user=$1::uuid`,
		`DELETE FROM user_blocks WHERE user_id=$1::uuid OR blocked_id=$1::uuid`,
		`DELETE FROM contact_tag_members WHERE friend_id=$1::uuid`,
		`DELETE FROM contact_tags WHERE user_id=$1::uuid`,
		`DELETE FROM favorites WHERE user_id=$1::uuid`,
		`DELETE FROM forward_tasks WHERE user_id=$1::uuid`,
		`DELETE FROM forward_media_snapshots WHERE user_id=$1::uuid`,
		`DELETE FROM user_stickers WHERE user_id=$1::uuid`,
		`DELETE FROM user_qrcodes WHERE user_id=$1::uuid`,
		`DELETE FROM privacy_settings WHERE user_id=$1::uuid`,
		`DELETE FROM im_group_read_cursors WHERE user_id=$1::uuid`,
		`DELETE FROM group_join_requests WHERE user_id=$1::uuid`,
		`DELETE FROM group_invitations WHERE inviter_id=$1::uuid OR invitee_id=$1::uuid`,
		`DELETE FROM group_remarks WHERE user_id=$1::uuid`,
		`DELETE FROM group_member_remarks WHERE user_id=$1::uuid OR member_user_id=$1::uuid`,
		`DELETE FROM feedbacks WHERE user_id=$1::uuid`,
		// 文件已发送给他人时保留内容，取消所有权；不调用任何全群/全桶清空接口。
		`UPDATE files SET owner_id=NULL WHERE owner_id=$1::uuid`,
		`UPDATE reports SET reporter_id=NULL WHERE reporter_id=$1::uuid`,
		`UPDATE im_sync_outbox SET payload='{}'::jsonb WHERE aggregate_id=$1::uuid AND event_type IN ('user.registered','user.profile_updated')`,
	}
	for _, sql := range statements {
		if _, err = tx.Exec(ctx, sql, userID); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(ctx, `DELETE FROM sms_codes WHERE phone=$1`, phone); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx, `DELETE FROM sms_send_logs WHERE phone_e164=$1`, phone); err != nil {
		return err
	}
	anonymous := "del_" + uuid.NewString()[:16]
	_, err = tx.Exec(ctx, `UPDATE users SET phone=$2,phone_e164=$2,country_code='',password_hash='',password_set=false,
        nickname='已注销用户',avatar=$3,bio='',public_id=$2,status='canceled',canceled_at=NOW(),last_seen_at=NULL,updated_at=NOW()
        WHERE id=$1::uuid`, userID, anonymous, models.DefaultAvatar)
	if err != nil {
		return err
	}
	if err = EnqueueIMSyncTx(ctx, tx, IMEventUserCanceled, userID, map[string]string{}); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
