package repository

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Archive copies and database writes share one transaction. The exclusive mode
// is reserved for maintenance; it does not by itself authorize media deletion.
const MediaLockID int64 = 73719841261018

type mediaTxKey struct{}
type mediaQuery interface {
	Exec(context.Context, string, ...any) (pgconn.CommandTag, error)
	QueryRow(context.Context, string, ...any) pgx.Row
}

func mediaQueries(ctx context.Context, pool *pgxpool.Pool) mediaQuery {
	if tx, ok := ctx.Value(mediaTxKey{}).(pgx.Tx); ok {
		return tx
	}
	return pool
}

type MediaGuard struct{ DB *pgxpool.Pool }

func (g *MediaGuard) WithShared(ctx context.Context, fn func(context.Context) error) error {
	return g.WithLock(ctx, true, fn)
}

func (g *MediaGuard) WithLock(ctx context.Context, shared bool, fn func(context.Context) error) error {
	tx, err := g.DB.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(context.Background())
	if _, err = tx.Exec(ctx, "SET LOCAL lock_timeout='2s'; SET LOCAL idle_in_transaction_session_timeout='180s'"); err != nil {
		return err
	}
	query := "SELECT pg_advisory_xact_lock($1)"
	if shared {
		query = "SELECT pg_advisory_xact_lock_shared($1)"
	}
	if _, err = tx.Exec(ctx, query, MediaLockID); err != nil {
		return err
	}
	if err = fn(context.WithValue(ctx, mediaTxKey{}, tx)); err != nil {
		return err
	}
	return tx.Commit(ctx)
}
