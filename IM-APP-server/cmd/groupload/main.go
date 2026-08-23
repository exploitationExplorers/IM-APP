// groupload drives lightweight OpenIM group-message smoke and load tests.
// It opens one real WebSocket connection per selected business group member,
// sends marked text messages through OpenIM's REST API, and correlates push
// frames by operationID to measure delivery completeness and latency.
package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"

	"im-app-server/internal/config"
	"im-app-server/internal/db"
	"im-app-server/internal/im"
)

const wsPushMessage = 2001

type options struct {
	groupPublicID  string
	clientCount    int
	messageCount   int
	connectWorkers int
	platformID     int
	interval       time.Duration
	receiveTimeout time.Duration
	runID          string
	wsURL          string
	apiURL         string
	databaseURL    string
	notOfflinePush bool
}

type member struct {
	businessID string
	openIMID   string
}

type wsResponse struct {
	ReqIdentifier int    `json:"reqIdentifier"`
	OperationID   string `json:"operationID"`
	ErrCode       int    `json:"errCode"`
	ErrMsg        string `json:"errMsg"`
	Data          []byte `json:"data"`
}

type apiEnvelope struct {
	ErrCode int             `json:"errCode"`
	ErrMsg  string          `json:"errMsg"`
	ErrDlt  string          `json:"errDlt"`
	Data    json.RawMessage `json:"data"`
}

type trackedOperation struct {
	sentAt time.Time
}

type loadClient struct {
	userID string
	conn   *websocket.Conn
	seen   map[string]struct{}
	done   chan struct{}
	once   sync.Once
}

type metricSet struct {
	operations sync.Map
	matched    atomic.Int64
	duplicate  atomic.Int64
	unrelated  atomic.Int64
	disconnect atomic.Int64

	mu                sync.Mutex
	connectLatencies  []time.Duration
	deliveryLatencies []time.Duration
}

type latencySummary struct {
	Min float64 `json:"minMs"`
	P50 float64 `json:"p50Ms"`
	P95 float64 `json:"p95Ms"`
	P99 float64 `json:"p99Ms"`
	Max float64 `json:"maxMs"`
}

type report struct {
	RunID                 string         `json:"runId"`
	GroupPublicID         string         `json:"groupPublicId"`
	OpenIMGroupID         string         `json:"openIMGroupId"`
	StartedAt             string         `json:"startedAt"`
	EndedAt               string         `json:"endedAt"`
	RequestedClients      int            `json:"requestedClients"`
	ConnectedClients      int            `json:"connectedClients"`
	ConnectionFailures    int            `json:"connectionFailures"`
	RequestedMessages     int            `json:"requestedMessages"`
	SuccessfulMessages    int            `json:"successfulMessages"`
	MessageFailures       int            `json:"messageFailures"`
	ExpectedPushes        int64          `json:"expectedPushes"`
	MatchedPushes         int64          `json:"matchedPushes"`
	MissingPushes         int64          `json:"missingPushes"`
	DuplicatePushes       int64          `json:"duplicatePushes"`
	UnrelatedPushes       int64          `json:"unrelatedPushes"`
	UnexpectedDisconnects int64          `json:"unexpectedDisconnects"`
	ConnectLatency        latencySummary `json:"connectLatency"`
	SendAckLatency        latencySummary `json:"sendAckLatency"`
	DeliveryLatency       latencySummary `json:"deliveryLatency"`
	Pass                  bool           `json:"pass"`
	FailureReason         string         `json:"failureReason,omitempty"`
}

