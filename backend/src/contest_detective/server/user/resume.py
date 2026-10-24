import asyncio
from io import BytesIO
from pathlib import PurePath
from zipfile import BadZipFile, ZipFile

from markitdown import MarkItDown, StreamInfo
from markitdown.converters import DocxConverter, PdfConverter, PlainTextConverter
from pydantic_ai import Agent, UsageLimits

from contest_detective.common.exceptions import BizException

from .schemas import Profile

MAX_BYTES = 2 * 1024 * 1024
MAX_TEXT = 16000
MAX_UNPACKED_BYTES = 20 * 1024 * 1024


def _text(content: bytes, extension: str) -> str:
    if extension == '.docx':
        try:
            with ZipFile(BytesIO(content)) as archive:
                entries = archive.infolist()
                if len(entries) > 1000 or sum(entry.file_size for entry in entries) > MAX_UNPACKED_BYTES:
                    raise BizException('简历文档解压后过大', code=400)
                if 'word/document.xml' not in archive.namelist():
                    raise BizException('无法读取这份 Word 文档', code=400)
        except BadZipFile:
            raise BizException('无法读取这份 Word 文档', code=400) from None
    converter = MarkItDown(enable_builtins=False, enable_plugins=False)
    # 只注册本地文档转换器，不能启用网页、音视频、远程 OCR 或图片描述链路。
    converter.register_converter({'.pdf': PdfConverter, '.docx': DocxConverter, '.txt': PlainTextConverter}[extension]())
    try:
        result = converter.convert_stream(BytesIO(content), stream_info=StreamInfo(extension=extension))
    except Exception:
        raise BizException('简历无法读取，请换成可复制文字的 PDF、DOCX 或 TXT', code=400) from None
    return result.text_content.strip()[:MAX_TEXT]


def create_profile_extractor(*, model_factory, manage_model=False):
    # 注入模型可复用；只有请求自行创建的客户端随本次抽取释放。
    async def extract(text: str) -> Profile:
        model = model_factory()
        agent = Agent(model, output_type=Profile, retries=0,
            instructions='仅提取用户提供简历中的技能、身份、城市和可投入时间，未知字段保留默认空值。'
                         '不要输出姓名、电话、邮箱、地址等联系信息。不得编造 GitHub 仓库证据。'
                         '只有原文明确给出时间与时区才填写 availability.windows；自然语言放 available_time 供用户确认。')
        if manage_model:
            async with agent:
                result = await agent.run(text, usage_limits=UsageLimits(request_limit=1))
        else:
            result = await agent.run(text, usage_limits=UsageLimits(request_limit=1))
        profile = result.output
        # 简历输入不能伪造公开接口提供的仓库证据。
        return profile.model_copy(update={'github_evidence': [], 'language_repo_share': {}, 'github_last_active_at': None})
    return extract


async def parse_resume(content: bytes, *, filename: str, extractor) -> Profile:
    if len(content) > MAX_BYTES:
        raise BizException('简历不能超过 2MiB', code=400)
    extension = PurePath(filename).suffix.lower()
    if extension not in {'.pdf', '.docx', '.txt'}:
        raise BizException('请上传 PDF、DOCX 或 TXT 简历', code=400)
    text = await asyncio.to_thread(_text, content, extension)
    if not text:
        raise BizException('简历没有可读取的文字，请上传文字版文件', code=400)
    try:
        profile = await extractor(text)
        return profile.model_copy(update={'skill_sources': {skill: ['resume'] for skill in profile.skills},
                                          'resume_name': filename})
    except BizException:
        raise
    except Exception:
        raise BizException('简历画像暂时无法生成，请稍后重试', code=503) from None
    finally:
        text = ''
