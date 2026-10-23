import pytest


@pytest.mark.parametrize(
    ('raw', 'expected'),
    [
        ('2026-10-31T23:59', '2026-10-31T15:59:00Z'),
        ('2026年10月31日 23:59', '2026-10-31T15:59:00Z'),
        ('2026-10-31', '2026-10-30T16:00:00Z'),
        ('2026-10-31T15:59:00.000Z', '2026-10-31T15:59:00Z'),
        ('not a date', None),
        ('2026年10月', None),
        ('', None),
    ],
)
def test_source_dates_are_complete_utc_values(raw, expected):
    from contest_detective.server.research_pipeline.sources.dates import parse_datetime

    assert parse_datetime(raw, default_timezone='Asia/Shanghai') == expected


def test_english_date_range_keeps_the_shared_year():
    from contest_detective.server.research_pipeline.sources.dates import parse_date_range

    assert parse_date_range('Aug 31 - Oct 23, 2026') == (
        '2026-08-31T00:00:00Z', '2026-10-23T00:00:00Z',
    )