func main() {
	cfg := config.Load()
	opts := parseFlags(cfg)
	if err := validateOptions(opts, cfg); err != nil {
		log.Fatal(err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	started := time.Now()

	pool, err := db.Connect(opts.databaseURL)
	if err != nil {
		log.Fatalf("database: %v", err)
	}
	defer pool.Close()

	groupInternalID, members, err := loadMembers(ctx, pool, opts.groupPublicID, opts.clientCount)
	if err != nil {
		log.Fatal(err)
	}
	groupIMID, err := im.UserIDFromBusinessID(groupInternalID)
	if err != nil {
		log.Fatalf("map group id: %v", err)
	}
	log.Printf("run=%s group=%s openimGroup=%s selectedMembers=%d", opts.runID, opts.groupPublicID, groupIMID, len(members))

	imCfg := cfg.OpenIM
	imCfg.APIURL = opts.apiURL
	imClient := im.NewClient(imCfg)
	metrics := &metricSet{}
	clients, failures := connectClients(ctx, opts, imClient, members, metrics)
	defer closeClients(clients)

	result := report{
		RunID: opts.runID, GroupPublicID: opts.groupPublicID, OpenIMGroupID: groupIMID,
		StartedAt: started.UTC().Format(time.RFC3339Nano), RequestedClients: opts.clientCount,
		ConnectedClients: len(clients), ConnectionFailures: failures,
		RequestedMessages: opts.messageCount,
	}
	if len(clients) != opts.clientCount {
		result.FailureReason = "not all WebSocket clients connected"
		finishReport(&result, metrics, nil, time.Now())
		emitReport(result)
		os.Exit(1)
	}

	// Give the gateway a short deterministic window to finish registration.
	time.Sleep(2 * time.Second)
	adminToken, err := imClient.GetAdminToken(ctx)
	if err != nil {
		log.Fatalf("get OpenIM admin token: %v", err)
	}

	ackLatencies := make([]time.Duration, 0, opts.messageCount)
	for i := 0; i < opts.messageCount; i++ {
		opID := fmt.Sprintf("%s-group-msg-%06d", opts.runID, i+1)
		marker := fmt.Sprintf("[%s] group smoke message %d/%d", opts.runID, i+1, opts.messageCount)
		sentAt := time.Now()
		metrics.operations.Store(opID, trackedOperation{sentAt: sentAt})
		if err := sendGroupText(ctx, opts.apiURL, adminToken, cfg.OpenIM.AdminUser, groupIMID, opID, marker, opts.notOfflinePush); err != nil {
			metrics.operations.Delete(opID)
			result.MessageFailures++
			log.Printf("send %d/%d failed: %v", i+1, opts.messageCount, err)
		} else {
			result.SuccessfulMessages++
			ackLatencies = append(ackLatencies, time.Since(sentAt))
			log.Printf("send %d/%d accepted", i+1, opts.messageCount)
		}
		if i+1 < opts.messageCount {
			time.Sleep(opts.interval)
		}
	}

	expected := int64(len(clients) * result.SuccessfulMessages)
	deadline := time.Now().Add(opts.receiveTimeout)
	for metrics.matched.Load() < expected && time.Now().Before(deadline) {
		time.Sleep(50 * time.Millisecond)
	}
	result.ExpectedPushes = expected
	result.MatchedPushes = metrics.matched.Load()
	result.MissingPushes = max64(0, expected-result.MatchedPushes)
	result.DuplicatePushes = metrics.duplicate.Load()
	result.UnrelatedPushes = metrics.unrelated.Load()
	result.UnexpectedDisconnects = metrics.disconnect.Load()

	result.Pass = result.ConnectionFailures == 0 && result.MessageFailures == 0 &&
		result.MissingPushes == 0 && result.DuplicatePushes == 0 && result.UnexpectedDisconnects == 0
	if !result.Pass && result.FailureReason == "" {
		result.FailureReason = "connection, send, delivery, duplicate, or disconnect check failed"
	}
	finishReport(&result, metrics, ackLatencies, time.Now())
	emitReport(result)
	if !result.Pass {
		os.Exit(1)
	}
}

func parseFlags(cfg config.Config) options {
	var opts options
	defaultWS := strings.TrimSpace(cfg.OpenIM.PublicWSURL)
	if defaultWS == "" {
		defaultWS = "ws://127.0.0.1:10001"
	}
	flag.StringVar(&opts.groupPublicID, "group", "", "business group public ID")
	flag.IntVar(&opts.clientCount, "clients", 20, "number of real OpenIM WebSocket clients")
	flag.IntVar(&opts.messageCount, "messages", 3, "number of marked group messages")
	flag.IntVar(&opts.connectWorkers, "connect-workers", 10, "parallel token/connect workers")
	flag.IntVar(&opts.platformID, "platform", 7, "OpenIM platform ID used by load clients")
	flag.DurationVar(&opts.interval, "interval", time.Second, "interval between group messages")
	flag.DurationVar(&opts.receiveTimeout, "receive-timeout", 20*time.Second, "wait for expected pushes")
	flag.StringVar(&opts.runID, "run", fmt.Sprintf("group-%d", time.Now().Unix()), "unique run ID")
	flag.StringVar(&opts.wsURL, "ws", defaultWS, "OpenIM WebSocket base URL")
	flag.StringVar(&opts.apiURL, "api", cfg.OpenIM.APIURL, "OpenIM internal API URL")
	flag.StringVar(&opts.databaseURL, "database-url", cfg.DatabaseURL, "PostgreSQL URL")
	flag.BoolVar(&opts.notOfflinePush, "no-offline-push", true, "disable external offline push during online load test")
	flag.Parse()
	return opts
}

func validateOptions(opts options, cfg config.Config) error {
	if strings.TrimSpace(opts.groupPublicID) == "" {
		return errors.New("-group is required")
	}
	if opts.clientCount < 1 || opts.clientCount > 4000 {
		return errors.New("-clients must be in 1..4000")
	}
	if opts.messageCount < 1 || opts.messageCount > 10000 {
		return errors.New("-messages must be in 1..10000")
	}
	if opts.connectWorkers < 1 || opts.connectWorkers > 200 {
		return errors.New("-connect-workers must be in 1..200")
	}
	if strings.TrimSpace(opts.apiURL) == "" || strings.TrimSpace(opts.wsURL) == "" || strings.TrimSpace(cfg.OpenIM.Secret) == "" {
		return errors.New("OpenIM API, WS, and secret must be configured")
	}
	return nil
}

func loadMembers(ctx context.Context, pool *pgxpool.Pool, groupPublicID string, limit int) (string, []member, error) {
	var groupID string
	if err := pool.QueryRow(ctx, `SELECT id::text FROM groups WHERE public_id=$1 AND COALESCE(status,'active')='active'`, groupPublicID).Scan(&groupID); err != nil {
		return "", nil, fmt.Errorf("load group: %w", err)
	}
	rows, err := pool.Query(ctx, `
		SELECT u.id::text
		FROM group_members gm
		JOIN users u ON u.id=gm.user_id
		WHERE gm.group_id=$1::uuid AND COALESCE(u.status,'active')='active'
		ORDER BY CASE gm.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, gm.joined_at, u.id
		LIMIT $2`, groupID, limit)
	if err != nil {
		return "", nil, fmt.Errorf("query members: %w", err)
	}
	defer rows.Close()
	members := make([]member, 0, limit)
	for rows.Next() {
		var businessID string
		if err := rows.Scan(&businessID); err != nil {
			return "", nil, err
		}
		openID, err := im.UserIDFromBusinessID(businessID)
		if err != nil {
			return "", nil, err
		}
		members = append(members, member{businessID: businessID, openIMID: openID})
	}
	if err := rows.Err(); err != nil {
		return "", nil, err
	}
	if len(members) != limit {
		return "", nil, fmt.Errorf("group has %d active members, need %d", len(members), limit)
	}
	return groupID, members, nil
}

func connectClients(ctx context.Context, opts options, imClient *im.Client, members []member, metrics *metricSet) ([]*loadClient, int) {
	type result struct {
		client  *loadClient
		latency time.Duration
		err     error
	}
	jobs := make(chan member)
	results := make(chan result, len(members))
	workers := minInt(opts.connectWorkers, len(members))
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for item := range jobs {
				token, err := imClient.GetUserToken(ctx, item.openIMID, opts.platformID)
				if err != nil {
					results <- result{err: fmt.Errorf("token %s: %w", item.openIMID, err)}
					continue
				}
				started := time.Now()
				conn, err := dialClient(ctx, opts, item.openIMID, token.Token)
				results <- result{client: conn, latency: time.Since(started), err: err}
			}
		}()
	}
	go func() {
		for _, item := range members {
			jobs <- item
		}
		close(jobs)
		wg.Wait()
		close(results)
	}()

	clients := make([]*loadClient, 0, len(members))
	failures := 0
	for item := range results {
		if item.err != nil {
			failures++
			log.Printf("connect failed: %v", item.err)
			continue
		}
		clients = append(clients, item.client)
		metrics.mu.Lock()
		metrics.connectLatencies = append(metrics.connectLatencies, item.latency)
		metrics.mu.Unlock()
		go item.client.heartbeat()
		go item.client.readLoop(metrics)
		if len(clients)%10 == 0 || len(clients) == len(members) {
			log.Printf("connected %d/%d", len(clients), len(members))
		}
	}
	return clients, failures
}

