"""专用无账号模拟器：同签名旧包种数据，覆盖新版后验证本地会话/SDK库/旧图。"""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess

ROOT=Path(__file__).resolve().parents[2]
ADB=['D:/Android/SDK/platform-tools/adb.exe','-P','5038','-s','127.0.0.1:5581']
PACKAGE='com.im.nativebootstrap.staging'

def call(*parts):
    return subprocess.check_output(ADB+list(parts),timeout=180).decode('utf-8',errors='replace')

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',default='.native-cache/verification/offline-history-20261114')
    parser.add_argument('--old-apk',default='.native-cache/deliverables/IM-Android-0.3.4-media.apk')
    parser.add_argument('--old-version',default='0.3.4-media')
    parser.add_argument('--version',default='0.3.5-offline')
    args=parser.parse_args()
    out=(ROOT/args.output).resolve()
    assert ROOT in out.parents
    out.mkdir(parents=True,exist_ok=True)
    old=(ROOT/args.old_apk).resolve()
    assert ROOT in old.parents
    new=ROOT/'IM-APP-android/app/build/outputs/apk/debug/app-debug.apk'
    tests=ROOT/'IM-APP-android/app/build/outputs/apk/androidTest/debug/app-debug-androidTest.apk'
    report={'status':'failed','scope':'Dedicated synthetic accounts, loopback SDK endpoints, actual SDK/Keystore and local image bytes; no production account',
            'old_sha256':hashlib.sha256(old.read_bytes()).hexdigest(),'new_sha256':hashlib.sha256(new.read_bytes()).hexdigest(),
            'real_account_history':'not_run','ios_runtime':'not_run'}
    airplane=call('shell','settings','get','global','airplane_mode_on').strip()
    def run(label,runner,marker,*extra):
        output=call('shell','am','instrument','-w',*extra,PACKAGE+'.test/'+runner)
        (out/(label+'.txt')).write_text(output,encoding='utf-8')
        assert marker in output and 'INSTRUMENTATION_CODE: -1' in output,output
        report[label]=output.strip().splitlines()
        print(label+' passed',flush=True)
    try:
        call('shell','cmd','connectivity','airplane-mode','enable')
        assert call('shell','settings','get','global','airplane_mode_on').strip()=='1'
        report['airplane_mode_during_test']=True
        # -d 只用于该专用 Debug 模拟器建立旧版本基线，随后 install -r 正向升级；无 pm clear。
        call('shell','am','force-stop',PACKAGE)
        assert 'Success' in call('install','-r','-d',str(old))
        assert 'Success' in call('install','-r',str(tests))
        old_info=call('shell','dumpsys','package',PACKAGE)
        assert 'versionName='+args.old_version in old_info
        run('old-seed','com.im.nativebootstrap.BootstrapOfflineInstrumentation','offlineBootstrap=seeded:','-e','phase','seed')
        run('old-sdk','com.im.nativebootstrap.SDKSmokeInstrumentation','offlineStore=passed:')
        call('shell','am','force-stop',PACKAGE)
        assert 'Success' in call('install','-r',str(new))
        info=call('shell','dumpsys','package',PACKAGE)
        assert 'versionName='+args.version in info
        remote=next(row[8:] for row in call('shell','pm','path',PACKAGE).splitlines() if row.endswith('/base.apk'))
        report['installed_sha256']=call('shell','sha256sum',remote).split()[0].lower()
        assert report['installed_sha256']==report['new_sha256']
        run('upgraded-sdk','com.im.nativebootstrap.SDKSmokeInstrumentation','offlineStore=passed:','-e','offlineRestart','true')
        call('shell','am','force-stop',PACKAGE)
        run('upgraded-bootstrap','com.im.nativebootstrap.BootstrapOfflineInstrumentation','offlineBootstrap=passed:')
        call('shell','am','force-stop',PACKAGE)
        run('upgraded-image','com.im.nativebootstrap.media.OfflineHistoryImageInstrumentation','offlineHistoryImage=passed:','-e','restart','true')
        data=subprocess.check_output(ADB+['exec-out','run-as',PACKAGE,'cat','cache/offline-history-ui-restarted.png'],timeout=30)
        assert data.startswith(b'\x89PNG\r\n\x1a\n')
        (out/'upgraded-offline-image.png').write_bytes(data)
        report['status']='passed'
    except Exception as error:
        report['error']=str(error)
    finally:
        if airplane=='0':call('shell','cmd','connectivity','airplane-mode','disable')
    (out/'offline-upgrade.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'status':report['status'],'error':report.get('error'),'output':str(out)},ensure_ascii=False))
    return report['status']!='passed'

if __name__=='__main__':
    raise SystemExit(main())
