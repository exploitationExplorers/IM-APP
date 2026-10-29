package service

import (
	"context"
	"errors"
	"testing"
)

type sourceStub struct {
	source              string
	err                 error
	from, to, requested string
}

func (s *sourceStub) Grant(context.Context, string, string, string) error { return nil }
func (s *sourceStub) Take(context.Context, string) error                  { return nil }
func (s *sourceStub) Resolve(_ context.Context, from, to, requested string) (string, error) {
	s.from, s.to, s.requested = from, to, requested
	return s.source, s.err
}

func TestVerifiedFriendSource(t *testing.T) {
	for _, tc := range []struct {
		name, requested, stored, want string
		err                           error
	}{
		{"legacy QR request uses trusted source", "", "user_qrcode", "user_qrcode", nil},
		{"explicit search source", "public_id", "public_id", "public_id", nil},
		{"source spoofing rejected", "user_qrcode", "public_id", "", nil},
		{"invalid stored source rejected", "", "group", "", nil},
		{"missing authorization rejected", "", "", "", ErrFriendSourceRequired},
		{"storage failure fails closed", "", "", "", errors.New("storage offline")},
	} {
		t.Run(tc.name, func(t *testing.T) {
			store := &sourceStub{source: tc.stored, err: tc.err}
			got, err := verifiedFriendSource(context.Background(), store, "caller", "target", tc.requested)
			if got != tc.want || (tc.want == "") != (err != nil) {
				t.Fatalf("got %q, %v", got, err)
			}
			if store.from != "caller" || store.to != "target" || store.requested != tc.requested {
				t.Fatal("authorization subject changed")
			}
		})
	}
	if _, err := verifiedFriendSource(context.Background(), nil, "caller", "target", ""); !errors.Is(err, ErrFriendSourceRequired) {
		t.Fatal("nil authorization store allowed request")
	}
}
