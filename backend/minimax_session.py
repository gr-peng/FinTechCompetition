"""RAM-only independent TTS credential lifecycle; no provider IO."""
import secrets
import json
import threading
import re
MODEL='speech-2.8-turbo'
VOICE='Chinese (Mandarin)_Warm_Bestie'
VOICES=frozenset({VOICE,'Chinese (Mandarin)_Warm_Girl','Chinese (Mandarin)_Sweet_Lady','Chinese (Mandarin)_Mature_Woman'})
LIMIT=2000

def status(sess):
    return {'configured':bool(sess.get('minimax_key')),'generation':sess.get('minimax_generation'),'provider':'minimax','model':MODEL,'voice':sess.get('minimax_voice',VOICE),'estimated_characters':sess.get('minimax_characters',0),'character_limit':LIMIT,'verified':bool(sess.get('minimax_verified',False))}

def configure(sess,data):
    if set(data)=={'voice_id'}:
        if not sess.get('minimax_key') or data['voice_id'] not in VOICES: raise ValueError('Invalid voice selection')
        if sess.get('minimax_cancel'):sess['minimax_cancel'].set()
        sess['minimax_voice']=data['voice_id']
        sess['minimax_generation']=secrets.token_urlsafe(16)
        return status(sess)
    if data=={'disconnect':True}:
        if sess.get('minimax_cancel'): sess['minimax_cancel'].set()
        sess.pop('minimax_key',None)
        sess['minimax_verified']=False
        sess['minimax_generation']=secrets.token_urlsafe(16)
        return status(sess)
    if set(data)!={'key','consent'} or data.get('consent') is not True:
        raise ValueError('请确认仅向MiniMax发送待播报文本的使用范围。')
    key=data.get('key')
    if not isinstance(key,str) or not 16<=len(key)<=4096 or any(c.isspace() for c in key):
        raise ValueError('请输入有效的MiniMax Key。')
    if sess.get('minimax_cancel'): sess['minimax_cancel'].set()
    sess['minimax_key']=key
    sess['minimax_verified']=False
    sess['minimax_generation']=secrets.token_urlsafe(16)
    return status(sess)


def stream(handler,sess,lock,data=None):
    if data is None:data=handler.payload(8192)
    if set(data)-{'request_id','speak','voice_id'} or not {'request_id','speak'}<=set(data) or data.get('voice_id',VOICE) not in VOICES or not isinstance(data['speak'],str) or not 1<=len(data['speak'])<=600 or not isinstance(data['request_id'],str) or not re.fullmatch(r'[A-Za-z0-9_-]{1,80}',data['request_id']):
        return handler.reply({'message':'语音内容或请求编号无效。'},400)
    try:
        from backend.minimax_voice import MinimaxVoiceClient,MinimaxVoiceError
    except ImportError:
        return handler.reply({'message':'语音模块尚未就绪，请稍后再试。'},503)
    with lock:
        if not sess.get('minimax_key'): return handler.reply({'message':'请先连接MiniMax语音。'},412)
        if sess.get('minimax_busy'): return handler.reply({'message':'上一句仍在播放，请先停止。'},409)
        if data['request_id'] in sess.get('minimax_requests',[]): return handler.reply({'message':'这句已提交，请勿重复。'},409)
        estimate=len(data['speak'])*2
        if sess.get('minimax_characters',0)+estimate>LIMIT:return handler.reply({'message':'已达到本地会话语音上限。'},429)
        sess['minimax_characters']=sess.get('minimax_characters',0)+estimate
        sess.setdefault('minimax_requests',[]).append(data['request_id'])
        sess['minimax_busy']=True
        sess['minimax_active_request']=data['request_id']
        cancel=threading.Event();sess['minimax_cancel']=cancel
        generation=sess['minimax_generation'];key=sess['minimax_key']
    started=False;events=None
    try:
        events=MinimaxVoiceClient().stream({'speak':data['speak']},api_key=key,request_id=data['request_id'],cancel_event=cancel,voice_id=data.get('voice_id',sess.get('minimax_voice',VOICE)))
        handler.send_response(200);handler.send_header('Content-Type','application/x-ndjson');handler.send_header('Connection','close');handler.end_headers();handler.close_connection=True;started=True
        for event in events:
            try: current=handler.session()
            except ValueError:cancel.set();break
            if current is not sess or cancel.is_set() or sess.get('minimax_generation')!=generation:cancel.set();break
            handler.wfile.write((json.dumps(event,ensure_ascii=False)+'\n').encode());handler.wfile.flush()
            if event.get('type')=='end':sess['minimax_verified']=True
    except (BrokenPipeError,ConnectionResetError,ConnectionAbortedError):cancel.set()
    except Exception:
        if started:
            try:
                handler.wfile.write((json.dumps({'type':'error','request_id':data['request_id'],'code':'voice_unavailable','message':'语音暂不可用，请检查连接后重试。'})+'\n').encode());handler.wfile.flush()
            except OSError:pass
        else:handler.reply({'message':'语音暂不可用，请稍后重试。'},502)
    finally:
        cancel.set();key=None
        if events is not None and hasattr(events,'close'):
            try:events.close()
            except Exception:pass
        with lock:
            sess['minimax_busy']=False
            sess.pop('minimax_active_request',None)
            if sess.get('minimax_cancel') is cancel:sess.pop('minimax_cancel',None)


def cancel_request(sess,data):
    if set(data)!={'request_id'} or not isinstance(data['request_id'],str):raise ValueError('Invalid cancel request')
    cancelled=False
    if data['request_id']==sess.get('minimax_active_request') and sess.get('minimax_cancel'):
        sess['minimax_cancel'].set();cancelled=True
    return {'cancelled':cancelled}


def install_existing_service(module):
    """Fixed normal provider-reload hook; preserve the existing session objects."""
    from pathlib import Path
    if module is None:return False
    host=vars(module);root=Path(__file__).resolve().parents[1]
    if Path(host.get('__file__','')).resolve()!=root/'server.py' or host.get('ROOT')!=root:return False
    cls=host.get('Handler')
    if cls is None or getattr(cls,'server_version',None)!='FinPilotLocal' or getattr(cls,'_minimax_routes',False):return False
    old_get,old_post=cls.do_GET,cls.do_POST
    def current_get(self):
        if self.path!='/api/voice/config':return old_get(self)
        try:return self.reply({**status(self.session()),'enabled':host['ALLOW_API']})
        except ValueError:return self.reply({'message':'请刷新页面后连接语音。'},401)
    def current_post(self):
        if self.path not in ('/api/voice/config','/api/voice/minimax/stream','/api/voice/minimax/cancel'):return old_post(self)
        try:
            data=self.payload(8192);sess=self.session(write=True)
            if not host['ALLOW_API'] and self.path!='/api/voice/minimax/cancel' and data!={'disconnect':True}:return self.reply({'message':'当前服务未启用外部语音连接。'},412)
            if self.path=='/api/voice/minimax/stream':return stream(self,sess,host['LOCK'],data=data)
            with host['LOCK']:
                return self.reply(cancel_request(sess,data) if self.path=='/api/voice/minimax/cancel' else configure(sess,data))
        except (ValueError,TypeError,UnicodeError):return self.reply({'message':'语音配置无效或会话已过期，请刷新后重试。'},400)
    cls.do_GET=current_get;cls.do_POST=current_post;cls._minimax_routes=True
    return True
