# syntax=docker/dockerfile:1

FROM golang:1.25-alpine AS builder
WORKDIR /src
RUN apk add --no-cache git ca-certificates
# 国内加速：Go 模块走 goproxy.cn，避免 proxy.golang.org 超时
ENV GOPROXY=https://goproxy.cn,direct
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /out/im-server ./cmd/server

FROM alpine:3.20
WORKDIR /app
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /out/im-server /app/im-server
COPY migrations /app/migrations
ENV HTTP_ADDR=:8080
EXPOSE 8080
CMD ["/app/im-server"]