func dialClient(ctx context.Context, opts options, userID, token string) (*loadClient, error) {
	u, err := url.Parse(opts.wsURL)
	if err != nil {
		return nil, err
	}
	if u.Path == "" || u.Path == "/" {
		u.Path = "/msg_gateway"
	}
	q := u.Query()
	q.Set("sendID", userID)
	q.Set("token", token)
	q.Set("platformID", fmt.Sprint(opts.platformID))
	q.Set("operationID", fmt.Sprintf("%s-connect-%s", opts.runID, userID))
	q.Set("isBackground", "false")
	q.Set("isMsgResp", "true")
	q.Set("sdkType", "js")
	u.RawQuery = q.Encode()

	dialer := websocket.Dialer{HandshakeTimeout: 10 * time.Second}
	conn, response, err := dialer.DialContext(ctx, u.String(), nil)
	if err != nil {
		if response != nil {
			return nil, fmt.Errorf("websocket HTTP %d: %w", response.StatusCode, err)
		}
		return nil, err
	}
	conn.SetReadLimit(1 << 20)
	_ = conn.SetReadDeadline(time.Now().Add(10 * time.Second))
	_, raw, err := conn.ReadMessage()
	_ = conn.SetReadDeadline(time.Time{})
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("read handshake response: %w", err)
	}
	var envelope apiEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		conn.Close()
		return nil, fmt.Errorf("decode handshake response: %w", err)
	}
	if envelope.ErrCode != 0 {
		conn.Close()
		return nil, fmt.Errorf("handshake errCode=%d msg=%s detail=%s", envelope.ErrCode, envelope.ErrMsg, envelope.ErrDlt)
	}
	return &loadClient{
		userID: userID,
		conn:   conn,
		seen:   make(map[string]struct{}),
		done:   make(chan struct{}),
	}, nil
}

