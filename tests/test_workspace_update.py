import json
import subprocess
import threading
import time
from pathlib import Path
from types import SimpleNamespace

import main
from playback import audio_bundle, select_audio
from youtube_feed import parse_page


def test_playlist_search_does_not_turn_untyped_videos_into_playlists():
    data = {'contents': [{'lockupViewModel': {'contentId':'9w4PxRm2vhU', 'metadata': {'lockupMetadataViewModel': {'title':{'content':'Video'}}}}},
                         {'playlistRenderer':{'playlistId':'PL12345678901234','title':{'simpleText':'List'}}}]}
    page = parse_page('<script>var ytInitialData = '+json.dumps(data)+';</script>', scope='playlists')
    assert [x['kind'] for x in page['items']] == ['playlist']
    assert page['items'][0]['id']=='PL12345678901234'


def test_search_combines_type_and_upload_date(monkeypatch):
    service=main.YouTubeService()
    calls=[]
    monkeypatch.setattr(service,'fetch_cards',lambda path,scope: calls.append((path,scope)) or [])
    service.search('test','playlists','week')
    from urllib.parse import urlparse,parse_qs
    import base64
    params=parse_qs(urlparse(calls[0][0]).query)
    assert list(base64.b64decode(params['sp'][0])) == [0x12,4,0x08,3,0x10,3]
    assert calls[0][1]=='playlists'


def test_anonymous_subscriptions_do_not_read_browser(monkeypatch):
    service=main.YouTubeService();service.browser='none'
    monkeypatch.setattr(service,'fetch_cards',lambda *a,**k: (_ for _ in ()).throw(AssertionError('network')))
    result=service.discover('subscriptions')
    assert result['items']==[] and 'signed in' in result['warning']


def test_real_ffmpeg_two_audio_master_and_local_segment_routes(tmp_path,monkeypatch):
    # Local media only: exercise the exact HLS command produced by run_stream.
    source=tmp_path/'source.mp4';folder=tmp_path/'session';folder.mkdir()
    subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-f','lavfi','-i','color=size=160x90:rate=25',
        '-f','lavfi','-i','sine=frequency=440:sample_rate=48000','-t','5','-c:v','libx264','-g','50','-pix_fmt','yuv420p',
        '-c:a','aac','-y',str(source)],check=True)
    video={'url':'https://v.googlevideo.com/v','ext':'mp4','vcodec':'avc1','acodec':'none','width':160,'height':90,'fps':25}
    audio={'url':'https://v.googlevideo.com/en','vcodec':'none','acodec':'mp4a','ext':'m4a','language':'en','format_note':'(original)'}
    russian={**audio,'url':'https://v.googlevideo.com/ru','language':'ru','format_note':''}
    info={'title':'Local fixture','duration':5,'formats':[video,audio,russian],'requested_formats':[video,audio]}
    selected=select_audio(info,'ru')
    assert [x['language'] for x in audio_bundle(selected,'ru')]==['ru','en']
    service=SimpleNamespace(extract=lambda *a:info,playback_pending=threading.Event())
    job={'folder':folder,'stop':threading.Event(),'lock':threading.Lock(),'last_seen':time.monotonic(),
         'audio':'ru','ui_language':'ru','multi_audio':True,'state':{'ready':False}}
    monkeypatch.setattr(main,'input_arguments',lambda *a:['-i',str(source)])
    main.run_stream(service,job,'9w4PxRm2vhU',720)
    assert job['state']['stage']=='complete',job['state']
    master=(folder/'index.m3u8').read_text()
    assert master.count('TYPE=AUDIO')==2
    assert 'LANGUAGE="ru"' in master and 'LANGUAGE="en"' in master
    for line in master.splitlines():
        if line.startswith('track-'): assert main.RENDITION.fullmatch(line) and (folder/line).is_file()
    assert len(list(folder.glob('track-*.m3u8')))==3
    for path in folder.glob('segment-*.ts'): assert main.SEGMENT.fullmatch(path.name) and path.stat().st_size>0


def test_only_completed_opted_in_views_schedule_history_sync(monkeypatch):
    from fastapi.testclient import TestClient
    calls=[]
    monkeypatch.setattr(main.YouTubeService,'mark_completed',lambda self,identifier,generation:calls.append(identifier))
    with TestClient(main.app) as client:
        token='history-sync-token'
        main.app.state.jobs[token]={'stop':threading.Event(),'lock':threading.Lock(),
            'settings_generation':0,'state':{'video_id':'9w4PxRm2vhU','duration':120,'title':'Video'}}
        for body in ({'position':30,'completed':False,'sync_youtube':True},
                     {'position':120,'completed':True,'sync_youtube':False},
                     {'position':30,'completed':True,'sync_youtube':True}):
            assert client.post('/api/history',json={'token':token,**body}).status_code==200
        assert not calls
        assert client.post('/api/history',json={'token':token,'position':120,'completed':True,'sync_youtube':True}).status_code==200
    assert calls==['9w4PxRm2vhU']
