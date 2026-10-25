from fastapi.testclient import TestClient

import main
from playback import select_audio, startup_format, progressive_format
from test_fast_playback import formats
from test_quality_switch import ready


def multilingual():
    info = formats()
    video, audio, combined = info['formats']
    english = {**audio, 'language': 'en', 'language_preference': 10, 'format_note': 'English (original)'}
    russian = {**audio, 'format_id': 'ru-audio', 'language': 'ru', 'url': 'https://abc.googlevideo.com/ru', 'abr': 128}
    merged_en = {**combined, 'language': 'en'}
    merged_ru = {**combined, 'format_id': 'ru-mp4', 'language': 'ru', 'url': 'https://abc.googlevideo.com/ru-mp4'}
    low = {**merged_en, 'height': 360, 'width': 640, 'vbr': 300, 'tbr': 428}
    return {**info, 'requested_formats': [video, english],
            'formats': [video, english, russian, merged_en, merged_ru, low]}


def test_select_existing_dub_and_never_replace_it_with_wrong_language_preview():
    info = multilingual()
    chosen = select_audio(info, 'ru')
    assert chosen['requested_formats'][1]['language'] == 'ru'
    assert {track['id'] for track in chosen['_audio_tracks']} == {'ru', 'en'}
    assert chosen['_audio_warning'] == ''
    assert progressive_format(chosen, 720)['format_id'] == 'ru-mp4'
    assert startup_format(chosen, 720) is None  # only an English 360p preview exists
    original = select_audio(info, 'original')
    assert original['_audio_language'] == 'en'
    assert startup_format(original, 720)['requested_formats'][0]['height'] == 360
    assert info['requested_formats'][1]['language'] == 'en'  # cached metadata is unchanged


def test_missing_dub_preserves_preference_and_warns_without_claiming_translation():
    result = select_audio(multilingual(), 'uz')
    assert result['_audio_preference'] == 'uz'
    assert result['_audio_language'] == 'en' and result['_audio_warning']


def test_audio_override_does_not_map_combined_inputs_wrong_audio():
    info = multilingual()
    info['requested_formats'] = [info['formats'][3]]  # video already contains English
    chosen = select_audio(info, 'ru')
    assert chosen['requested_formats'][0]['acodec'] == 'none'
    assert chosen['requested_formats'][1]['language'] == 'ru'


def test_quality_audio_defaults_persist_across_videos_and_restart(monkeypatch):
    calls = []
    def extract(self, identifier, quality, *args, **kwargs):
        calls.append((identifier, quality))
        return multilingual()
    monkeypatch.setattr(main.YouTubeService, 'extract', extract)
    monkeypatch.setattr(main.subprocess, 'Popen', lambda *a, **kw: (_ for _ in ()).throw(AssertionError('Compatible MP4 available')))
    with TestClient(main.app) as client:
        response = client.post('/api/settings', json={'browser': 'none', 'quality': 1080, 'audio': 'ru', 'ask_profile': False})
        assert response.status_code == 200 and response.json()['audio'] == 'ru'
        for identifier in ['9w4PxRm2vhU', 'MdQM9Gn2QyA']:
            token = client.post('/api/prepare', json={'url': identifier, 'multi_audio': False}).json()['id']
            data = ready(client, token)
            assert data['audio_language'] == 'ru' and data['audio_preference'] == 'ru'
            assert data['quality'] == 'До 1080p' and data['format_id'] == 'ru-mp4'
        assert [q for _, q in calls] == [1080, 1080]
        # A browser-only settings update does not erase the audio preference.
        client.post('/api/settings', json={'browser': 'none', 'quality': 1080})
        assert client.get('/api/session').json()['audio'] == 'ru'
        assert client.post('/api/prepare', json={'url': '9w4PxRm2vhU', 'audio': 'ru][evil]'}).status_code == 422
    with TestClient(main.app) as client:
        settings = client.get('/api/session').json()
        assert settings['quality'] == 1080 and settings['audio'] == 'ru'
        assert settings['ask_profile'] is False
