package repository

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
)

// fakeRow 模拟 app_config_versions 查询的一行：err 非 nil 表示「没有已发布的配置」。
type fakeRow struct {
	raw string
	err error
}

func (r fakeRow) Scan(dest ...any) error {
	if r.err != nil {
		return r.err
	}
	if len(dest) == 1 {
		if p, ok := dest[0].(*string); ok {
			*p = r.raw
		}
	}
	return nil
}

type fakeQuerier struct{ row pgx.Row }

func (q fakeQuerier) QueryRow(context.Context, string, ...any) pgx.Row { return q.row }

// TestPublishedGroupLimitsEnvOverride 锁住群成员上限的解析优先级：
// 环境变量覆盖 > 管理后台发布的配置 > 代码兜底，且始终受技术硬上限约束。
func TestPublishedGroupLimitsEnvOverride(t *testing.T) {
	cases := []struct {
		name           string
		repo           GroupRepo
		row            pgx.Row
		wantMax        int
		wantDefaultMax int
	}{
		{
			name:           "没有已发布配置时用兜底 500/200",
			repo:           GroupRepo{GroupMemberHardLimit: 4000},
			row:            fakeRow{err: pgx.ErrNoRows},
			wantMax:        500,
			wantDefaultMax: 200,
		},
		{
			name:           "已发布配置说了算",
			repo:           GroupRepo{GroupMemberHardLimit: 4000},
			row:            fakeRow{raw: `{"maxGroupMembers":800,"defaultGroupMaxMembers":300}`},
			wantMax:        800,
			wantDefaultMax: 300,
		},
		{
			name:           "环境变量覆盖已发布配置",
			repo:           GroupRepo{GroupMemberHardLimit: 4000, GroupMemberMax: 2000, DefaultGroupMaxMembers: 2000},
			row:            fakeRow{raw: `{"maxGroupMembers":500,"defaultGroupMaxMembers":200}`},
			wantMax:        2000,
			wantDefaultMax: 2000,
		},
		{
			name:           "覆盖值仍受技术硬上限约束",
			repo:           GroupRepo{GroupMemberHardLimit: 1500, GroupMemberMax: 2000},
			row:            fakeRow{raw: `{}`},
			wantMax:        1500,
			wantDefaultMax: 200,
		},
		{
			name:           "default 不能超过 max",
			repo:           GroupRepo{GroupMemberHardLimit: 4000, GroupMemberMax: 300, DefaultGroupMaxMembers: 2000},
			row:            fakeRow{raw: `{}`},
			wantMax:        300,
			wantDefaultMax: 300,
		},
		{
			name:           "未设置覆盖时不改变原有行为",
			repo:           GroupRepo{GroupMemberHardLimit: 4000},
			row:            fakeRow{raw: `{"maxGroupMembers":1000,"defaultGroupMaxMembers":700}`},
			wantMax:        1000,
			wantDefaultMax: 700,
		},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			repo := tc.repo
			got := repo.publishedGroupLimits(context.Background(), fakeQuerier{row: tc.row})
			if got.MaxGroupMembers != tc.wantMax || got.DefaultGroupMaxMembers != tc.wantDefaultMax {
				t.Fatalf("publishedGroupLimits() = {max:%d default:%d}, want {max:%d default:%d}",
					got.MaxGroupMembers, got.DefaultGroupMaxMembers, tc.wantMax, tc.wantDefaultMax)
			}
		})
	}
}
