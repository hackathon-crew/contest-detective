import asyncio
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import httpx
import pytest
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from contest_detective.framework.exceptions import BizException


def test_github_profile_uses_two_public_requests_and_repository_count_shares():
    from contest_detective.system.user.github import build_github_profile
    seen = []

    def handler(request):
        seen.append(request)
        if request.url.path == '/users/octocat':
            return httpx.Response(200, json={'login': 'octocat', 'type': 'User'})
        assert request.url.path == '/users/octocat/repos'
        assert request.url.params['per_page'] == '100'
        assert request.url.params['sort'] == 'pushed'
        return httpx.Response(200, json=[
            {'name': 'one', 'html_url': 'https://github.com/octocat/one', 'language': 'Python', 'topics': ['agent'], 'pushed_at': '2026-10-20T01:00:00Z'},
            {'name': 'two', 'html_url': 'https://github.com/octocat/two', 'language': 'Python', 'topics': ['llm'], 'pushed_at': '2026-10-22T01:00:00Z'},
            {'name': 'three', 'html_url': 'https://github.com/octocat/three', 'language': 'TypeScript', 'topics': ['agent'], 'pushed_at': '2026-10-21T01:00:00Z'},
        ])

    async def run():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            return await build_github_profile('octocat', client=client, token='test-token')

    profile = asyncio.run(run())
    assert len(seen) == 2
    assert all(request.headers['Authorization'] == 'Bearer test-token' for request in seen)
    assert profile.language_repo_share == {'Python': 2 / 3, 'TypeScript': 1 / 3}
    assert set(profile.skills) == {'Python', 'TypeScript'}
    assert set(profile.topics) == {'agent', 'llm'}
    assert profile.github_last_active_at.isoformat() == '2026-10-22T01:00:00+00:00'
    assert profile.availability.weekdays == []
    assert profile.identity_kind is None


def test_github_missing_and_rate_limited_users_return_business_errors():
    from contest_detective.system.user.github import build_github_profile

    async def run(status):
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda request: httpx.Response(status))) as client:
            await build_github_profile('octocat', client=client)

    for status, code in [(404, 404), (403, 429)]:
        with pytest.raises(BizException) as error:
            asyncio.run(run(status))
        assert error.value.code == code


def docx(text):
    output = BytesIO()
    with ZipFile(output, 'w', ZIP_DEFLATED) as archive:
        archive.writestr('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
        archive.writestr('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
        archive.writestr('word/document.xml', f'<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body></w:document>')
    return output.getvalue()


def test_plaintext_and_docx_convert_in_memory_then_extract_only_profile_fields(tmp_path, monkeypatch):
    from contest_detective.system.user.resume import create_profile_extractor, parse_resume
    monkeypatch.chdir(tmp_path)
    seen = []

    def model(messages, info):
        text = str(messages[-1].parts)
        seen.append(text)
        assert 'Python' in text
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name,
            {'skills': ['Python'], 'identity_kind': 'student', 'city': '北京'})])

    extractor = create_profile_extractor(model_factory=lambda: FunctionModel(model))
    for filename, payload in [('resume.txt', b'Python student'), ('resume.docx', docx('Python student'))]:
        result = asyncio.run(parse_resume(payload, filename=filename, extractor=extractor))
        assert result.skills == ['Python']
        assert result.identity_kind == 'student'
        assert result.github is None
    assert len(seen) == 2
    assert list(tmp_path.iterdir()) == []


def test_resume_rejects_large_unsupported_and_expanding_archives_before_extraction():
    from contest_detective.system.user.resume import parse_resume

    async def extractor(text):
        pytest.fail('不应调用抽取')

    for filename, payload in [('resume.txt', b'x' * (2 * 1024 * 1024 + 1)), ('resume.exe', b'data'),
                              ('resume.docx', docx('x' * (20 * 1024 * 1024 + 1)))]:
        with pytest.raises(BizException):
            asyncio.run(parse_resume(payload, filename=filename, extractor=extractor))


def test_resume_text_sent_to_extractor_is_bounded():
    from contest_detective.system.user.resume import parse_resume
    from contest_detective.system.user.schemas import Profile
    seen = []

    async def extractor(text):
        seen.append(text)
        return Profile(skills=['Python'])

    asyncio.run(parse_resume(('Python ' * 10000).encode(), filename='resume.txt', extractor=extractor))
    assert len(seen[0]) <= 16000


def pdf():
    stream = b'BT /F1 12 Tf 72 720 Td (Python student) Tj ET'
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
        b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
        b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
        b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream']
    output = bytearray(b'%PDF-1.4\n')
    offsets = [0]
    for number, value in enumerate(objects, 1):
        offsets.append(len(output))
        output.extend(str(number).encode() + b' 0 obj\n' + value + b'\nendobj\n')
    offset = len(output)
    output.extend(b'xref\n0 6\n0000000000 65535 f \n')
    for value in offsets[1:]:
        output.extend(f'{value:010d} 00000 n \n'.encode())
    output.extend(b'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + str(offset).encode() + b'\n%%EOF\n')
    return bytes(output)


def test_pdf_uses_the_local_converter_and_does_not_write_raw_files(tmp_path, monkeypatch):
    from contest_detective.system.user.resume import parse_resume
    from contest_detective.system.user.schemas import Profile
    monkeypatch.chdir(tmp_path)
    seen = []

    async def extractor(text):
        seen.append(text)
        return Profile(skills=['Python'])

    result = asyncio.run(parse_resume(pdf(), filename='resume.pdf', extractor=extractor))
    assert 'Python student' in seen[0]
    assert result.skills == ['Python']
    assert list(tmp_path.iterdir()) == []
