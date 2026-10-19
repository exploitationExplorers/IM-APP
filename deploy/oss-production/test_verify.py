import contextlib
import copy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

spec = importlib.util.spec_from_file_location('production_oss_verify', Path(__file__).with_name('verify-production-oss.py'))
verify = importlib.util.module_from_spec(spec)
spec.loader.exec_module(verify)


class VerificationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        private = self.root / 'private'
        private.mkdir()
        self.state_path = private / 'deployment-state.private.json'
        self.original = {name: {'Id': name, 'State': {'StartedAt': 'original'}} for name in verify.DATA_SERVICES}
        self.state = {'phase': 'update_openim_application_only', 'original_containers': self.original,
                      'new_images': {'api': 'api:cutover', 'openim': 'openim:cutover'}}
        self.state_path.write_text(json.dumps(self.state))
        (self.root / 'oss.private.json').write_text('{}')
        self.details = copy.deepcopy(self.original)
        for kind, name in (('api', 'im-app-api'), ('openim', 'openim-api')):
            self.details[name] = {'State': {'Running': True}, 'Config': {'Image': self.state['new_images'][kind]}}
        self.helper = mock.Mock()
        self.helper.read.side_effect = lambda args: json.dumps([self.details[args[1]]]).encode()
        self.helper.check_detail.side_effect = lambda name, detail: detail
        api = {'APP_ENV': 'oss-production', 'MIGRATIONS_MODE': 'verify', 'SEED_DEMO': 'false', 'STORAGE_PROVIDER': 'oss'}
        self.helper.settings.side_effect = lambda info: api if info['Config']['Image'].startswith('api:') else {'IM_APP_ENV': 'oss-production', 'IM_APP_OSS_PREFIX': 'im-app-production/chat/'}
        self.helper.write_private.side_effect = lambda path, value: path.write_bytes(value)
        self.deployment = types.SimpleNamespace(Failed=RuntimeError, check_manifest=mock.Mock(),
            load_helper=mock.Mock(return_value=self.helper), STORES={'chat': ('bucket', 'origin', 'im-app-production/chat/')},
            api_health=mock.Mock(), verify_chat=mock.Mock(), probe_storage=mock.Mock(return_value={'business': 'probe'}),
            verify_business=mock.Mock())

    def run_verification(self):
        with contextlib.redirect_stdout(io.StringIO()):
            verify.verify(self.root, self.deployment)

    def test_success_finishes_state_without_running_deployment_commands(self):
        self.run_verification()
        self.assertEqual(json.loads(self.state_path.read_bytes())['phase'], 'server_upload_checks_passed')
        self.deployment.verify_chat.assert_called_once()
        self.deployment.verify_business.assert_called_once()
        self.assertTrue(all(call.args[0][0] == 'inspect' for call in self.helper.read.call_args_list))

    def test_upload_failure_preserves_previous_state(self):
        before = self.state_path.read_bytes()
        self.deployment.verify_chat.side_effect = RuntimeError('UPLOAD_FAILED')
        with self.assertRaisesRegex(RuntimeError, 'UPLOAD_FAILED'):
            self.run_verification()
        self.assertEqual(self.state_path.read_bytes(), before)
        self.deployment.probe_storage.assert_not_called()

    def test_business_failure_does_not_mark_complete(self):
        before = self.state_path.read_bytes()
        self.deployment.verify_business.side_effect = RuntimeError('MEDIA_FAILED')
        with self.assertRaisesRegex(RuntimeError, 'MEDIA_FAILED'):
            self.run_verification()
        self.assertEqual(self.state_path.read_bytes(), before)

    def test_changed_database_container_stops_before_uploads(self):
        self.details['openim-mongodb']['Id'] = 'replaced'
        with self.assertRaisesRegex(RuntimeError, 'DATA_SERVICE_CHANGED'):
            self.run_verification()
        self.deployment.verify_chat.assert_not_called()

    def test_incomplete_deployment_cannot_be_marked_successful(self):
        self.state['phase'] = 'add_two_file_storage_columns'
        self.state_path.write_text(json.dumps(self.state))
        with self.assertRaisesRegex(RuntimeError, 'NOT_AT_OPENIM'):
            self.run_verification()
        self.deployment.verify_chat.assert_not_called()

    def test_application_image_change_stops_verification(self):
        self.details['openim-api']['Config']['Image'] = 'other:image'
        with self.assertRaisesRegex(RuntimeError, 'APPLICATION_IMAGE'):
            self.run_verification()
        self.deployment.verify_chat.assert_not_called()


if __name__ == '__main__':
    unittest.main()
