import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import main
import profiles


def test_profile_discovery_does_not_expose_email_or_path(monkeypatch, tmp_path):
    monkeypatch.setenv('LOCALAPPDATA', str(tmp_path))
    root = tmp_path / 'Google/Chrome/User Data'
    (root / 'Default').mkdir(parents=True)
    (root / 'Profile 1').mkdir()
    (root / 'Local State').write_text(json.dumps({'profile': {'info_cache': {'Profile 1': {'user_name': 'private@example.com'}}}}))
    with TestClient(main.app) as client:
        result = client.get('/api/profiles?browser=chrome').json()['items']
        assert len(result) == 2
        assert {x['label'] for x in result} == {'Основной профиль', 'Profile 1'}
        assert all(set(x) == {'id', 'label'} for x in result)
        assert 'private@example.com' not in json.dumps(result)
        chosen = result[1]['id']
        response = client.post('/api/settings', json={'browser':'chrome','profile': chosen,'quality':720,'ask_profile':False})
        assert response.status_code == 200
        assert main.app.state.youtube.options()['cookiesfrombrowser'] == ('chrome', str((root/'Profile 1').resolve()))
        assert client.post('/api/settings', json={'browser':'chrome','profile':'../../secret','quality':720}).status_code == 422
        assert client.get('/api/profiles?browser=unknown').status_code == 422
    with TestClient(main.app) as client:
        settings = client.get('/api/session').json()
        assert settings['profile'] == chosen and settings['ask_profile'] is False
        assert client.get('/api/history').json()['items'] == []


def test_switch_profile_invalidates_cached_context(monkeypatch, tmp_path):
    monkeypatch.setenv('LOCALAPPDATA', str(tmp_path))
    root = tmp_path / 'Google/Chrome/User Data'
    (root/'Default').mkdir(parents=True)
    (root/'Profile 2').mkdir()
    service = main.YouTubeService()
    choices = profiles.browser_profiles('chrome')
    assert service.configure('chrome', 720, choices[0]['id'], False)
    generation = service.settings_generation
    service.feed = [{'id':'9w4PxRm2vhU'}]
    assert not service.configure('chrome', 1080, choices[0]['id'], False)
    assert service.settings_generation == generation
    assert service.configure('chrome', 1080, choices[1]['id'], True)
    assert service.settings_generation == generation + 1 and service.feed is None


def test_firefox_profiles_and_explicit_override(monkeypatch, tmp_path):
    monkeypatch.setenv('APPDATA', str(tmp_path))
    root = tmp_path/'Mozilla/Firefox'
    (root/'Profiles/one').mkdir(parents=True)
    (root/'profiles.ini').write_text('[Profile0]\nName=private@example.com\nIsRelative=1\nPath=Profiles/one\n')
    items = profiles.browser_profiles('firefox')
    assert items[0]['label'] == 'Профиль 1'
    assert profiles.profile_path('firefox',items[0]['id']) == str((root/'Profiles/one').resolve())
    monkeypatch.setenv('LIGHTTUBE_FIREFOX_PROFILE',str(root/'Profiles/one'))
    assert len(profiles.browser_profiles('firefox')) == 1
    assert profiles.profile_path('firefox','auto') == str(root/'Profiles/one')
