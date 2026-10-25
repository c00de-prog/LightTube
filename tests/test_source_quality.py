from fastapi.testclient import TestClient

import main
from playback import select_video, select_audio, quality_details
from test_fast_playback import formats
from test_quality_switch import ready


def sources():
    info = formats()
    base = info['formats'][0]
    rich = {**base, 'format_id': '720-rich', 'vbr': 2500, 'url': 'https://abc.googlevideo.com/rich'}
    sixty = {**base, 'format_id': '720-60', 'fps': 60, 'vbr': 3000, 'url': 'https://abc.googlevideo.com/sixty'}
    hd = {**base, 'format_id': '1080', 'height': 1080, 'width': 1920, 'fps': 60, 'vbr': 6000, 'url': 'https://abc.googlevideo.com/fullhd'}
    return {**info, 'formats': info['formats'] + [rich, sixty, hd]}


def test_quality_selection_prefers_resolution_then_fps_then_known_video_bitrate():
    info = sources()
    chosen = select_video(info, 720)['requested_formats'][0]
    assert chosen['format_id'] == '720-60'
    no_sixty = {**info, 'formats': [f for f in info['formats'] if f.get('fps') != 60]}
    assert select_video(no_sixty, 720)['requested_formats'][0]['format_id'] == '720-rich'
    assert select_video(info, 1080)['requested_formats'][0]['format_id'] == '1080'
    assert select_video(info, 0)['requested_formats'][0]['format_id'] == '1080'
    assert info['requested_formats'][0]['format_id'] == 'v'  # original cache is not mutated


def test_incompatible_drm_and_untrusted_sources_cannot_win_selection():
    info = formats()
    original = info['formats'][0]
    for change in [{'vcodec': 'av01.0.08M.08'}, {'vcodec': 'vp9'}, {'has_drm': True},
                   {'url': 'https://localhost/private'}, {'fps': 120}]:
        richer = {**original, 'format_id': 'bad', 'vbr': 9000, **change}
        assert select_video({**info, 'formats': info['formats'] + [richer]}, 720)['requested_formats'][0]['format_id'] != 'bad'


def test_portrait_limit_and_cropped_source_display_actual_dimensions():
    info = formats()
    portrait = {**info['formats'][0], 'format_id': 'portrait', 'width': 720, 'height': 1280, 'vbr': 4000}
    selected = select_video({**info, 'formats': info['formats'] + [portrait]}, 720)['requested_formats']
    assert selected[0]['format_id'] == 'portrait'
    details = quality_details(selected, 720)
    assert details['source_quality'] == '720p' and '720 × 1280' in details['source_details']
    cropped = {**portrait, 'width': 1920, 'height': 840}
    details = quality_details([cropped], 1080)
    assert details['source_quality'] == '840p' and '1080p' in details['quality_note']


def test_upgrade_reuses_full_format_list_to_raise_real_resolution(monkeypatch):
    calls = []
    def extract(self, *args, **kwargs):
        calls.append(1)
        return sources()
    def no_network_worker(service, job, identifier, quality):
        info = job.get('info_override') or service.extract(identifier, quality)
        job['target_info'] = info
        import time
        job['target_info_at'] = time.monotonic()
        selected = select_audio(select_video(info, quality))['requested_formats']
        main.update(job, ready=True, stage='complete', mode='hls', **quality_details(selected, quality))
        service.playback_pending.clear()
    monkeypatch.setattr(main.YouTubeService, 'extract', extract)
    monkeypatch.setattr(main, 'run_stream', no_network_worker)
    with TestClient(main.app) as client:
        first = client.post('/api/prepare', json={'url': '9w4PxRm2vhU', 'quality': 720}).json()['id']
        assert ready(client, first)['source_quality'] == '720p · 60 fps'
        child = client.post(f'/api/jobs/{first}/quality', json={'quality': 1080}).json()['id']
        assert ready(client, child)['source_quality'] == '1080p · 60 fps'
        assert len(calls) == 1


def test_extractor_format_expression_accepts_portrait_only_sources_without_network():
    import yt_dlp
    from playback import quality_format
    info = formats()
    video = {**info['formats'][0], 'width': 720, 'height': 1280}
    audio = info['formats'][1]
    with yt_dlp.YoutubeDL({'quiet': True, 'no_warnings': True, 'format': quality_format(720)}) as ydl:
        selected = ydl.process_ie_result({**info, 'formats': [video, audio]}, download=False)
    assert selected['requested_formats'][0]['width'] == 720
    assert selected['requested_formats'][0]['height'] == 1280
