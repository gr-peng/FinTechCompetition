"""Fixed, independently authorized chat profiles; all credentials stay in RAM."""
PROVIDER = 'minimax-official'
MODEL = 'MiniMax-M3.1-Flash'
BASE = 'https://api.minimax.cn/v1'
HOST = 'api.minimax.cn'
MICU_PROVIDER = 'micu'
MICU_MODEL = 'deepseek-flash'
MICU_BASE = 'https://www.micuapi.ai/v1'
PROFILES = {
    PROVIDER: {'id': PROVIDER, 'label': 'MiniMax 官方', 'model': MODEL, 'base_url': BASE},
    MICU_PROVIDER: {'id': MICU_PROVIDER, 'label': 'Micu', 'model': MICU_MODEL, 'base_url': MICU_BASE},
}
live_official_only = False  # Legacy name: unbound live requests remain forbidden.


def is_live_app(module):
    from pathlib import Path
    return bool(module is not None and Path(getattr(module,'__file__','')).resolve()==Path(__file__).resolve().parent/'server.py'
                and getattr(getattr(module,'Handler',None),'server_version',None)=='FinPilotLocal')


def selected(session):
    provider=session.get('active_chat_provider',PROVIDER)
    profile=PROFILES.get(provider,PROFILES[PROVIDER])
    return {**profile,'model':session.get('chat_models',{}).get(profile['id'],profile['model'])}


def credential(session, provider):
    # Existing explicitly authorized official connection stays in its original slot.
    # An old unbound/Micu key or a voice key never becomes a new provider credential.
    if provider==PROVIDER:
        return session.get('key') if session.get('chat_provider')==PROVIDER else None
    if provider==MICU_PROVIDER:
        return session.get('chat_connections',{}).get(MICU_PROVIDER,{}).get('key')
    return None


def configured(session):
    return bool(credential(session,selected(session)['id']))


def status(session,host):
    profile=selected(session)
    return {'configured':configured(session),'enabled':bool(host['ALLOW_API']),
            'agent_enabled':bool(host['ALLOW_API'] and host['AGENT_VALIDATION']),
            'provider':profile['id'],'model':profile['model'],'base_url':profile['base_url'],
            'provider_switch':True,'editable_model':True,'providers':[{**p,'model':session.get('chat_models',{}).get(p['id'],p['model']),'configured':bool(credential(session,p['id']))} for p in PROFILES.values()]}


class ConfigError(ValueError):
    def __init__(self,message,status=400):
        super().__init__(message);self.status=status


def normalize_model(value):
    import re
    if not isinstance(value,str) or not value.strip():raise ConfigError('请输入模型名。')
    value=value.strip()
    if len(value)>200 or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._:/@+-]*',value):raise ConfigError('模型名格式不正确。')
    return value


def select_connection(session,provider):
    previous=selected(session)['id']
    if previous!=provider:
        names=('agent_retry_after','agent_transient_failures')
        retries=session.setdefault('chat_retry_states',{})
        retries[previous]={name:session[name] for name in names if name in session}
        for name in names:
            session.pop(name,None)
            if name in retries.get(provider,{}):session[name]=retries[provider][name]
    session['active_chat_provider']=provider


def update_connection(session,data,host):
    import time
    if session.get('agent_busy'):raise ConfigError('当前请求尚在结束，请稍后切换或保存连接。',409)
    provider=data.get('provider',selected(session)['id'])
    if provider not in PROFILES:raise ConfigError('请选择支持的对话服务。')
    profile=PROFILES[provider]
    if data.get('mode')=='offline':
        clear_connection(session,provider);return
    if not host['ALLOW_API']:raise ConfigError('此预览尚未启用模型连接。',412)
    if data.get('mode')=='select':
        select_connection(session,provider)
        return
    if data.get('base_url','').rstrip('/')!=profile['base_url']:
        raise ConfigError('服务商与固定地址不匹配，未保存连接。')
    model=normalize_model(data.get('model',profile['model']))
    key=data.get('key','')
    if key=='':
        if not credential(session,provider):raise ConfigError('请先填写当前服务商的 Key。')
    elif not isinstance(key,str) or not 10<=len(key)<=256 or any(c.isspace() for c in key):raise ConfigError('请检查对话 Key 格式。')
    elif provider==PROVIDER:
        session['key']=key;session['chat_provider']=PROVIDER
    else:
        session.setdefault('chat_connections',{})[MICU_PROVIDER]={'key':key}
    session.setdefault('chat_models',{})[provider]=model
    select_connection(session,provider);session['created']=time.time()
    session.pop('agent_retry_after',None);session.pop('agent_transient_failures',None)


def clear_connection(session,provider=None):
    if session.get('agent_busy'):raise ConfigError('当前请求尚在结束，请稍后断开。',409)
    provider=provider or selected(session)['id']
    if provider==PROVIDER:session['key']=None
    elif provider==MICU_PROVIDER:session.get('chat_connections',{}).pop(MICU_PROVIDER,None)
    else:raise ConfigError('请选择支持的对话服务。')


def request_body(messages,model=MODEL):
    params={'model':normalize_model(model),'messages':messages,'reasoning_split':True,'max_completion_tokens':4096,'stream':False}
    if model==MODEL:params['reasoning_effort']='low'
    return params


def install_existing_service(module):
    """Adopt only through the app's existing fixed module reload; preserve RAM."""
    global live_official_only
    import agent_runtime
    if not is_live_app(module):return False
    host=vars(module)
    from pathlib import Path
    if host.get('ROOT')!=Path(__file__).resolve().parent:return False
    if (host.get('MODEL'),host.get('BASE')) not in {(MICU_MODEL,MICU_BASE),(MODEL,BASE)}:return False
    cls=host['Handler']
    if not host.get('ALLOW_API') or not host.get('AGENT_VALIDATION'):return False
    live_official_only=True
    if getattr(cls,'_chat_profile_version',None)==3:return False
    import importlib
    events=host.get('demo_events')
    if events is not None:
        queue=events.QUEUE
        importlib.reload(events)
        events.QUEUE=queue
    previous_post=cls.do_POST;previous_delete=cls.do_DELETE
    def post(self):
        if self.path!='/api/config':return previous_post(self)
        try:
            sess=self.session(write=True);data=self.payload()
            update_connection(sess,data,host)
            return self.reply(status(sess,host),cookie=self.renewed_session_cookie())
        except ConfigError as error:return self.reply({'message':str(error),**({'code':'external_api_disabled',**status(sess,host)} if error.status==412 else {})},error.status)
        except ValueError:return self.reply({'message':'本地会话或请求校验失败。'},403)
    def delete(self):
        if self.path!='/api/config':return previous_delete(self)
        try:
            sess=self.session(write=True);clear_connection(sess)
            return self.reply(status(sess,host))
        except ConfigError as error:return self.reply({'message':str(error)},error.status)
        except ValueError:return self.reply({'message':'本地会话或请求校验失败。'},403)
    def request(self,sess):return agent_runtime.request(self,sess,host)
    request._finpilot_request_policy='no-total-cap-v1'
    host['MODEL']=MODEL;host['BASE']=BASE;host['connection_status']=lambda sess:status(sess,host)
    cls.do_POST=post;cls.do_DELETE=delete;cls.agent_validation_request=request
    cls._official_chat_profile=True;cls._chat_profile_version=3
    return True
