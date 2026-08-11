package ws

import (
	"encoding/json"
	"net/http"
	"sync"

	"im-app-server/internal/middleware"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

type Envelope struct {
	Event string      `json:"event"`
	Data  interface{} `json:"data"`
}

type client struct {
	userID string
	conn   *websocket.Conn
	send   chan []byte
}

type Hub struct {
	mu      sync.RWMutex
	clients map[string]map[*client]struct{}
	secret  string
}

func NewHub(secret string) *Hub {
	return &Hub{
		clients: make(map[string]map[*client]struct{}),
		secret:  secret,
	}
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool { return true },
}

func (h *Hub) HandleWS(c *gin.Context) {
	token := c.Query("token")
	if token == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "missing token"})
		return
	}
	claims, err := middleware.ParseToken(h.secret, token)
	if err != nil {
		c.JSON(http.StatusUnauthorized, gin.H{"message": "invalid token"})
		return
	}

	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}
	cl := &client{
		userID: claims.UserID,
		conn:   conn,
		send:   make(chan []byte, 32),
	}
	h.add(cl)

	go cl.writePump()
	cl.readPump(h)
}

func (h *Hub) add(cl *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if h.clients[cl.userID] == nil {
		h.clients[cl.userID] = make(map[*client]struct{})
	}
	h.clients[cl.userID][cl] = struct{}{}
}

func (h *Hub) remove(cl *client) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if set, ok := h.clients[cl.userID]; ok {
		delete(set, cl)
		if len(set) == 0 {
			delete(h.clients, cl.userID)
		}
	}
	close(cl.send)
	_ = cl.conn.Close()
}

func (h *Hub) SendToUser(userID string, env Envelope) {
	b, err := json.Marshal(env)
	if err != nil {
		return
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for cl := range h.clients[userID] {
		select {
		case cl.send <- b:
		default:
		}
	}
}

// BroadcastToConversation 向会话成员定向推送
func (h *Hub) BroadcastToConversation(_ string, memberUserIDs []string, env Envelope) {
	b, err := json.Marshal(env)
	if err != nil {
		return
	}
	target := make(map[string]struct{}, len(memberUserIDs))
	for _, id := range memberUserIDs {
		target[id] = struct{}{}
	}
	h.mu.RLock()
	defer h.mu.RUnlock()
	for userID, set := range h.clients {
		if _, ok := target[userID]; !ok {
			continue
		}
		for cl := range set {
			select {
			case cl.send <- b:
			default:
			}
		}
	}
}

func (cl *client) readPump(h *Hub) {
	defer h.remove(cl)
	for {
		_, data, err := cl.conn.ReadMessage()
		if err != nil {
			return
		}
		var env Envelope
		if err := json.Unmarshal(data, &env); err != nil {
			continue
		}
		if env.Event == "ping" {
			pong, _ := json.Marshal(Envelope{Event: "pong", Data: env.Data})
			select {
			case cl.send <- pong:
			default:
			}
		}
	}
}

func (cl *client) writePump() {
	for msg := range cl.send {
		if err := cl.conn.WriteMessage(websocket.TextMessage, msg); err != nil {
			return
		}
	}
}
