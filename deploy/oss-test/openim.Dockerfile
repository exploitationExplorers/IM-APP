# Test image only: never invoke mage start (it would also start crontask).
FROM golang:1.25-alpine AS builder
RUN apk add --no-cache git ca-certificates nodejs
# WSL kernel may hang in PR_SET_VMA/set_anon_vma_name. Disable Go 1.25's
# diagnostic mapping annotations for this local test image, not application GC.
ENV GOPROXY=https://goproxy.cn,direct GODEBUG=decoratemappings=0
COPY openim-scope /scope
WORKDIR /src
RUN go mod download -json github.com/openimsdk/open-im-server/v3@v3.8.3-patch.15 > /tmp/module.json \
    && node -e "require('fs').cpSync(JSON.parse(require('fs').readFileSync('/tmp/module.json')).Dir, '/src/openim', {recursive:true})" \
    && chmod -R u+w /src/openim \
    && node /scope/patch-openim.cjs /src/openim --apply
WORKDIR /src/openim
RUN go mod tidy && go test github.com/openimsdk/tools/s3/oss && mkdir /out && \
    for name in api msggateway msgtransfer push; do \
      CGO_ENABLED=0 go build -trimpath -o /out/openim-$name ./cmd/openim-$name || exit 1; \
    done && \
    for name in auth conversation friend group msg third user; do \
      CGO_ENABLED=0 go build -trimpath -o /out/openim-rpc-$name ./cmd/openim-rpc/openim-rpc-$name || exit 1; \
    done
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY --from=builder /out/ /usr/local/bin/
WORKDIR /app
ENV IM_APP_ENV=oss-test IM_APP_OSS_TEST_PREFIX=oss-test/chat/ IM_APP_OSS_TEST_DELETE_ENABLED=false GODEBUG=decoratemappings=0
# Config is mounted at runtime; credentials never enter the build context/image.
CMD ["openim-api", "-c", "/config"]
