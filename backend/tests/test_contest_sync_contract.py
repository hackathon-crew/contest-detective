import pytest
from pydantic import ValidationError

from contest_detective.server.contest.schemas import FieldValue
from contest_detective.server.research_pipeline.pipeline import ContestRecord, ContestSyncContext, ContestSyncInput, ContestSyncOutput


def test_sync_input_is_the_contest_query_and_its_limits():
    params = ContestSyncInput(keywords=('黑客松',), mode='online')

    assert params.keywords == ('黑客松',)
    assert params.name is None
    assert params.mode == 'online'
    assert params.country is None


def test_sync_input_requires_a_name_or_a_keyword():
    with pytest.raises(ValidationError):
        ContestSyncInput()


def test_sync_context_starts_from_the_request_and_empty_fillers():
    context = ContestSyncContext(request=ContestSyncInput(name='公开测试黑客松', country='中国'))

    assert context.request.country == '中国'
    assert context.retrieved_pages == []
    assert context.extracted_items == []
    assert context.records == []


def test_sync_output_carries_a_resolved_record_without_merge_fields():
    record = ContestRecord(name='公开测试黑客松', fields={
        'city': FieldValue(value='上海', level='reposted'),
    })
    output = ContestSyncOutput(records=[record], skipped=2)

    assert output.records[0].fields['city'].value == '上海'
    assert output.records[0].fields['city'].level == 'reposted'
    assert output.failed == 0
    assert output.skipped == 2
