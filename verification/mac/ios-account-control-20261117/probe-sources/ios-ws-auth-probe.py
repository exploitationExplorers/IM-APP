import base64
import datetime
import http.client
import json
import os
import sys
import termios
import urllib.parse
import urllib.request
import uuid

original = termios.tcgetattr(sys.stdin) if sys.stdin.isatty() else None
if original:
    hidden = termios.tcgetattr(sys.stdin)
    hidden[3] &= ~termios.ECHO
    termios.tcsetattr(sys.stdin, termios.TCSANOW, hidden)
print('Ready for authorized failing account; only status is printed.', flush=True)
try:
    credentials = json.loads(sys.stdin.readline())
finally:
    if original:
        termios.tcsetattr(sys.stdin, termios.TCSANOW, original)

def post(path, body, token=None):
    headers = {'Content-Type': 'application/json', 'Accept': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    request = urllib.request.Request('https://www.xn--jprz53bj9s.com' + path,
        data=json.dumps(body).encode(), headers=headers)
    with urllib.request.urlopen(request, timeout=20) as response:
        return json.load(response)

result = {'case': 'failing_case', 'platform': 1, 'sdk_invoked': False}
try:
    login = post('/api/v1/auth/login', dict(credentials, countryCode='+86', deviceId='ios-ws-probe-' + str(uuid.uuid4())))
    credentials.clear()
    result['business_code'] = login.get('code')
    if login.get('code') == 0:
        issued = post('/api/v1/im/token', {'platformId': 1}, login['data']['accessToken'])
        result['im_business_code'] = issued.get('code')
        if issued.get('code') == 0:
            ticket = issued['data']
            # Mirror fixed Core reConn query names; never print the URL or headers.
            query = urllib.parse.urlencode({'sendID': ticket['userId'], 'token': ticket['token'],
                'platformID': 1, 'operationID': str(uuid.uuid4()), 'isBackground': 'false'})
            connection = http.client.HTTPSConnection('www.xn--jprz53bj9s.com', timeout=20)
            try:
                connection.request('GET', '/openim-ws?' + query, headers={
                    'Connection': 'Upgrade', 'Upgrade': 'websocket', 'Sec-WebSocket-Version': '13',
                    'Sec-WebSocket-Key': base64.b64encode(os.urandom(16)).decode()})
                response = connection.getresponse()
                result['websocket_http'] = response.status
                if response.status != 101:
                    body = json.loads(response.read(32768))
                    result['websocket_code'] = body.get('errCode')
                else:
                    result['websocket_upgrade_accepted'] = True
            finally:
                connection.close()
            ticket.clear()
        issued.clear()
    login.clear()
except Exception as error:
    result['error_type'] = type(error).__name__
finally:
    credentials.clear()
result['checked_at_utc'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
print(json.dumps(result), flush=True)
