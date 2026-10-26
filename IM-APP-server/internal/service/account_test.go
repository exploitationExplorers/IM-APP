package service

import (
	"context"
	"errors"
	"golang.org/x/crypto/bcrypt"
	"im-app-server/internal/models"
	"im-app-server/internal/repository"
	"testing"
)

type accountUsersStub struct {
	user models.User
	err  error
}

func (s accountUsersStub) FindByID(context.Context, string) (models.User, error) {
	return s.user, s.err
}

type accountRepoStub struct {
	calls    int
	id, hash string
	err      error
	count    int
}

func (s *accountRepoStub) Cancel(_ context.Context, id, hash string) error {
	s.calls++
	s.id = id
	s.hash = hash
	return s.err
}
func (s *accountRepoStub) OwnedGroupCount(context.Context, string) (int, error) {
	return s.count, s.err
}

func TestAccountDeletionRequiresActiveAccountAndPassword(t *testing.T) {
	hash, _ := bcrypt.GenerateFromPassword([]byte("correct-password"), bcrypt.MinCost)
	for _, tt := range []struct {
		name, status, password string
		want                   error
	}{
		{"wrong password", "active", "wrong-password", ErrAccountPassword},
		{"missing password", "active", "", ErrAccountPassword},
		{"canceled account", "canceled", "correct-password", ErrForbidden},
		{"banned account", "banned", "correct-password", ErrForbidden},
		{"valid identity", "active", "correct-password", nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			repo := &accountRepoStub{}
			svc := AccountService{Users: accountUsersStub{user: models.User{ID: "user-1", Status: tt.status, PasswordHash: string(hash)}}, Accounts: repo}
			if err := svc.Delete(context.Background(), "user-1", tt.password); !errors.Is(err, tt.want) {
				t.Fatalf("got %v, want %v", err, tt.want)
			}
			if tt.want != nil && repo.calls != 0 {
				t.Fatal("unauthorized deletion reached repository")
			}
			if tt.want == nil && (repo.calls != 1 || repo.id != "user-1" || repo.hash != string(hash)) {
				t.Fatal("verified account snapshot not passed to transaction")
			}
		})
	}
	repo := &accountRepoStub{err: repository.ErrAccountOwnsGroups}
	svc := AccountService{Users: accountUsersStub{user: models.User{Status: "active", PasswordHash: string(hash)}}, Accounts: repo}
	if err := svc.Delete(context.Background(), "user-1", "correct-password"); !errors.Is(err, repository.ErrAccountOwnsGroups) {
		t.Fatal(err)
	}
}
