import asyncio
import threading
import time

import httpx
from fastapi.testclient import TestClient

import main
from playback import progressive_format, safe_headers


def formats(height=720, fps=30, vbr=1000):
    video = {'format_id':'v','vcodec':'avc1.64001f','acodec':'none','height':height,'width':1280,'fps':fps,'vbr':vbr,
             'ext':'mp4','url':'https://abc.googlevideo.com/video','protocol':'https'}
    audio = {'format_id':'a','vcodec':'none','acodec':'mp4a.40.2','url':'https://abc.googlevideo.com/audio','ext':'m4a'}
    combined = {**video,'format_id':'combined','acodec':'mp4a.40.2','tbr':1150,'url':'https://abc.googlevideo.com/both'}
    return {'id':'9w4PxRm2vhU','title':'Test','duration':120,'requested_formats':[video,audio],'formats':[video,audio,combined]}


def test_progressive_never_downgrades_known_resolution_fps_or_bitrate():
    info = formats()
    assert progressive_format(info,720)['format_id'] == 'combined'
    f = info['formats'][-1]
    for field,value in [('height',360),('fps',24),('vbr',500),('url','https://localhost/private'),('has_drm',True),('acodec','opus')]:
        altered = {**f, field:value}
        assert progressive_format({**info,'formats':[altered]},720) is None
    assert progressive_format(info,480) is None
    assert 'cookie' not in safe_headers({'Cookie':'secret','User-Agent':'ok','Referer':'x\r\nInjected: yes'})


def test_foreground_reuses_prefetched_addresses_and_speculation_skips_busy_lock(monkeypatch):
    service = main.YouTubeService()
    calls = []
    class Fake:
        def __enter__(self): return self
        def __exit__(self,*args): pass
        def extract_info(self,*args,**kwargs): calls.append(args); return formats()
    monkeypatch.setattr(service,'ydl',lambda options:Fake())
    first = service.extract('9w4PxRm2vhU',720,True)
    second = service.extract('9w4PxRm2vhU',720)
    assert not first['_lighttube_cache_hit'] and second['_lighttube_cache_hit'] and len(calls)==1
    service.network_lock.acquire()
    try:
        assert service.extract('MdQM9Gn2QyA',720,True) is None
    finally:
        service.network_lock.release()
    service.playback_pending.set()
    assert service.extract('MdQM9Gn2QyA',720,True) is None
    assert len(calls)==1


def test_progressive_job_does_not_start_ffmpeg(monkeypatch,tmp_path):
    service = main.YouTubeService()
    monkeypatch.setattr(service,'extract',lambda *args:formats())
    monkeypatch.setattr(main.subprocess,'Popen',lambda *a,**kw:(_ for _ in ()).throw(AssertionError('FFmpeg should not start')))
    job={'folder':tmp_path,'lock':threading.Lock(),'stop':threading.Event(),'last_seen':time.monotonic(),
         'media_stream':'/media/test-token','state':{}}
    main.run_stream(service,job,'9w4PxRm2vhU',720)
    assert job['state']['ready'] and job['state']['mode']=='mp4'
    assert job['state']['format_id']=='combined' and job['state']['video_bitrate_kbps']==1000
    assert 'url' not in job['state'] and job['media']['url'].startswith('https://abc.googlevideo.com/')
    assert list(tmp_path.iterdir())==[]


class Bytes(httpx.AsyncByteStream):
    def __init__(self, data=b'abcd'): self.data=data; self.closed=False
    async def __aiter__(self): yield self.data
    async def aclose(self): self.closed=True


def setup_media(client, handler):
    state=main.app.state
    client.portal.call(state.media_client.aclose)
    state.media_client=httpx.AsyncClient(transport=httpx.MockTransport(handler),follow_redirects=False)
    job={'lock':threading.Lock(),'stop':threading.Event(),'last_seen':0,
         'media':{'url':'https://abc.googlevideo.com/both?signature=private','headers':safe_headers({'Cookie':'account-secret','User-Agent':'test'})}}
    state.jobs['media-token']=job
    return job


