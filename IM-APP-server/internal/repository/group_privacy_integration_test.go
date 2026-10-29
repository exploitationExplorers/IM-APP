package repository_test

import (
	"context"
	"encoding/json"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"im-app-server/internal/repository"
	"im-app-server/internal/service"
)

const (
	groupPrivacyOwner  = "11111111-1111-4111-8111-111111111111"
	groupPrivacyFirst  = "22222222-2222-4222-8222-222222222222"
	groupPrivacySecond = "33333333-3333-4333-8333-333333333333"
)

func groupPrivacyPool(t *testing.T) *pgxpool.Pool {
	t.Helper()
	pool := mediaTestPool(t)
	_, err := pool.Exec(context.Background(), `
		ALTER TABLE users ADD COLUMN nickname text NOT NULL DEFAULT '',
		  ADD COLUMN avatar text NOT NULL DEFAULT '', ADD COLUMN status text NOT NULL DEFAULT 'active';
		INSERT INTO users(id) VALUES('33333333-3333-4333-8333-333333333333');
		CREATE TABLE friendships(user_id uuid NOT NULL, friend_id uuid NOT NULL, PRIMARY KEY(user_id,friend_id));
		INSERT INTO friendships VALUES
		  ('11111111-1111-4111-8111-111111111111','22222222-2222-4222-8222-222222222222'),
		  ('11111111-1111-4111-8111-111111111111','33333333-3333-4333-8333-333333333333');
		CREATE TABLE app_config_versions(id bigserial PRIMARY KEY, version int NOT NULL, data_json text NOT NULL, status text NOT NULL);
		CREATE TABLE privacy_settings(user_id uuid PRIMARY KEY, require_friend_approval boolean NOT NULL DEFAULT true,
		  require_group_approval boolean NOT NULL DEFAULT true);
		CREATE TABLE groups(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), public_id text UNIQUE, name text NOT NULL,
		  avatar text, owner_id uuid NOT NULL, conversation_id uuid, allow_member_add_friend boolean,
		  max_members int, announcement text, announcement_images text[], join_mode text NOT NULL DEFAULT 'open',
		  all_muted boolean NOT NULL DEFAULT false, public_id_changed_at timestamptz, status text NOT NULL DEFAULT 'active');
		CREATE TABLE group_members(group_id uuid NOT NULL REFERENCES groups(id), user_id uuid NOT NULL,
		  role text NOT NULL, nickname text, muted_until timestamptz, status text NOT NULL DEFAULT 'active',
		  PRIMARY KEY(group_id,user_id));
		CREATE TABLE group_remarks(group_id uuid NOT NULL, user_id uuid NOT NULL, remark text);
		CREATE TABLE group_invitations(id bigserial PRIMARY KEY, group_id uuid NOT NULL REFERENCES groups(id),
		  inviter_id uuid NOT NULL, invitee_id uuid NOT NULL, token text UNIQUE NOT NULL,
		  status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(),
		  handled_at timestamptz);
		CREATE TABLE im_sync_outbox(id bigserial PRIMARY KEY, aggregate_type text, aggregate_id uuid,
		  event_type text NOT NULL, payload jsonb NOT NULL);`)
	if err != nil {
		t.Fatal(err)
	}
	return pool
}

