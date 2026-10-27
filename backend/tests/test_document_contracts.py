"""Bounded wire contracts preserve verbatim evidence and reject ambiguous input."""

import pytest
from pydantic import ValidationError

from contest_detective.system.documents.schemas import DocumentAnswer, DocumentQuestion


def question_data():
    return {
        'question': 'What is required?',
        'passages': [{
            'document_id': 'synthetic-rules', 'passage_id': 'page-1',
            'title': 'Synthetic rules', 'locator': 'Page 1',
            'text': 'Submit a demonstration video.',
        }],
    }


def grounded_answer():
    return {'status': 'answered', 'claims': [{'text': 'A demonstration video is required.',
        'citations': [{'document_id': 'synthetic-rules', 'passage_id': 'page-1',
                       'quote': 'Submit a demonstration video.'}]}]}


def test_question_contract_roundtrips():
    question = DocumentQuestion.model_validate(question_data())
    assert DocumentQuestion.model_validate_json(question.model_dump_json()) == question


@pytest.mark.parametrize('patch', [
    {'question': ''}, {'question': '   '}, {'question': 'x' * 1001}, {'passages': []},
    {'passages': question_data()['passages'] * 9}, {'remote_url': 'https://example.test'},
])
def test_question_contract_rejects_invalid_shape(patch):
    with pytest.raises(ValidationError):
        DocumentQuestion.model_validate(question_data() | patch)


@pytest.mark.parametrize('field,value', [
    ('document_id', ''), ('document_id', 'x' * 101), ('passage_id', ''), ('passage_id', 'x' * 101),
    ('title', ' '), ('title', 'x' * 241), ('locator', ''), ('locator', 'x' * 121),
    ('text', ''), ('text', ' \n\t'), ('text', 'x' * 4001), ('url', 'https://example.test'),
])
def test_passage_fields_have_individual_limits(field, value):
    data = question_data()
    data['passages'][0][field] = value
    with pytest.raises(ValidationError):
        DocumentQuestion.model_validate(data)


def test_duplicate_identifiers_are_rejected_after_normalization():
    data = question_data()
    data['passages'].append(data['passages'][0] | {'passage_id': ' page-1 ', 'text': 'Contradictory text.'})
    with pytest.raises(ValidationError, match='不能重复'):
        DocumentQuestion.model_validate(data)


def test_passage_id_can_be_reused_by_a_different_document():
    data = question_data()
    data['passages'].append(data['passages'][0] | {'document_id': 'another-document'})
    assert len(DocumentQuestion.model_validate(data).passages) == 2


def test_aggregate_utf8_byte_limit_includes_metadata():
    passage = question_data()['passages'][0] | {'text': '比' * 4000}
    data = question_data() | {'passages': [passage | {'passage_id': str(i)} for i in range(3)]}
    with pytest.raises(ValidationError, match='24KiB'):
        DocumentQuestion.model_validate(data)
    assert DocumentQuestion.model_validate(data | {'passages': data['passages'][:2]})


def test_source_and_quote_whitespace_are_preserved():
    data = question_data()
    data['passages'][0]['text'] = '  Submit a demonstration video.\n'
    answer = grounded_answer()
    answer['claims'][0]['citations'][0]['quote'] = data['passages'][0]['text']
    assert DocumentQuestion.model_validate(data).passages[0].text == '  Submit a demonstration video.\n'
    assert DocumentAnswer.model_validate(answer).claims[0].citations[0].quote == data['passages'][0]['text']


@pytest.mark.parametrize('answer', [
    {'status': 'answered', 'claims': []},
    {'status': 'answered', 'claims': [{'text': 'Unsupported', 'citations': []}]},
    grounded_answer() | {'status': 'insufficient_evidence'},
    grounded_answer() | {'title': 'Invented source'},
])
def test_answer_contract_rejects_empty_uncited_or_inconsistent_claims(answer):
    with pytest.raises(ValidationError):
        DocumentAnswer.model_validate(answer)


@pytest.mark.parametrize('field,value', [('text', ' '), ('text', 'x' * 1201), ('citations', [])])
def test_claims_have_nonempty_bounded_content(field, value):
    answer = grounded_answer()
    answer['claims'][0][field] = value
    with pytest.raises(ValidationError):
        DocumentAnswer.model_validate(answer)


def test_blank_quote_is_not_evidence():
    answer = grounded_answer()
    answer['claims'][0]['citations'][0]['quote'] = '\n '
    with pytest.raises(ValidationError):
        DocumentAnswer.model_validate(answer)


def test_insufficient_evidence_has_no_claims():
    assert DocumentAnswer(status='insufficient_evidence').claims == []
