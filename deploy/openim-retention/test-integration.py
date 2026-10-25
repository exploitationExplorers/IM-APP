"""Compile the pinned extension against disposable local MongoDB AND Redis.

Does not pull images, read .env, modify the original source checkout, connect to
application networks or restart existing containers. Every generated path is
under one fresh TemporaryDirectory. A local Docker engine is mandatory.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', help='optional fresh pinned source; default Go module cache (copied, never patched in place)')
    parser.add_argument('--build-linux', action='store_true', help='also cross-compile msg RPC and msgtransfer; never publish')
    args = parser.parse_args()
    go = os.getenv('GO_EXECUTABLE') or ('D:/Program Files/Go/bin/go.exe' if os.name == 'nt' and Path('D:/Program Files/Go/bin/go.exe').is_file() else 'go')
    if args.source:
        source = Path(args.source).resolve(strict=True)
    else:
        module = json.loads(subprocess.check_output([go, 'mod', 'download', '-json', 'github.com/openimsdk/open-im-server/v3@v3.8.3-patch.15'], text=True))
        source = Path(module['Dir']).resolve(strict=True)
    here = Path(__file__).resolve().parent
    name = 'imapp-retention-' + uuid.uuid4().hex[:12]
    docker = ['docker'] + (['--context', 'desktop-linux'] if os.name == 'nt' else [])
    def command(*args):
        return subprocess.run(docker + list(args), check=True, capture_output=True, text=True, timeout=60)
    engine = json.loads(command('context', 'inspect').stdout)[0]['Endpoints']['docker']['Host']
    if not engine.startswith(('npipe://', 'unix://')) or os.getenv('DOCKER_HOST'):
        raise RuntimeError('Only a local Docker engine is permitted')
    command('image', 'inspect', 'mongo:6.0')
    command('image', 'inspect', 'redis:7-alpine')
    started = redis_started = network = False
    redis_name = name + '-redis'
    try:
        command('network', 'create', '--label', 'im-app.task=retention-integration', name)
        network = True
        command('run', '--pull=never', '--rm', '--detach', '--name', name, '--network', name,
                '--label', 'im-app.task=retention-integration', '--publish', '127.0.0.1::27017',
                '--memory', '384m', '--cpus', '0.5', '--pids-limit', '128', 'mongo:6.0', '--quiet')
        started = True
        command('run', '--pull=never', '--rm', '--detach', '--name', redis_name, '--network', name,
                '--label', 'im-app.task=retention-integration', '--publish', '127.0.0.1::6379',
                '--memory', '96m', '--cpus', '0.25', '--pids-limit', '64', 'redis:7-alpine',
                'redis-server', '--save', '', '--appendonly', 'no')
        redis_started = True
        port = json.loads(command('inspect', '--format', '{{json .NetworkSettings.Ports}}', name).stdout)['27017/tcp'][0]['HostPort']
        redis_port = json.loads(command('inspect', '--format', '{{json .NetworkSettings.Ports}}', redis_name).stdout)['6379/tcp'][0]['HostPort']
        for _ in range(40):
            result = subprocess.run(docker+['exec', name, 'mongosh', '--quiet', '--eval', 'db.runCommand({ping:1}).ok'], capture_output=True, timeout=6)
            if result.returncode == 0:
                break
            time.sleep(.5)
        else:
            raise RuntimeError('Disposable MongoDB did not become ready')
        if command('exec', redis_name, 'redis-cli', 'ping').stdout.strip() != 'PONG':
            raise RuntimeError('Disposable Redis did not become ready')
        with tempfile.TemporaryDirectory(prefix='imapp-retention-source-') as temp:
            copy = Path(temp) / 'openim'
            shutil.copytree(source, copy, ignore=shutil.ignore_patterns('.git', '_output', 'production-tools', 'test-tools'))
            for directory, _, files in os.walk(copy):
                os.chmod(directory, 0o755)
                for file in files:
                    os.chmod(Path(directory) / file, 0o644)
            subprocess.run(['node', str(here / 'patch-openim.cjs'), str(copy)], check=True, timeout=60)
            subprocess.run(['node', str(here / 'patch-object-gc.cjs'), str(copy)], check=True, timeout=90)
            env = os.environ.copy()
            env['IM_APP_RETENTION_TEST_MONGO'] = f'mongodb://127.0.0.1:{port}/imapp_retention_integration'
            env['IM_APP_RETENTION_TEST_REDIS'] = f'redis://127.0.0.1:{redis_port}/0'
            env['IM_APP_RETENTION_TEST_ALLOW_INIT'] = '1'
            print('RETENTION_INTEGRATION_BEGIN: pinned source + empty loopback MongoDB/Redis', flush=True)
            subprocess.run([go,'test','./s3/oss','-run','^TestIMAppRetentionGCOssProbe$','-count=1','-v'],cwd=copy/'production-tools',env=env,check=True,timeout=120)
            result = subprocess.run([go, 'test', './internal/imappgc', './internal/rpc/third', './internal/imappretention', './internal/rpc/msg', './pkg/common/storage/controller', './pkg/common/storage/database/mgo',
                                     '-run', 'Test(IMAppRetention|Retention|PlanGroupRetention)', '-count=1', '-v'], cwd=copy, env=env, timeout=300)
            if result.returncode == 0:
                # Exercise the ACTUAL transfer controller's Create/duplicate
                # retry and atomic Mongo fence repeatedly under concurrent
                # purge/replay. No Kafka ingress or full-service claim implied.
                result = subprocess.run([go, 'test', './pkg/common/storage/controller',
                                         '-run', '^TestIMAppRetentionTransferFenceIntegration$', '-count=5'], cwd=copy, env=env, timeout=180)
                if result.returncode == 0:
                    print('RETENTION_TRANSFER_FENCE_REPEAT_OK: five independent concurrent replay runs', flush=True)
            if result.returncode == 0 and args.build_linux:
                env.update({'GOOS': 'linux', 'GOARCH': 'amd64', 'CGO_ENABLED': '0'})
                for binary, package in [('openim-rpc-msg', './cmd/openim-rpc/openim-rpc-msg'), ('openim-msgtransfer', './cmd/openim-msgtransfer'), ('openim-rpc-third', './cmd/openim-rpc/openim-rpc-third'), ('openim-rpc-user', './cmd/openim-rpc/openim-rpc-user'), ('openim-rpc-group', './cmd/openim-rpc/openim-rpc-group')]:
                    subprocess.run([go, 'build', '-trimpath', '-o', str(Path(temp) / binary), package], cwd=copy, env=env, check=True, timeout=300)
                print('RETENTION_LINUX_BUILD_OK: msg/msgtransfer/third/user/group; temporary binaries only; no deployment or image changes', flush=True)
            return result.returncode
    finally:
        if redis_started:
            command('stop', '--time', '5', redis_name)
        if started:
            command('stop', '--time', '5', name)
        if network:
            command('network', 'rm', name)
        print('RETENTION_INTEGRATION_CLEANUP: only disposable resources removed', flush=True)


if __name__ == '__main__':
    raise SystemExit(main())
