package main

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"math/big"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func TestKeyReuseAndSeparation(t *testing.T) {
	dir := t.TempDir()
	for _, account := range []bool{true, false} {
		name := "leaf.pem"
		if account {
			name = "account.pem"
		}
		file := filepath.Join(dir, name)
		if _, err := privateKey(file, account, false); !os.IsNotExist(err) {
			t.Fatal("missing key must not be created by finish")
		}
		first, err := privateKey(file, account, true)
		if err != nil {
			t.Fatal(err)
		}
		before, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		second, err := privateKey(file, account, true)
		if err != nil {
			t.Fatal(err)
		}
		after, _ := os.ReadFile(file)
		if !reflect.DeepEqual(first.Public(), second.Public()) || string(before) != string(after) {
			t.Fatal("existing key was changed")
		}
		if _, err = privateKey(file, !account, true); err == nil {
			t.Fatal("incorrect key type accepted")
		}
	}
}
func TestMalformedKeyIsNotReplaced(t *testing.T) {
	file := filepath.Join(t.TempDir(), "key.pem")
	if err := os.WriteFile(file, []byte("invalid existing key"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := privateKey(file, false, true); err == nil {
		t.Fatal("invalid key accepted")
	}
	data, _ := os.ReadFile(file)
	if string(data) != "invalid existing key" {
		t.Fatal("existing file overwritten")
	}
}
func TestStateBoundaries(t *testing.T) {
	s := orderState{Version: 1, Domains: append([]string(nil), testDomains...), OrderURL: "https://acme-v02.api.letsencrypt.org/acme/order/123/456", Records: []dnsRecord{{Domain: testDomains[0], Name: "_acme-challenge." + testDomains[0], Value: strings.Repeat("a", 43), Authorization: "https://acme-v02.api.letsencrypt.org/acme/authz/1", Challenge: "https://acme-v02.api.letsencrypt.org/acme/chall/1"}}}
	if err := validateState(s); err != nil {
		t.Fatal(err)
	}
	for _, mutate := range []func(*orderState){
		func(s *orderState) { s.Domains = []string{"www.xn--jprz53bj9s.com"} },
		func(s *orderState) { s.OrderURL = "http://acme-v02.api.letsencrypt.org/acme/order/1" },
		func(s *orderState) { s.OrderURL = "https://example.com/acme/order/1" },
		func(s *orderState) { s.Records[0].Name = "_dnsauth." + testDomains[0] },
		func(s *orderState) { s.Records[0].Value = "wrong" },
		func(s *orderState) { s.Records = append(s.Records, s.Records[0]) },
	} {
		copy := s
		copy.Domains = append([]string(nil), s.Domains...)
		copy.Records = append([]dnsRecord(nil), s.Records...)
		mutate(&copy)
		if err := validateState(copy); err == nil {
			t.Fatal("unsafe state accepted")
		}
	}
}
func TestDNSQuotedValues(t *testing.T) {
	for input, want := range map[string]string{"plain": "plain", `"single"`: "single", `"first" "second"`: "firstsecond"} {
		if got := txtValue(input); got != want {
			t.Fatalf("unexpected TXT decoding: %q", got)
		}
	}
}
func TestExclusiveFileAndStateRoundTrip(t *testing.T) {
	dir := t.TempDir()
	file := filepath.Join(dir, "fullchain.pem")
	if err := writeExclusive(file, []byte("original")); err != nil {
		t.Fatal(err)
	}
	if err := writeExclusive(file, []byte("replacement")); !os.IsExist(err) {
		t.Fatal("existing certificate must not be overwritten")
	}
	for _, uri := range []string{"https://acme-v02.api.letsencrypt.org/acme/acct/1", "https://acme-v02.api.letsencrypt.org/acme/acct/2"} {
		path := filepath.Join(dir, "account.json")
		if err := saveJSON(path, accountState{URI: uri}); err != nil {
			t.Fatal(err)
		}
		var got accountState
		if err := readJSON(path, &got); err != nil || got.URI != uri {
			t.Fatal("state did not round trip")
		}
	}
}
func TestCertificateRejectsWrongKeyDomainsAndExpiry(t *testing.T) {
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().Truncate(time.Second)
	template := x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: testDomains[0]}, DNSNames: append([]string(nil), testDomains...), NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature, ExtKeyUsage: []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth}}
	issue := func(c x509.Certificate) []byte {
		der, err := x509.CreateCertificate(rand.Reader, &c, &c, &key.PublicKey, key)
		if err != nil {
			t.Fatal(err)
		}
		return der
	}
	der := issue(template)
	if _, err = validateLeaf(der, key, now); err != nil {
		t.Fatal(err)
	}
	other, _ := rsa.GenerateKey(rand.Reader, 2048)
	if _, err = validateLeaf(der, other, now); err == nil {
		t.Fatal("wrong private key accepted")
	}
	if _, err = validateLeaf(der, key, now.Add(2*time.Hour)); err == nil {
		t.Fatal("expired certificate accepted")
	}
	template.DNSNames = append(template.DNSNames, "www.xn--jprz53bj9s.com")
	if _, err = validateLeaf(issue(template), key, now); err == nil {
		t.Fatal("production domain accepted")
	}
}
