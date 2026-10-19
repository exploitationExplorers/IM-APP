#!/usr/bin/env python3
"""Finish upload checks after the deployed OpenIM instance becomes ready."""
import importlib.util
import json
import os
from pathlib import Path
import platform
import socket
import sys
import uuid

ROOT = Path('/root/im-app-oss-production/oss-production-bundle')
DATA_SERVICES = ('im-app-postgres', 'openim-mongodb', 'im-app-minio', 'openim-minio')


def load_deployment(root):
    spec = importlib.util.spec_from_file_location('oss_deployment', root / 'deploy-production-oss.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def check_data_services(d, b, original):
    for name in DATA_SERVICES:
        current = b.check_detail(name, json.loads(b.read(['inspect', name]))[0])
        before = original[name]
        if current['Id'] != before['Id'] or current['State'].get('StartedAt') != before['State'].get('StartedAt'):
            raise d.Failed('DATA_SERVICE_CHANGED_DURING_DEPLOY')


def verify(root, d):
    d.check_manifest(root)
    b = d.load_helper(root)
    private = root / 'private'
    b.private_directory(private)
    state_path = private / 'deployment-state.private.json'
    previous = state_path.read_bytes()
    state = json.loads(previous)
    if state.get('phase') not in ('update_openim_application_only', 'server_upload_checks_passed'):
        raise d.Failed('DEPLOYMENT_NOT_AT_OPENIM_VERIFICATION_PHASE')
    check_data_services(d, b, state['original_containers'])
    api_env = None
    for kind, name in (('api', 'im-app-api'), ('openim', 'openim-api')):
        info = json.loads(b.read(['inspect', name]))[0]
        runtime = info['State']
        if not runtime.get('Running') or runtime.get('Restarting') or runtime.get('Paused') or info['Config'].get('Image') != state['new_images'][kind]:
            raise d.Failed('DEPLOYED_APPLICATION_IMAGE_OR_STATE_CHANGED')
        env = b.settings(info)
        if kind == 'api':
            api_env = env
            if any(env.get(key) != value for key, value in {'APP_ENV': 'oss-production', 'MIGRATIONS_MODE': 'verify', 'SEED_DEMO': 'false', 'STORAGE_PROVIDER': 'oss'}.items()):
                raise d.Failed('DEPLOYED_API_SETTINGS_CHANGED')
        elif env.get('IM_APP_ENV') != 'oss-production' or env.get('IM_APP_OSS_PREFIX') != d.STORES['chat'][2]:
            raise d.Failed('DEPLOYED_OPENIM_SETTINGS_CHANGED')
    d.api_health()
    print('step=verify_openim_signed_upload_complete_and_read', flush=True)
    d.verify_chat(api_env)
    print('chat=signed_upload_complete_and_read_passed', flush=True)
    secrets = json.loads((root / 'oss.private.json').read_bytes())
    print('step=verify_business_public_media', flush=True)
    probes = d.probe_storage(secrets)
    d.verify_business(secrets, probes['business'])
    check_data_services(d, b, state['original_containers'])
    if state_path.read_bytes() != previous:
        raise d.Failed('DEPLOYMENT_STATE_CHANGED_DURING_VERIFICATION')
    state['phase'] = 'server_upload_checks_passed'
    temporary = private / ('verification-' + uuid.uuid4().hex + '.private.tmp')
    b.write_private(temporary, (json.dumps(state, indent=2) + '\n').encode())
    os.replace(temporary, state_path)
    print('IM_APP_PRODUCTION_OSS_DEPLOY_OK', flush=True)
    print('business=public_media_read_passed; chat=signed_upload_complete_and_read_passed', flush=True)
    print('service_restarts=none; database_restores=none; frontend_native_acceptance=pending', flush=True)


def main():
    if sys.argv[1:] or platform.system() != 'Linux' or socket.gethostname().lower() != 'izbp15qkzomsmdhdmtx27dz' or os.geteuid() != 0:
        raise RuntimeError('BACKEND_ONLY')
    os.umask(0o077)
    d = load_deployment(ROOT)
    try:
        print('IM_APP_PRODUCTION_OSS_VERIFY_BEGIN', flush=True)
        verify(ROOT, d)
    except d.Failed as error:
        print('IM_APP_PRODUCTION_OSS_VERIFY_FAILED: ' + str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except Exception:
        print('IM_APP_PRODUCTION_OSS_VERIFY_FAILED: VERIFICATION_CHECK_FAILED; keep private state', file=sys.stderr)
        sys.exit(1)