func (c *loadClient) readLoop(metrics *metricSet) {
	defer c.once.Do(func() { close(c.done) })
	for {
		_, raw, err := c.conn.ReadMessage()
		if err != nil {
			if !websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) && !strings.Contains(err.Error(), "use of closed network connection") {
				metrics.disconnect.Add(1)
			}
			return
		}
		var resp wsResponse
		if json.Unmarshal(raw, &resp) != nil || resp.ReqIdentifier != wsPushMessage {
			continue
		}
		value, tracked := metrics.operations.Load(resp.OperationID)
		if !tracked {
			metrics.unrelated.Add(1)
			continue
		}
		if _, exists := c.seen[resp.OperationID]; exists {
			metrics.duplicate.Add(1)
			continue
		}
		c.seen[resp.OperationID] = struct{}{}
		op := value.(trackedOperation)
		metrics.matched.Add(1)
		metrics.mu.Lock()
		metrics.deliveryLatencies = append(metrics.deliveryLatencies, time.Since(op.sentAt))
		metrics.mu.Unlock()
	}
}

// heartbeat mirrors the OpenIM SDK WebSocket keepalive. The official SDK
// sends a control-frame ping every 24 seconds (30-second pong/read window).
// Without this, long-running raw WebSocket load clients are disconnected by
// the gateway and sustained tests report false delivery loss.
func (c *loadClient) heartbeat() {
	ticker := time.NewTicker(24 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-c.done:
			return
		case now := <-ticker.C:
			if err := c.conn.WriteControl(
				websocket.PingMessage,
				[]byte(fmt.Sprint(now.UnixMilli())),
				time.Now().Add(10*time.Second),
			); err != nil {
				return
			}
		}
	}
}

