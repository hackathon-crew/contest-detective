from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from contest_detective.framework.db import get_session
from contest_detective.framework.result import Response
from contest_detective.system.user.guest import GuestQuestionQuota, GuestQuestions

router = APIRouter()


@router.get('/agent/guest-quota', response_model=Response[GuestQuestionQuota])
def guest_quota(request: Request, session: Session = Depends(get_session)):
    return Response.success(GuestQuestions(session).quota(request.client.host))
