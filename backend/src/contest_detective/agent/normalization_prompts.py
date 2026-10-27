"""结构化赛事归一化的 prompt 和 LangChain 消息构造。"""

from pathlib import Path
import json

from jinja2 import Environment, FileSystemLoader, StrictUndefined
from langchain_core.messages import BaseMessage, HumanMessage, SystemMessage

from contest_detective.research.normalization import NormalizationInput

from .normalization_models import NormalizedContest


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
    if item.allow_conflicts:
        system += ('\n本次包含多个已读取的详情或规则正文。覆盖前述沿用旧字段规则：'
                   '若正文明确给出与已有字段不同的事实，也返回独立 claim，保留所有互相矛盾的原文。'
                   '不选择赢家，不隐去官方之间的冲突，不拼接跨文档 excerpt。')
    system += '\n输出 JSON Schema：\n' + json.dumps(NormalizedContest.model_json_schema(), ensure_ascii=False)
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