func sendGroupText(ctx context.Context, apiURL, adminToken, adminUser, groupID, operationID, text string, notOfflinePush bool) error {
	body, err := json.Marshal(map[string]any{
		"sendID": adminUser, "groupID": groupID,
		"content":     map[string]string{"content": text},
		"contentType": 101, "sessionType": 3,
		"isOnlineOnly": false, "notOfflinePush": notOfflinePush,
	})
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, strings.TrimRight(apiURL, "/")+"/msg/send_msg", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("token", adminToken)
	req.Header.Set("operationID", operationID)
	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 2<<20))
	if err != nil {
		return err
	}
	var envelope apiEnvelope
	if err := json.Unmarshal(raw, &envelope); err != nil {
		return fmt.Errorf("HTTP %d invalid JSON", resp.StatusCode)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 || envelope.ErrCode != 0 {
		return fmt.Errorf("HTTP %d OpenIM code=%d msg=%s detail=%s", resp.StatusCode, envelope.ErrCode, envelope.ErrMsg, envelope.ErrDlt)
	}
	return nil
}

func finishReport(result *report, metrics *metricSet, ack []time.Duration, ended time.Time) {
	metrics.mu.Lock()
	connect := append([]time.Duration(nil), metrics.connectLatencies...)
	delivery := append([]time.Duration(nil), metrics.deliveryLatencies...)
	metrics.mu.Unlock()
	result.ConnectLatency = summarize(connect)
	result.SendAckLatency = summarize(ack)
	result.DeliveryLatency = summarize(delivery)
	result.EndedAt = ended.UTC().Format(time.RFC3339Nano)
	if result.MatchedPushes == 0 {
		result.MatchedPushes = metrics.matched.Load()
	}
	result.DuplicatePushes = metrics.duplicate.Load()
	result.UnrelatedPushes = metrics.unrelated.Load()
	result.UnexpectedDisconnects = metrics.disconnect.Load()
}

func summarize(values []time.Duration) latencySummary {
	if len(values) == 0 {
		return latencySummary{}
	}
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	ms := func(d time.Duration) float64 { return float64(d.Microseconds()) / 1000 }
	return latencySummary{
		Min: ms(values[0]), P50: ms(percentile(values, 0.50)),
		P95: ms(percentile(values, 0.95)), P99: ms(percentile(values, 0.99)),
		Max: ms(values[len(values)-1]),
	}
}

func percentile(values []time.Duration, p float64) time.Duration {
	if len(values) == 0 {
		return 0
	}
	index := int(float64(len(values)-1)*p + 0.5)
	if index >= len(values) {
		index = len(values) - 1
	}
	return values[index]
}

func closeClients(clients []*loadClient) {
	for _, client := range clients {
		_ = client.conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(websocket.CloseNormalClosure, "test complete"), time.Now().Add(time.Second))
		_ = client.conn.Close()
	}
}

func emitReport(result report) {
	raw, _ := json.MarshalIndent(result, "", "  ")
	fmt.Println(string(raw))
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}

func max64(a, b int64) int64 {
	if a > b {
		return a
	}
	return b
}