func TestGroupPrivacyPostgresIntegration(t *testing.T) {
	t.Run("create_default_requires_confirmation_and_excludes_pending_from_openim", func(t *testing.T) {
		pool := groupPrivacyPool(t)
		repo := &repository.GroupRepo{DB: pool}
		ctx := context.Background()
		svc := &service.GroupService{Groups: repo}
		group, err := svc.Create(ctx, groupPrivacyOwner, "privacy", []string{groupPrivacyFirst, groupPrivacySecond})
		if err != nil {
			t.Fatal(err)
		}
		if group.MemberCount != 1 {
			t.Fatalf("pending users joined group: memberCount=%d", group.MemberCount)
		}
		id, err := repo.InternalIDByPublicID(ctx, group.ID)
		if err != nil {
			t.Fatal(err)
		}
		state, err := repo.GetSyncState(ctx, id)
		if err != nil || len(state.Members) != 1 || state.Members[0].ID != groupPrivacyOwner {
			t.Fatalf("OpenIM state contains pending invitees: %#v, %v", state, err)
		}
		var count int
		if err := pool.QueryRow(ctx, `SELECT count(*) FROM im_sync_outbox WHERE event_type=$1`, repository.IMEventGroupInvitePending).Scan(&count); err != nil || count != 2 {
			t.Fatalf("durable invitation count=%d, err=%v", count, err)
		}
		var raw []byte
		if err := pool.QueryRow(ctx, `SELECT payload FROM im_sync_outbox WHERE event_type=$1`, repository.IMEventGroupCreated).Scan(&raw); err != nil {
			t.Fatal(err)
		}
		var payload struct {
			MemberIDs []string `json:"memberIds"`
		}
		if err := json.Unmarshal(raw, &payload); err != nil || len(payload.MemberIDs) != 1 || payload.MemberIDs[0] != groupPrivacyOwner {
			t.Fatalf("creation event exposes pending members: %s, %v", raw, err)
		}
		var token string
		if err := pool.QueryRow(ctx, `SELECT token FROM group_invitations WHERE invitee_id=$1`, groupPrivacyFirst).Scan(&token); err != nil {
			t.Fatal(err)
		}
		inviter, card, err := repo.PendingInvitationCard(ctx, id, token)
		if err != nil || inviter != groupPrivacyOwner || card.InviteeID != groupPrivacyFirst || card.MemberCount != 1 {
			t.Fatalf("pending card missing: %s %#v %v", inviter, card, err)
		}
		if _, err := pool.Exec(ctx, `UPDATE group_invitations SET status='accepted' WHERE token=$1`, token); err != nil {
			t.Fatal(err)
		}
		if _, _, err := repo.PendingInvitationCard(ctx, id, token); !errors.Is(err, pgx.ErrNoRows) {
			t.Fatalf("accepted invite still deliverable: %v", err)
		}
	})

	for _, method := range []string{"create", "invite"} {
		t.Run(method+"_personal_setting_overrides_published_default", func(t *testing.T) {
			pool := groupPrivacyPool(t)
			repo := &repository.GroupRepo{DB: pool}
			ctx := context.Background()
			_, err := pool.Exec(ctx, `INSERT INTO app_config_versions(version,data_json,status) VALUES
			  (1,'{"defaultRequireGroupApproval":false}','published'),
			  (2,'{"defaultRequireGroupApproval":true}','draft');
			  INSERT INTO privacy_settings(user_id,require_group_approval) VALUES('22222222-2222-4222-8222-222222222222',true);`)
			if err != nil {
				t.Fatal(err)
			}
			members := []string{groupPrivacyFirst, groupPrivacySecond}
			if method == "invite" {
				members = nil
			}
			group, err := repo.Create(ctx, groupPrivacyOwner, "mixed", members)
			if err != nil {
				t.Fatal(err)
			}
			id, err := repo.InternalIDByPublicID(ctx, group.ID)
			if err != nil {
				t.Fatal(err)
			}
			if method == "invite" {
				result, _, err := repo.InviteMembers(ctx, id, groupPrivacyOwner, []string{groupPrivacyFirst, groupPrivacySecond})
				if err != nil || result.InvitedCount != 1 || result.PendingCount != 1 {
					t.Fatalf("mixed invite result=%#v, err=%v", result, err)
				}
			}
			var direct, pending bool
			if err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM group_members WHERE group_id=$1 AND user_id=$2),
			  EXISTS(SELECT 1 FROM group_invitations WHERE group_id=$1 AND invitee_id=$3 AND status='pending')`,
				id, groupPrivacySecond, groupPrivacyFirst).Scan(&direct, &pending); err != nil || !direct || !pending {
				t.Fatalf("wrong privacy partition: direct=%v pending=%v err=%v", direct, pending, err)
			}
			if _, _, err := repo.InviteMembers(ctx, id, groupPrivacyOwner, []string{groupPrivacyFirst}); err != nil {
				t.Fatal(err)
			}
			var count int
			if err := pool.QueryRow(ctx, `SELECT count(*) FROM im_sync_outbox WHERE event_type=$1`, repository.IMEventGroupInvitePending).Scan(&count); err != nil || count != 1 {
				t.Fatalf("repeated invitation enqueued duplicate card: %d %v", count, err)
			}
		})
	}

	t.Run("nonfriend_cannot_be_initial_member", func(t *testing.T) {
		pool := groupPrivacyPool(t)
		ctx := context.Background()
		if _, err := pool.Exec(ctx, `DELETE FROM friendships WHERE friend_id=$1`, groupPrivacySecond); err != nil {
			t.Fatal(err)
		}
		repo := &repository.GroupRepo{DB: pool}
		if _, err := repo.Create(ctx, groupPrivacyOwner, "invalid", []string{groupPrivacyFirst, groupPrivacySecond}); !errors.Is(err, repository.ErrInvalidGroupOperation) {
			t.Fatalf("created group with nonfriend: %v", err)
		}
	})

	t.Run("outbox_failure_rolls_back_entire_creation", func(t *testing.T) {
		pool := groupPrivacyPool(t)
		ctx := context.Background()
		if _, err := pool.Exec(ctx, `ALTER TABLE im_sync_outbox ADD CONSTRAINT reject_invitation CHECK(event_type <> 'group.invite.pending')`); err != nil {
			t.Fatal(err)
		}
		repo := &repository.GroupRepo{DB: pool}
		if _, err := repo.Create(ctx, groupPrivacyOwner, "rollback", []string{groupPrivacyFirst, groupPrivacySecond}); err == nil {
			t.Fatal("expected outbox failure")
		}
		for _, table := range []string{"groups", "group_members", "group_invitations", "im_sync_outbox"} {
			var count int
			if err := pool.QueryRow(ctx, "SELECT count(*) FROM "+table).Scan(&count); err != nil || count != 0 {
				t.Fatalf("creation left %s rows: %d %v", table, count, err)
			}
		}
	})

	t.Run("used_invitation_cannot_rejoin_after_kick", func(t *testing.T) {
		pool := groupPrivacyPool(t)
		repo := &repository.GroupRepo{DB: pool}
		ctx := context.Background()
		var groupID string
		if err := pool.QueryRow(ctx, `
			INSERT INTO groups(name, owner_id, public_id, join_mode)
			VALUES('once','11111111-1111-4111-8111-111111111111','qun_once','open')
			RETURNING id::text`).Scan(&groupID); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO group_members(group_id, user_id, role) VALUES($1::uuid,$2,'owner')`,
			groupID, groupPrivacyOwner); err != nil {
			t.Fatal(err)
		}
		if _, err := pool.Exec(ctx, `
			INSERT INTO group_invitations(group_id, inviter_id, invitee_id, token)
			VALUES($1::uuid,$2,$3,'once-token')`,
			groupID, groupPrivacyOwner, groupPrivacyFirst); err != nil {
			t.Fatal(err)
		}
		joined, err := repo.AcceptInvitation(ctx, groupPrivacyFirst, "once-token")
		if err != nil || joined.NextAction != "joined" {
			t.Fatalf("first accept = %#v, %v", joined, err)
		}
		if _, err := pool.Exec(ctx, `DELETE FROM group_members WHERE group_id=$1::uuid AND user_id=$2`, groupID, groupPrivacyFirst); err != nil {
			t.Fatal(err)
		}
		if _, err := repo.AcceptInvitation(ctx, groupPrivacyFirst, "once-token"); !errors.Is(err, repository.ErrInvitationUsed) {
			t.Fatalf("kicked member reused invitation: %v", err)
		}
	})
}
