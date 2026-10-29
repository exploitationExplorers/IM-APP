package repository

import (
	"context"
	"errors"
	"testing"

	"github.com/jackc/pgx/v5"
)

func TestLoadPrivacyDefaults(t *testing.T) {
	for _, tc := range []struct {
		name          string
		row           fakeRow
		friend, group bool
		wantErr       bool
	}{
		{name: "无已发布配置", row: fakeRow{err: pgx.ErrNoRows}, friend: true, group: true},
		{name: "旧配置缺字段", row: fakeRow{raw: `{"maxGroupMembers":2000}`}, friend: true, group: true},
		{name: "空配置", row: fakeRow{raw: ""}, friend: true, group: true},
		{name: "显式关闭好友验证", row: fakeRow{raw: `{"defaultRequireFriendApproval":false}`}, group: true},
		{name: "显式关闭入群验证", row: fakeRow{raw: `{"defaultRequireGroupApproval":false}`}, friend: true},
		{name: "两项关闭", row: fakeRow{raw: `{"defaultRequireFriendApproval":false,"defaultRequireGroupApproval":false}`}},
		{name: "null 不降低验证", row: fakeRow{raw: `{"defaultRequireFriendApproval":null,"defaultRequireGroupApproval":null}`}, friend: true, group: true},
		{name: "格式错误不能静默放行", row: fakeRow{raw: `{"defaultRequireFriendApproval":"false"}`}, friend: true, group: true, wantErr: true},
		{name: "读取失败不能当作关闭", row: fakeRow{err: errors.New("database unavailable")}, friend: true, group: true, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := LoadPrivacyDefaults(context.Background(), fakeQuerier{row: tc.row})
			if (err != nil) != tc.wantErr {
				t.Fatalf("error = %v, wantErr = %v", err, tc.wantErr)
			}
			if got.RequireFriendApproval != tc.friend || got.RequireGroupApproval != tc.group {
				t.Fatalf("settings = %+v, want friend=%v group=%v", got, tc.friend, tc.group)
			}
		})
	}
}
