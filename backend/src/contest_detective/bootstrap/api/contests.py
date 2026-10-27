from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from contest_detective.framework.exceptions import BizException
from contest_detective.framework.result import ListResponse, Response
from contest_detective.framework.db import get_session
from contest_detective.contest import service
from contest_detective.contest.schemas import ContestDetail, ContestQuery, ContestStatus, ContestSummary

router = APIRouter()


@router.get('/contests', response_model=ListResponse[ContestSummary])
def list_contests(keyword: str | None = None, status: ContestStatus | None = None,
                  mode: Literal['online', 'offline', 'hybrid'] | None = None,
                  date_from: datetime | None = None, date_to: datetime | None = None,
                  ids: str | None = None, sort: Literal['deadline', 'start'] = 'deadline',
                  page: int = 1, page_size: int = 20, session: Session = Depends(get_session)):
    from pydantic import ValidationError
    try:
        q = ContestQuery(keyword=keyword, status=status, mode=mode, date_from=date_from, date_to=date_to,
                         ids=ids.split(',') if ids is not None else None, sort=sort, page=page, page_size=page_size)
    except ValidationError as exc:
        raise BizException('筛选条件无效', code=400) from exc
    items, total = service.query(session, q)
    return ListResponse.success(items, total=total, page=q.page, page_size=q.page_size)


@router.get('/contests/{contest_id}', response_model=Response[ContestDetail])
def contest_detail(contest_id: str, session: Session = Depends(get_session)):
    item = service.get(session, contest_id)
    if item is None:
        raise BizException('比赛不存在', code=404)
    return Response.success(item)
