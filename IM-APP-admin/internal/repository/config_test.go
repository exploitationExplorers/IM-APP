package repository

import "testing"

func TestParseSystemLimitsPrivacyDefaults(t *testing.T) {
	for _, tc := range []struct {
		name, raw     string
		friend, group bool
		wantErr       bool
	}{
		{name: "缺配置安全开启", friend: true, group: true},
		{name: "旧配置", raw: `{"maxGroupMembers":2000}`, friend: true, group: true},
		{name: "明确关闭", raw: `{"defaultRequireFriendApproval":false,"defaultRequireGroupApproval":false}`},
		{name: "独立配置", raw: `{"defaultRequireFriendApproval":false}`, group: true},
		{name: "null 保持安全默认", raw: `{"defaultRequireFriendApproval":null}`, friend: true, group: true},
		{name: "类型错误拒绝发布", raw: `{"defaultRequireFriendApproval":"false"}`, wantErr: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got, err := parseSystemLimits(tc.raw)
			if (err != nil) != tc.wantErr {
				t.Fatalf("error=%v wantErr=%v", err, tc.wantErr)
			}
			if err == nil && (*got.DefaultRequireFriendApproval != tc.friend || *got.DefaultRequireGroupApproval != tc.group) {
				t.Fatalf("unexpected defaults: %+v", got)
			}
		})
	}
}
