import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from youtube_feed import parse_cards, initial_data, FeedParseError


def html(contents, assignment='var ytInitialData = '):
    return '<html><script>' + assignment + json.dumps({'contents': contents}, ensure_ascii=False) + '; other();</script></html>'


def video(identifier='9w4PxRm2vhU', title='Видео <safe>'):
    return {'videoRenderer': {'videoId': identifier, 'title': {'runs': [{'text': title}]},
        'ownerText': {'runs': [{'text': 'Канал'}]}, 'lengthText': {'simpleText': '2:32'},
        'viewCountText': {'simpleText': '100 просмотров'}}}


def test_classic_home_cards_and_duplicates():
    result = parse_cards(html([video(), video(), video('MdQM9Gn2QyA')]))
    assert len(result) == 2
    assert result[0]['duration'] == 152
    assert result[0]['title'] == 'Видео <safe>'
    assert result[0]['channel'] == 'Канал'
    assert result[0]['views'] == '100 просмотров'


@pytest.mark.parametrize('assignment', ['var ytInitialData = ', 'window["ytInitialData"] = ', "window['ytInitialData'] = "])
def test_assignment_variants(assignment):
    assert parse_cards(html(video(), assignment))[0]['id'] == '9w4PxRm2vhU'


def test_new_lockup_card():
    card = {'lockupViewModel': {'contentId': '9w4PxRm2vhU', 'contentType': 'LOCKUP_CONTENT_TYPE_VIDEO',
        'metadata': {'lockupMetadataViewModel': {'title': {'content': 'Новая карточка'},
            'metadata': {'contentMetadataViewModel': {'metadataRows': [{'metadataParts': [{'text': {'content': 'Канал'}}]}]}}}},
        'contentImage': {'thumbnailViewModel': {'overlays': [{'thumbnailOverlayBadgeViewModel': {'text': '1:08:32'}}]}}}}
    result = parse_cards(html(card))[0]
    assert result['duration'] == 4112
    assert result['channel'] == 'Канал'


def test_ads_are_excluded_and_card_limit_respected():
    result = parse_cards(html([{'adSlotRenderer': {'nested': video('PF4WgbgGskY')}}, video(), video('MdQM9Gn2QyA')]), limit=1)
    assert len(result) == 1 and result[0]['id'] == '9w4PxRm2vhU'


def test_dont_execute_page_scripts():
    with pytest.raises(FeedParseError):
        initial_data('<script>var ytInitialData = alert("no");</script>')
    with pytest.raises(FeedParseError):
        parse_cards('<html>Sign in / consent required</html>')


def test_skip_upcoming_and_invalid_ids():
    upcoming = video()
    upcoming['videoRenderer']['upcomingEventData'] = {'startTime': '123'}
    with pytest.raises(FeedParseError):
        parse_cards(html([upcoming, video('bad-id')]))


def test_classic_channel_avatar_is_not_video_thumbnail():
    value = video()
    value['videoRenderer']['channelThumbnailSupportedRenderers'] = {
        'channelThumbnailWithLinkRenderer': {'thumbnail': {'thumbnails': [
            {'url': 'https://yt3.ggpht.com/example=s48-c', 'width': 48},
            {'url': 'https://yt3.ggpht.com/example=s88-c', 'width': 88},
        ]}}}
    result = parse_cards(html(value))[0]
    assert result['avatar'] == 'https://yt3.ggpht.com/example=s88-c'
    assert 'i.ytimg.com' in result['thumbnail']


def test_lockup_avatar_and_reject_untrusted_avatar_hosts():
    value = {'lockupViewModel': {'contentId': '9w4PxRm2vhU',
        'metadata': {'lockupMetadataViewModel': {'title': {'content': 'Video'},
            'image': {'decoratedAvatarViewModel': {'avatar': {'avatarViewModel': {
                'image': {'sources': [{'url': 'https://yt3.googleusercontent.com/example', 'width': 88}]}}}}}}}}}
    assert parse_cards(html(value))[0]['avatar'] == 'https://yt3.googleusercontent.com/example'
    value['lockupViewModel']['metadata']['lockupMetadataViewModel']['image'] = {'url': 'http://127.0.0.1/private'}
    assert parse_cards(html(value))[0]['avatar'] == ''


def test_related_page_uses_watch_next_not_home_or_primary_content():
    from youtube_feed import parse_page
    data = {'contents': {'twoColumnWatchNextResults': {
        'results': {'results': {'contents': [video('PF4WgbgGskY')]}},
        'secondaryResults': {'secondaryResults': {'results': [video('MdQM9Gn2QyA'),
            {'continuationItemRenderer': {'continuationEndpoint': {
                'continuationCommand': {'token': 'related-token'},
                'commandMetadata': {'webCommandMetadata': {'apiUrl': '/youtubei/v1/next'}}}}}]}}
    }}}
    source = '<script>ytcfg.set({"INNERTUBE_CONTEXT":{"client":{"clientName":"WEB","clientVersion":"test"}}});var ytInitialData=' + json.dumps(data) + ';</script>'
    result = parse_page(source, scope='related')
    assert [x['id'] for x in result['items']] == ['MdQM9Gn2QyA']
    assert result['continuation'] == {'token': 'related-token', 'endpoint': 'next'}
    assert result['config']['INNERTUBE_CONTEXT']['client']['clientName'] == 'WEB'


def test_continuation_endpoint_is_restricted():
    from youtube_feed import continuation
    data = {'continuationItemRenderer': {'continuationEndpoint': {
        'continuationCommand': {'token': 'token'},
        'commandMetadata': {'webCommandMetadata': {'apiUrl': '/youtubei/v1/unknown'}}}}}
    assert continuation(data) is None