def test_media_proxy_range_head_no_cookie_or_url_leak():
    requests,streams=[],[]
    def upstream(request):
        requests.append(request)
        stream=Bytes();streams.append(stream)
        return httpx.Response(206 if 'range' in request.headers else 200,
                              headers={'Content-Length':'4','Content-Range':'bytes 0-3/100','Accept-Ranges':'bytes',
                                       'Set-Cookie':'private=secret','Location':'https://evil.example/'},stream=stream)
    with TestClient(main.app) as client:
        setup_media(client,upstream)
        response=client.get('/media/media-token',headers={'Range':'bytes=0-3','Cookie':'client-secret=1'})
        assert response.status_code==206 and response.content==b'abcd'
        assert response.headers['content-range']=='bytes 0-3/100'
        assert 'set-cookie' not in response.headers and 'location' not in response.headers
        assert 'cookie' not in requests[0].headers and requests[0].headers['range']=='bytes=0-3'
        assert streams[0].closed
        response=client.head('/media/media-token')
        assert response.status_code==200 and response.content==b'' and response.headers['content-length']=='4'
        assert streams[-1].closed
        assert client.get('/media/media-token',headers={'Range':'bytes=0-3,5-8'}).status_code==416
        assert len(requests)==2
        assert main.app.state.media_slots._value==4


def test_media_failure_is_sanitized_and_requests_fresh_urls():
    streams=[]
    def upstream(request):
        stream=Bytes();streams.append(stream)
        return httpx.Response(403,stream=stream)
    with TestClient(main.app) as client:
        job=setup_media(client,upstream)
        response=client.get('/media/media-token')
        assert response.status_code==502 and 'private' not in response.text
        assert job['refresh_urls'] and streams[0].closed
        assert main.app.state.media_slots._value==4
        job['stop'].set()
        assert client.get('/media/media-token').status_code==410


def test_prefetch_api_rate_limit_and_stale_profile(monkeypatch):
    calls=[]
    def extract(*args, **kwargs): calls.append(args);return formats()
    with TestClient(main.app) as client:
        monkeypatch.setattr(main.app.state.youtube,'extract',extract)
        body={'video_id':'9w4PxRm2vhU','quality':720,'settings_generation':0}
        assert client.post('/api/prefetch',json=body).json()['status']=='scheduled'
        client.portal.call(asyncio.sleep,.02)
        assert calls and calls[0][-1] is True
        assert client.post('/api/prefetch',json=body).json()['status'] in {'limited','busy'}
        body['settings_generation']=99
        assert client.post('/api/prefetch',json=body).json()['status']=='skipped'
        body['video_id']='https://localhost/'
        assert client.post('/api/prefetch',json=body).status_code==422


def test_explicit_hls_and_fallback_are_idempotent(monkeypatch):
    calls=[]
    def worker(service,job,identifier,quality):
        calls.append(job['force_hls'])
        main.update(job,ready=True,stage='complete',mode='hls' if job['force_hls'] else 'mp4')
        service.playback_pending.clear()
    monkeypatch.setattr(main,'run_stream',worker)
    with TestClient(main.app) as client:
        token=client.post('/api/prepare',json={'url':'9w4PxRm2vhU','quality':720}).json()['id']
        assert client.post('/api/jobs/'+token+'/hls').status_code==200
        assert client.post('/api/jobs/'+token+'/hls').status_code==200
        client.portal.call(asyncio.sleep,.02)
        assert calls==[False,True]
        assert client.get('/api/jobs/'+token).json()['mode']=='hls'
        token2=client.post('/api/prepare',json={'url':'MdQM9Gn2QyA','quality':720,'mode':'hls'}).json()['id']
        client.portal.call(asyncio.sleep,.02)
        assert calls[-1] is True


def test_proxy_releases_upstream_when_consumer_stops_early():
    from types import SimpleNamespace
    from playback import proxy_media
    async def run():
        stream=Bytes(b'x'*131072)
        async def upstream(request):
            return httpx.Response(200,headers={'Content-Length':'131072'},stream=stream)
        client=httpx.AsyncClient(transport=httpx.MockTransport(upstream))
        state=SimpleNamespace(jobs={'t':{'lock':threading.Lock(),'stop':threading.Event(),
                               'media':{'url':'https://abc.googlevideo.com/v','headers':{}}}},
                              media_client=client,media_slots=asyncio.Semaphore(1))
        request=SimpleNamespace(app=SimpleNamespace(state=state),headers={},method='GET')
        response=await proxy_media(request,'t')
        iterator=response.body_iterator
        chunk=await anext(iterator)
        assert len(chunk)==65536 and not stream.closed
        await iterator.aclose()
        assert stream.closed and state.media_slots._value==1
        await client.aclose()
    asyncio.run(run())
