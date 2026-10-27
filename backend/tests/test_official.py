import pytest


@pytest.mark.parametrize(('url','registration_url','origin','external','expected'), [
    ('https://www.huodongxing.com/event/9883938191800', None, None, False, True),
    ('https://www.huodongxing.com/search?qs=test', None, None, False, False),
    ('https://sample.devpost.com/', None, None, False, True),
    ('https://sample.devpost.com.evil.org/', None, None, False, False),
    ('https://ethglobal.com/events/hackathon', None, None, False, True),
    ('https://ethglobal.com/events', None, None, False, False),
    ('https://events.waytoagi.com/events/one', None, 'hosted', False, True),
    ('https://events.waytoagi.com/events/one', None, 'hosted', True, False),
    ('https://events.waytoagi.com/events/one', 'https://events.waytoagi.com/events/one', 'imported', False, False),
    ('https://hackertrip.space/hackathon/one', 'https://hackertrip.space/register', None, False, False),
    ('https://organizer.example.org/event', 'https://organizer.example.org/register', None, False, True),
    ('https://organizer.example.org/event', 'https://other.example.org/register', None, False, False),
    ('https://organizer.example.org.evil.org/event', 'https://organizer.example.org/register', None, False, False),
    ('file:///event', 'file:///register', None, False, False),
])
def test_source_rules_determine_official_status(url, registration_url, origin, external, expected):
    from contest_detective.research.official import is_official_page

    assert is_official_page(url, registration_url=registration_url, origin=origin,
                           external_registration=external) is expected


@pytest.mark.parametrize('url', ['https://sample.devpost.com/', 'https://events.waytoagi.com/events/one'])
def test_trusted_registration_classification_survives_schema_roundtrip(url):
    from contest_detective.contest.schemas import PageIn, Source

    page = PageIn(url=url, site='报名页', title='活动', is_official=True)
    assert page.is_official is True
    assert Source(**page.model_dump(), value='online', excerpt='线上').is_official is True
