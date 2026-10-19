"""Control/deploy orchestration tests. No real Docker, HTTP, credentials or DDL."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location('cleanup_production',Path(__file__).with_name('cleanup-production.py'))
c=importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)


class CleanupTests(unittest.TestCase):
    def test_no_activation_before_all_steps_and_writer_verification(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            (root/'private').mkdir()
            counts={n:8 if n=='openim-msgtransfer' else 1 for n in c.p.BINARIES}
            (root/'private/prepared.json').write_text(json.dumps({'sourceCommit':'a'*40,'openim_process_counts':counts}))
            events=[]
            def shell(_,action):events.append(action)
            def verify(_):events.append('verify_live_writers')
            def request(path,body=None):events.append((path,body));return {}
            with patch.object(c.p,'verify_manifest',return_value={'sourceCommit':'a'*40}),patch.object(c.p,'detail',return_value={'Config':{'Env':['IM_APP_MEDIA_GC_REFERENCES=true']}}),patch.object(c.p,'process_counts',return_value=counts),patch.object(c,'apply_migrations',side_effect=lambda _:events.append('ddl')),patch.object(c,'shell',side_effect=shell),patch.object(c,'quiet_verify',side_effect=verify),patch.object(c,'request',side_effect=request),patch.object(c,'status'),contextlib.redirect_stdout(io.StringIO()):
                c.deploy(root)
                self.assertEqual(events,[('configure',{'active':False}),'ddl','build','up-openim','up-api','verify_live_writers',('configure',{'active':True})])
                events.clear()
                with patch.object(c,'quiet_verify',side_effect=c.p.Refused('STALE_OR_MISSING_RUNNING_WRITER')):
                    with self.assertRaisesRegex(c.p.Refused,'STALE'):
                        c.deploy(root)
                self.assertNotIn(('configure',{'active':True}),events)

    def test_private_listener_must_not_be_published(self):
        chat={'HostConfig':{'PortBindings':{'19094/tcp':[{'HostPort':'19094'}]}}}
        with patch.object(c.p,'detail',return_value=chat),patch.object(c.urllib.request,'build_opener') as opener:
            with self.assertRaisesRegex(c.p.Refused,'PORT_IS_PUBLISHED'):
                c.request('run',{'dryRun':False})
            opener.assert_not_called()

    def test_additive_migrations_only_and_stops_on_first_failure(self):
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp);(root/'migrations').mkdir()
            for name in ('052_media_preservation.sql','053_forward_media_preservation.sql','054_group_retention_plans.sql','055_group_retention_visibility.sql'):
                (root/'migrations'/name).write_text('-- '+name)
            calls=[]
            def run(args,**kwargs):
                self.assertEqual(args[2:5],['exec','-i','im-app-postgres'])
                self.assertIn(b"lock_timeout='2s'",kwargs['input'])
                self.assertTrue(kwargs['input'].endswith(b'COMMIT;\n'))
                calls.append(kwargs['input'])
                return type('Result',(),{'returncode':1 if len(calls)==2 else 0})()
            with patch.object(c.subprocess,'run',side_effect=run):
                with self.assertRaisesRegex(c.p.Refused,'DDL_FAILED_053'):
                    c.apply_migrations(root)
                self.assertEqual(len(calls),2)

    def test_probe_error_is_redacted_and_not_a_success(self):
        chat={'HostConfig':{},'NetworkSettings':{'Networks':{c.p.SHARED:{'IPAddress':'172.20.0.3'}}},'Config':{'Env':['IM_APP_RETENTION_KEY='+'a'*64]}}
        api={'Config':{'Env':['GROUP_RETENTION_ADAPTER_KEY='+'a'*64]}}
        with patch.object(c.p,'detail',side_effect=[chat,api]),patch.object(c.urllib.request,'build_opener') as opener:
            opener.return_value.open.side_effect=OSError('private password not for output')
            with self.assertRaisesRegex(c.p.Refused,'OSS_PERMISSION_CHECK_FAILED') as err:
                c.request('configure',{'active':True})
            self.assertNotIn('password',str(err.exception))


if __name__=='__main__':
    unittest.main()
