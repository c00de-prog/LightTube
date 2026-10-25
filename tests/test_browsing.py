import json

from fastapi.testclient import TestClient

import main
from youtube_feed import renderer_card, lockup_card


def test_card_has_channel_date_views_and_youtube_watched_marker():
    data = {'videoId':'9w4PxRm2vhU','title':{'simpleText':'Example'},
            'ownerText':{'runs':[{'text':'Author','navigationEndpoint':{'browseEndpoint':{'browseId':'UCabcdefghijklmnopqrstuv'}}}]},
            'viewCountText':{'simpleText':'123 просмотра'},'publishedTimeText':{'simpleText':'2 дня назад'},
            'thumbnailOverlays':[{'thumbnailOverlayResumePlaybackRenderer':{'percentDurationWatched':45}}]}
    item = renderer_card(data)
    assert item['channel_id'] == 'UCabcdefghijklmnopqrstuv'
    assert item['published'] == '2 дня назад' and item['views'] == '123 просмотра'
    assert item['is_watched'] is True
    data['thumbnailOverlays'] = []
    assert renderer_card(data)['is_watched'] is False


def test_lockup_metadata_rows():
    item = lockup_card({'contentId':'9w4PxRm2vhU','metadata':{'lockupMetadataViewModel':{
        'title':{'content':'Example'},'metadata':{'contentMetadataViewModel':{'metadataRows':[
            {'metadataParts':[{'text':{'content':'Author'}}]},
            {'metadataParts':[{'text':{'content':'123 views'}},{'text':{'content':'1 day ago'}}]}
        ]}}}}})
    assert item['channel'] == 'Author' and item['views'] == '123 views' and item['published'] == '1 day ago'


def test_channel_api_validation_cache_and_no_arbitrary_urls(monkeypatch):
    service = main.YouTubeService()
    calls = []
    def fetch(path):
        calls.append(path)
        service.latest_cursor = 'opaque-cursor'
        return [{'id':'9w4PxRm2vhU','title':'Example'}]
    monkeypatch.setattr(service,'fetch_cards',fetch)
    with TestClient(main.app) as client:
        main.app.state.youtube = service
        url = '/api/channels/UCabcdefghijklmnopqrstuv'
        result = client.get(url)
        assert result.status_code == 200 and result.json()['cursor'] == 'opaque-cursor'
        assert client.get(url).json() == result.json()
        assert calls == ['/channel/UCabcdefghijklmnopqrstuv/videos?hl=ru']
        assert client.get('/api/channels/not-a-channel').status_code == 422
