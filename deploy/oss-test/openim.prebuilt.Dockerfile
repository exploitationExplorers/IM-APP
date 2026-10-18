# Local WSL fallback only; build-openim-host.cjs pins/patches/tests source and
# verifies ELF platform + hashes before allowing this packaging step.
FROM alpine:3.20
RUN apk add --no-cache ca-certificates tzdata
COPY artifacts/openim-linux/openim-* /usr/local/bin/
WORKDIR /app
ENV IM_APP_ENV=oss-test IM_APP_OSS_TEST_PREFIX=oss-test/chat/ IM_APP_OSS_TEST_DELETE_ENABLED=false GODEBUG=decoratemappings=0
LABEL im.app.environment=oss-test im.app.build=windows-cross-linux
CMD ["openim-api", "-c", "/config"]
