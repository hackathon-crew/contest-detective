"""LangChain 结构化赛事归一化的模型输出。"""

from pydantic import BaseModel, Field

from contest_detective.research.claims import ExtractedClaims


class NormalizedContest(BaseModel):
    """模型只返回可补全的赛事字段，不负责页面身份和数据库写入。"""

    name: str = Field(min_length=1, max_length=500)
    cover_url: str | None = None
    summary: str | None = None
    claims: ExtractedClaims = Field(default_factory=list)
