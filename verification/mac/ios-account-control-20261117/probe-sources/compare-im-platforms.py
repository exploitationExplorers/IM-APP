import base64
import json
import sys
import termios
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args):
        return None


def request(url, body=None, access=None, im_token=None):
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json', 'operationID': str(uuid.uuid4())}
    if access:
        headers['Authorization'] = 'Bearer ' + access
    if im_token:
        headers['token'] = im_token
    req = urllib.request.Request(url, data=None if body is None else json.dumps(body).encode(), headers=headers)
    try:
        with urllib.request.build_opener(NoRedirect()).open(req, timeout=40) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        try:
            payload = json.load(error)
        except Exception:
            payload = {}
        return error.code, payload


def secure_endpoint(address, ws=False):
    parts = urllib.parse.urlsplit(address)
    if parts.scheme == ('wss' if ws else 'https'):
        return address
    if parts.hostname == '8.154.44.197' and parts.port in (None, 80) and parts.path.rstrip('/') == ('/openim-ws' if ws else '/openim-api'):
        return ('wss' if ws else 'https') + '://www.xn--jprz53bj9s.com' + parts.path.rstrip('/')
    raise ValueError('unsupported endpoint')


original = termios.tcgetattr(sys.stdin) if sys.stdin.isatty() else None
if original:
    hidden = termios.tcgetattr(sys.stdin)
    hidden[3] &= ~termios.ECHO
    termios.tcsetattr(sys.stdin, termios.TCSANOW, hidden)
print('Ready for authorized credentials; output contains status only.', flush=True)
try:
    credentials = json.loads(sys.stdin.readline())
finally:
    if original:
        termios.tcsetattr(sys.stdin, termios.TCSANOW, original)

result = {}
try:
    origin = 'https://www.xn--jprz53bj9s.com'
    status, login = request(origin + '/api/v1/auth/login', {'countryCode': '+86', 'phone': credentials['phone'], 'password': credentials['password'], 'deviceId': 'ios-parity-' + str(uuid.uuid4())})
    credentials.clear()
    result.update(login_http=status, login_code=login.get('code'))
    if status == 200 and login.get('code') == 0:
        account = login['data']
        access = account['accessToken']
        platforms = []
        result['platforms'] = platforms
        for platform in [1, 2]:
            result['stage'] = 'im_token_' + str(platform)
            status, response = request(origin + '/api/v1/im/token', {'platformId': platform}, access)
            item = {'platform_requested': platform, 'im_http': status, 'im_business_code': response.get('code')}
            platforms.append(item)
            if status != 200 or response.get('code') != 0:
                continue
            im = response['data']
            api = secure_endpoint(im['apiAddr'])
            ws = secure_endpoint(im['wsAddr'], ws=True)
            item.update(platform_matches=im.get('platform') == platform,
                        identity_matches=im.get('userId') == account['user']['id'].replace('-', ''),
                        api=api, ws=ws, expire_sec=im.get('expireSec'))
            parts = im['token'].split('.')
            if len(parts) == 3:
                claims = json.loads(base64.urlsafe_b64decode(parts[1] + '=' * (-len(parts[1]) % 4)))
                item['jwt_expiry_remaining_sec'] = int(claims.get('exp', 0) - time.time())
                item['jwt_claim_keys'] = sorted(claims.keys())
            result['stage'] = 'parse_' + str(platform)
            status, parsed = request(api.rstrip('/') + '/auth/parse_token', {'token': im['token']})
            item.update(parse_http=status, parse_code=parsed.get('errCode'))
            if parsed.get('errCode') == 0:
                data = parsed.get('data') or {}
                item.update(parse_identity_matches=data.get('userID') == im['userId'], parse_platform_matches=data.get('platformID') == platform)
            # Same authenticated, read-only endpoint used by the native Android gateway.
            result['stage'] = 'conversations_' + str(platform)
            status, conversations = request(api.rstrip('/') + '/conversation/get_all_conversations', {'ownerUserID': im['userId']}, im_token=im['token'])
            item.update(conversations_http=status, conversations_code=conversations.get('errCode'))
            if conversations.get('errCode') == 0:
                data = conversations.get('data') or {}
                item['conversation_result_fields'] = sorted(data.keys()) if isinstance(data, dict) else []
                if isinstance(data, dict):
                    values = data.get('conversations') or data.get('conversationList') or []
                    item['conversation_count'] = len(values) if isinstance(values, list) else None
            im.clear()
        account.clear()
        access = None
    login.clear()
except Exception as error:
    result['error_type'] = type(error).__name__
    if isinstance(error, urllib.error.URLError):
        result['transport_reason_type'] = type(error.reason).__name__
finally:
    credentials.clear()
print(json.dumps(result, ensure_ascii=False), flush=True)
