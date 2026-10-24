"""结构化赛事归一化的 prompt 和 LangChain 消息构造。"""

from pathlib import Path

from jinja2 import Environment, FileSystemLoader, StrictUndefined
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage

from contest_detective.server.research_pipeline.normalization import NormalizationInput


DEFAULT_PROMPT_PATH = 'templates/contest_normalization.jinja2'


def load_prompt(path: str | None = None):
    """从配置路径加载严格模板；相对路径默认相对 agent 包目录。"""
    configured = path or DEFAULT_PROMPT_PATH
    candidate = Path(configured)
    if candidate.is_file():
        return Environment(undefined=StrictUndefined).from_string(
            candidate.read_text(encoding='utf-8'),
        )
    base = Path(__file__).resolve().parent
    package_candidate = base / configured
    if package_candidate.is_file():
        return Environment(undefined=StrictUndefined).from_string(
            package_candidate.read_text(encoding='utf-8'),
        )
    relative = configured.removeprefix('templates/')
    return Environment(
        loader=FileSystemLoader(base / 'templates'),
        undefined=StrictUndefined,
    ).get_template(relative)


def build_messages(
    item: NormalizationInput,
    *,
    prompt_path: str | None = None,
) -> list[BaseMessage]:
    """为单场赛事构造隔离的 system/user 消息。"""
    system = load_prompt(prompt_path).render()
    claims = '\n'.join(
        f'- {claim.field}: {claim.value}（精度：{claim.precision}，来源：{item.draft.page.url}）'
        for claim in item.draft.claims
    ) or '（适配器没有已映射字段）'
    human = (
        f'赛事名称：{item.draft.name}\n'
        f'适配器已映射字段：\n{claims}\n'
        f'上下文来源：{item.context_url}\n'
        f'上下文正文：\n{item.context}'
    )
    return [
        SystemMessage(content=system),
        HumanMessage(content=human),
    ]
