from sqlalchemy.orm import Session

from .schemas import ContestDetail, ContestDraft, ContestQuery, ContestSummary


def save(session: Session, draft: ContestDraft) -> str:
    raise NotImplementedError


def query(session: Session, q: ContestQuery) -> tuple[list[ContestSummary], int]:
    raise NotImplementedError


def get(session: Session, contest_id: str) -> ContestDetail | None:
    raise NotImplementedError
