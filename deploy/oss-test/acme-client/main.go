// Manual DNS-01 client for the two isolated OSS test hostnames only.
// Uses the repository's existing x/crypto dependency; never reads OSS credentials.
package main

import (
	"context"
	"crypto"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/json"
	"encoding/pem"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/acme"
)

var testDomains = []string{"oss-chat-test.xn--jprz53bj9s.com", "oss-business-test.xn--jprz53bj9s.com"}
var errDNSPending = errors.New("public DNS verification records are not ready")

type dnsRecord struct {
	Domain        string `json:"domain"`
	Name          string `json:"name"`
	Value         string `json:"value"`
	Authorization string `json:"authorization"`
	Challenge     string `json:"challenge"`
}
type orderState struct {
	Version  int         `json:"version"`
	Domains  []string    `json:"domains"`
	OrderURL string      `json:"orderURL"`
	Expires  time.Time   `json:"expires"`
	Records  []dnsRecord `json:"records"`
}
type accountState struct {
	URI string `json:"uri"`
}

func acmeURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && u.Scheme == "https" && u.Host == "acme-v02.api.letsencrypt.org" && u.User == nil && u.RawQuery == "" && u.Fragment == "" && strings.HasPrefix(u.Path, "/acme/")
}
func sameDomains(got []string) bool {
	a, b := append([]string(nil), got...), append([]string(nil), testDomains...)
	sort.Strings(a)
	sort.Strings(b)
	return reflect.DeepEqual(a, b)
}
func validateState(s orderState) error {
	if s.Version != 1 || !sameDomains(s.Domains) || !acmeURL(s.OrderURL) || len(s.Records) > len(testDomains) {
		return errors.New("invalid local certificate state")
	}
	seen := map[string]bool{}
	for _, r := range s.Records {
		if !contains(testDomains, r.Domain) || seen[r.Domain] || r.Name != "_acme-challenge."+r.Domain || !regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`).MatchString(r.Value) || !acmeURL(r.Authorization) || !acmeURL(r.Challenge) {
			return errors.New("invalid DNS challenge state")
		}
		seen[r.Domain] = true
	}
	return nil
}
func contains(values []string, value string) bool {
	for _, v := range values {
		if v == value {
			return true
		}
	}
	return false
}

// Private keys use exclusive creation. Existing keys are never overwritten.
func privateKey(file string, account bool, create bool) (crypto.Signer, error) {
	if info, err := os.Lstat(file); err == nil {
		if !info.Mode().IsRegular() {
			return nil, errors.New("non-regular key file refused")
		}
		b, err := os.ReadFile(file)
		if err != nil {
			return nil, err
		}
		block, rest := pem.Decode(b)
		if block == nil || len(strings.TrimSpace(string(rest))) != 0 {
			return nil, errors.New("invalid key file")
		}
		var key any
		switch block.Type {
		case "PRIVATE KEY":
			key, err = x509.ParsePKCS8PrivateKey(block.Bytes)
		case "RSA PRIVATE KEY":
			key, err = x509.ParsePKCS1PrivateKey(block.Bytes)
		default:
			return nil, errors.New("unsupported key file")
		}
		if err != nil {
			return nil, err
		}
		if account {
			k, ok := key.(*ecdsa.PrivateKey)
			if ok && k.Curve == elliptic.P256() {
				return k, nil
			}
		} else {
			k, ok := key.(*rsa.PrivateKey)
			if ok && k.N.BitLen() >= 2048 {
				return k, nil
			}
		}
		return nil, errors.New("unexpected private key type")
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if !create {
		return nil, os.ErrNotExist
	}
	var signer crypto.Signer
	var block pem.Block
	if account {
		key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
		if err != nil {
			return nil, err
		}
		signer = key
		der, err := x509.MarshalPKCS8PrivateKey(key)
		if err != nil {
			return nil, err
		}
		block = pem.Block{Type: "PRIVATE KEY", Bytes: der}
	} else {
		key, err := rsa.GenerateKey(rand.Reader, 2048)
		if err != nil {
			return nil, err
		}
		signer = key
		block = pem.Block{Type: "RSA PRIVATE KEY", Bytes: x509.MarshalPKCS1PrivateKey(key)}
	}
	f, err := os.OpenFile(file, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return nil, err
	}
	err = pem.Encode(f, &block)
	closeErr := f.Close()
	if err != nil {
		return nil, err
	}
	return signer, closeErr
}
func readJSON(file string, out any) error {
	info, err := os.Lstat(file)
	if err != nil {
		return err
	}
	if !info.Mode().IsRegular() {
		return errors.New("non-regular state file refused")
	}
	b, err := os.ReadFile(file)
	if err != nil {
		return err
	}
	return json.Unmarshal(b, out)
}
func saveJSON(file string, value any) error {
	b, err := json.MarshalIndent(value, "", "  ")
	if err != nil {
		return err
	}
	f, err := os.CreateTemp(filepath.Dir(file), "acme-state-*.tmp")
	if err != nil {
		return err
	}
	name := f.Name()
	defer os.Remove(name)
	if err = f.Chmod(0600); err == nil {
		_, err = f.Write(append(b, '\n'))
	}
	closeErr := f.Close()
	if err != nil {
		return err
	}
	if closeErr != nil {
		return closeErr
	}
	return os.Rename(name, file)
}
func clientFor(dir string, create bool, acceptTerms bool) (*acme.Client, error) {
	var account accountState
	err := readJSON(filepath.Join(dir, "account.json"), &account)
	if err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	if account.URI == "" && (!create || !acceptTerms) {
		return nil, errors.New("explicit Let's Encrypt terms acceptance required")
	}
	key, err := privateKey(filepath.Join(dir, "account-key.pem"), true, create)
	if err != nil {
		return nil, err
	}
	c := &acme.Client{Key: key, DirectoryURL: acme.LetsEncryptURL, UserAgent: "IM-APP-local-oss-test/1", HTTPClient: &http.Client{Timeout: 30 * time.Second}, RetryBackoff: func(n int, _ *http.Request, r *http.Response) time.Duration {
		if n > 2 || (r != nil && r.StatusCode == 429) {
			return 0
		}
		return time.Second
	}}
	if account.URI != "" {
		if !acmeURL(account.URI) {
			return nil, errors.New("invalid account URI")
		}
		c.KID = acme.KeyID(account.URI)
		return c, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	registered, err := c.Register(ctx, &acme.Account{}, acme.AcceptTOS)
	if err != nil {
		return nil, err
	}
	if !acmeURL(registered.URI) {
		return nil, errors.New("unexpected account URI")
	}
	if err = saveJSON(filepath.Join(dir, "account.json"), accountState{URI: registered.URI}); err != nil {
		return nil, err
	}
	c.KID = acme.KeyID(registered.URI)
	return c, nil
}
func prepare(ctx context.Context, dir string, c *acme.Client) (orderState, error) {
	if _, err := privateKey(filepath.Join(dir, "privkey.pem"), false, true); err != nil {
		return orderState{}, err
	}
	var s orderState
	err := readJSON(filepath.Join(dir, "order.json"), &s)
	if errors.Is(err, os.ErrNotExist) {
		order, err := c.AuthorizeOrder(ctx, acme.DomainIDs(testDomains...))
		if err != nil {
			return s, err
		}
		s = orderState{Version: 1, Domains: append([]string(nil), testDomains...), OrderURL: order.URI, Expires: order.Expires}
		if err = validateState(s); err != nil {
			return s, err
		}
		// Persist before querying authorizations, so a retry resumes this order.
		if err = saveJSON(filepath.Join(dir, "order.json"), s); err != nil {
			return s, err
		}
	} else if err != nil {
		return s, err
	}
	if err = validateState(s); err != nil {
		return s, err
	}
	order, err := c.GetOrder(ctx, s.OrderURL)
	if err != nil {
		return s, err
	}
	if !order.Expires.IsZero() && !time.Now().Before(order.Expires) {
		return s, errors.New("certificate order expired; preserve the existing keys")
	}
	if order.Status != acme.StatusPending && order.Status != acme.StatusReady && order.Status != acme.StatusValid {
		return s, errors.New("certificate order not usable")
	}
	s.Records = nil
	for _, authURL := range order.AuthzURLs {
		if !acmeURL(authURL) {
			return s, errors.New("unexpected authorization URL")
		}
		auth, err := c.GetAuthorization(ctx, authURL)
		if err != nil {
			return s, err
		}
		if auth.Identifier.Type != "dns" || !contains(testDomains, auth.Identifier.Value) || auth.Wildcard {
			return s, errors.New("unexpected certificate identifier")
		}
		if auth.Status == acme.StatusValid {
			continue
		}
		if auth.Status != acme.StatusPending {
			return s, errors.New("authorization not pending")
		}
		var challenge *acme.Challenge
		for _, ch := range auth.Challenges {
			if ch.Type == "dns-01" {
				challenge = ch
				break
			}
		}
		if challenge == nil || !acmeURL(challenge.URI) {
			return s, errors.New("DNS-01 challenge unavailable")
		}
		value, err := c.DNS01ChallengeRecord(challenge.Token)
		if err != nil {
			return s, err
		}
		s.Records = append(s.Records, dnsRecord{Domain: auth.Identifier.Value, Name: "_acme-challenge." + auth.Identifier.Value, Value: value, Authorization: authURL, Challenge: challenge.URI})
	}
	if err = validateState(s); err != nil {
		return s, err
	}
	return s, saveJSON(filepath.Join(dir, "order.json"), s)
}
func txtValue(data string) string {
	parts := regexp.MustCompile(`"(?:[^"\\]|\\.)*"`).FindAllString(data, -1)
	if len(parts) == 0 {
		return data
	}
	var result strings.Builder
	for _, p := range parts {
		value, err := strconv.Unquote(p)
		if err != nil {
			return ""
		}
		result.WriteString(value)
	}
	return result.String()
}
func dnsReady(ctx context.Context, r dnsRecord) error {
	for _, resolver := range []string{"https://dns.alidns.com/resolve", "https://cloudflare-dns.com/dns-query"} {
		req, err := http.NewRequestWithContext(ctx, "GET", resolver+"?name="+url.QueryEscape(r.Name)+"&type=TXT", nil)
		if err != nil {
			return err
		}
		req.Header.Set("Accept", "application/dns-json")
		res, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
		if err != nil {
			return err
		}
		var response struct {
			Status int
			Answer []struct {
				Name string
				Type int
				Data string
			}
		}
		err = json.NewDecoder(io.LimitReader(res.Body, 128*1024)).Decode(&response)
		res.Body.Close()
		if err != nil {
			return err
		}
		found := false
		for _, a := range response.Answer {
			if a.Type == 16 && strings.TrimSuffix(a.Name, ".") == r.Name && txtValue(a.Data) == r.Value {
				found = true
			}
		}
		if res.StatusCode != 200 || response.Status != 0 || !found {
			return errDNSPending
		}
	}
	return nil
}
func validateLeaf(der []byte, key crypto.Signer, now time.Time) (*x509.Certificate, error) {
	cert, err := x509.ParseCertificate(der)
	if err != nil {
		return nil, err
	}
	public, err := x509.MarshalPKIXPublicKey(key.Public())
	if err != nil {
		return nil, err
	}
	if !reflect.DeepEqual(cert.RawSubjectPublicKeyInfo, public) || !sameDomains(cert.DNSNames) || len(cert.IPAddresses) != 0 || now.Before(cert.NotBefore) || !now.Before(cert.NotAfter) {
		return nil, errors.New("issued certificate did not match key/domains/validity")
	}
	for _, domain := range testDomains {
		if err = cert.VerifyHostname(domain); err != nil {
			return nil, err
		}
	}
	return cert, nil
}
func writeExclusive(file string, data []byte) error {
	f, err := os.OpenFile(file, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, err = f.Write(data)
	closeErr := f.Close()
	if err != nil {
		return err
	}
	return closeErr
}
func finish(ctx context.Context, dir string, c *acme.Client) error {
	var s orderState
	if err := readJSON(filepath.Join(dir, "order.json"), &s); err != nil {
		return err
	}
	if err := validateState(s); err != nil {
		return err
	}
	key, err := privateKey(filepath.Join(dir, "privkey.pem"), false, false)
	if err != nil {
		return err
	}
	if _, err = os.Lstat(filepath.Join(dir, "fullchain.pem")); err == nil {
		return errors.New("certificate already exists; do not overwrite it")
	} else if !errors.Is(err, os.ErrNotExist) {
		return err
	}
	order, err := c.GetOrder(ctx, s.OrderURL)
	if err != nil {
		return err
	}
	if order.Status == acme.StatusPending {
		if len(s.Records) == 0 {
			return errors.New("prepare DNS records first")
		}
		// Check every TXT before notifying the CA. Never trigger known-bad validation.
		for _, r := range s.Records {
			if err = dnsReady(ctx, r); err != nil {
				return err
			}
		}
		for _, r := range s.Records {
			auth, err := c.GetAuthorization(ctx, r.Authorization)
			if err != nil {
				return err
			}
			if auth.Status == acme.StatusValid {
				continue
			}
			if auth.Status != acme.StatusPending {
				return errors.New("authorization is not pending")
			}
			var challenge *acme.Challenge
			for _, ch := range auth.Challenges {
				if ch.URI == r.Challenge && ch.Type == "dns-01" {
					challenge = ch
				}
			}
			if challenge == nil {
				return errors.New("saved challenge unavailable")
			}
			if _, err = c.Accept(ctx, challenge); err != nil {
				return err
			}
			if _, err = c.WaitAuthorization(ctx, r.Authorization); err != nil {
				return err
			}
		}
		order, err = c.WaitOrder(ctx, s.OrderURL)
		if err != nil {
			return err
		}
	}
	var chain [][]byte
	if order.Status == acme.StatusValid {
		if !acmeURL(order.CertURL) {
			return errors.New("unexpected certificate URL")
		}
		chain, err = c.FetchCert(ctx, order.CertURL, true)
	} else if order.Status == acme.StatusReady {
		if !acmeURL(order.FinalizeURL) {
			return errors.New("unexpected finalize URL")
		}
		csr, csrErr := x509.CreateCertificateRequest(rand.Reader, &x509.CertificateRequest{Subject: pkix.Name{CommonName: testDomains[0]}, DNSNames: append([]string(nil), testDomains...)}, key)
		if csrErr != nil {
			return csrErr
		}
		chain, _, err = c.CreateOrderCert(ctx, order.FinalizeURL, csr, true)
	} else {
		return errors.New("order is not ready for issuance")
	}
	if err != nil {
		return err
	}
	if len(chain) == 0 {
		return errors.New("empty certificate chain")
	}
	cert, err := validateLeaf(chain[0], key, time.Now())
	if err != nil {
		return err
	}
	intermediates := x509.NewCertPool()
	for _, der := range chain[1:] {
		issuer, err := x509.ParseCertificate(der)
		if err != nil {
			return err
		}
		intermediates.AddCert(issuer)
	}
	if _, err = cert.Verify(x509.VerifyOptions{DNSName: testDomains[0], Intermediates: intermediates}); err != nil {
		return err
	}
	var fullchain []byte
	for _, der := range chain {
		fullchain = append(fullchain, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})...)
	}
	if err = writeExclusive(filepath.Join(dir, "fullchain.pem"), fullchain); err != nil {
		return err
	}
	fmt.Printf("Certificate verified. Expires: %s\nCertificate file: %s\nPrivate key file: %s\n", cert.NotAfter.In(time.FixedZone("Asia/Shanghai", 8*3600)).Format(time.RFC3339), filepath.Join(dir, "fullchain.pem"), filepath.Join(dir, "privkey.pem"))
	return nil
}
func showRecords(s orderState) {
	fmt.Println("DNS-01 records only; no private keys or credentials are printed. Do not delete existing DNS records.")
	for _, r := range s.Records {
		fmt.Printf("\nDomain: %s\nType: TXT\nHost: %s\nFull name: %s\nValue: %s\n", r.Domain, strings.TrimSuffix(r.Name, ".xn--jprz53bj9s.com"), r.Name, r.Value)
	}
	if !s.Expires.IsZero() {
		fmt.Printf("\nOrder expires (Asia/Shanghai): %s\n", s.Expires.In(time.FixedZone("Asia/Shanghai", 8*3600)).Format(time.RFC3339))
	}
	fmt.Println("CA validation has NOT been requested by prepare. Add TXT records, then run finish.")
}
func run() error {
	action := flag.String("action", "status", "prepare, status, or finish")
	dir := flag.String("dir", "", "absolute Git-ignored certificate directory")
	terms := flag.Bool("accept-terms", false, "accept Let's Encrypt terms during first registration")
	flag.Parse()
	if flag.NArg() != 0 || !filepath.IsAbs(*dir) || !contains([]string{"prepare", "status", "finish"}, *action) {
		return errors.New("invalid local certificate command")
	}
	if err := os.MkdirAll(*dir, 0700); err != nil {
		return err
	}
	info, err := os.Lstat(*dir)
	if err != nil {
		return err
	}
	if !info.IsDir() || info.Mode()&os.ModeSymlink != 0 {
		return errors.New("certificate directory must not be a link")
	}
	if *action == "status" {
		var s orderState
		if err = readJSON(filepath.Join(*dir, "order.json"), &s); err != nil {
			return err
		}
		if err = validateState(s); err != nil {
			return err
		}
		showRecords(s)
		return nil
	}
	c, err := clientFor(*dir, *action == "prepare", *terms)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if *action == "prepare" {
		s, err := prepare(ctx, *dir, c)
		if err != nil {
			return err
		}
		showRecords(s)
		return nil
	}
	return finish(ctx, *dir, c)
}
func main() {
	if err := run(); err != nil {
		// Raw HTTP/ACME errors can contain URLs/tokens. Never print their bodies.
		var remote *acme.Error
		switch {
		case errors.Is(err, errDNSPending):
			fmt.Fprintln(os.Stderr, "Public TXT records not ready; CA validation was not requested.")
		case errors.As(err, &remote):
			fmt.Fprintf(os.Stderr, "ACME request failed: HTTP %d, type %s. Existing keys/state preserved.\n", remote.StatusCode, remote.ProblemType)
		default:
			fmt.Fprintln(os.Stderr, "Certificate command refused or failed. Check action, local state, network, DNS and certificate validity; no secrets printed. Existing keys were not overwritten.")
		}
		os.Exit(1)
	}
}
