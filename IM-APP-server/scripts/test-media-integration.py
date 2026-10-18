"""Run media repository checks in a new disposable localhost PostgreSQL.

Uses the already installed postgres:16-alpine image. Does not pull images,
restart Docker, read .env, or touch the running application/test containers.
"""
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
import uuid


def main():
    root = Path(__file__).resolve().parents[1]
    name = "im-app-media-integration-" + uuid.uuid4().hex[:12]
    network = name + "-net"
    env = os.environ.copy()
    env["POSTGRES_PASSWORD"] = secrets.token_urlsafe(24)
    docker = ["docker"]
    # Explicit context on Windows prevents accidentally using a remote engine.
    if os.name == "nt":
        docker += ["--context", "desktop-linux"]

    def command(*args, **kwargs):
        return subprocess.run(docker + list(args), check=True, text=True,
                              capture_output=True, timeout=45, **kwargs)

    engine = json.loads(command("context", "inspect").stdout)[0]["Endpoints"]["docker"]["Host"]
    if not engine.startswith(("npipe://", "unix://")) or os.getenv("DOCKER_HOST"):
        raise RuntimeError("a local Docker engine is required; remote DOCKER_HOST is forbidden")

    created_network = started = False
    try:
        command("image", "inspect", "postgres:16-alpine")
        # Docker Desktop suppresses published ports on an --internal network.
        # A dedicated bridge plus loopback-only publishing remains isolated
        # from every application network and is reachable by the host Go test.
        command("network", "create", "--label", "im-app.task=media-integration", network)
        created_network = True
        command("run", "--pull=never", "--rm", "--detach", "--name", name,
                "--label", "im-app.task=media-integration", "--network", network,
                "--publish", "127.0.0.1::5432", "--memory", "256m", "--cpus", "0.5",
                "--pids-limit", "128", "--env", "POSTGRES_USER=media_test",
                "--env", "POSTGRES_DB=imapp_media_integration", "--env", "POSTGRES_PASSWORD",
                "postgres:16-alpine", env=env)
        started = True
        info = json.loads(command("inspect", "--format", "{{json .NetworkSettings.Ports}}", name).stdout)
        port = info["5432/tcp"][0]["HostPort"]
        for _ in range(45):
            ready = subprocess.run(docker + ["exec", name, "pg_isready", "-U", "media_test",
                                           "-d", "imapp_media_integration"],
                                   capture_output=True, timeout=5)
            if ready.returncode == 0:
                break
            time.sleep(0.5)
        else:
            raise RuntimeError("disposable PostgreSQL did not become ready")
        env["IM_APP_MEDIA_TEST_DATABASE_URL"] = (
            f"postgres://media_test:{env['POSTGRES_PASSWORD']}@127.0.0.1:{port}/"
            "imapp_media_integration?sslmode=disable"
        )
        env["IM_APP_MEDIA_TEST_ALLOW_SCHEMA_INIT"] = "1"
        print("MEDIA_INTEGRATION_BEGIN: disposable localhost database; no existing volumes", flush=True)
        result = subprocess.run(["go", "test", "./internal/repository", "-run",
                                 "^Test(Favorite|Forward)MediaPostgresIntegration$", "-count=1", "-v"],
                                cwd=root, env=env, timeout=180)
        return result.returncode
    finally:
        if started:
            command("stop", "--time", "5", name)
        if created_network:
            command("network", "rm", network)
        print("MEDIA_INTEGRATION_CLEANUP: disposable resources removed", flush=True)


if __name__ == "__main__":
    raise SystemExit(main())
