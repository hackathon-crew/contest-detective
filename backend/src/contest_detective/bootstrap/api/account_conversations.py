from fastapi import APIRouter, Depends, Response as HttpResponse
from sqlalchemy.orm import Session

from contest_detective.agent.chat.contracts import ClientId, ConversationImport, SavedConversation
from contest_detective.agent.chat.service import SqlConversationStore
from contest_detective.framework.db import get_session
from contest_detective.framework.result import Response
from contest_detective.system.auth.service import require_user

def private_response(response: HttpResponse):
    response.headers['Cache-Control'] = 'private, no-store'


router = APIRouter(dependencies=[Depends(private_response)])


@router.get('/account/conversations', response_model=Response[list[SavedConversation]])
def list_conversations(user_id: str = Depends(require_user), session: Session = Depends(get_session)):
    return Response.success(SqlConversationStore(session, user_id).list_sessions())


@router.get('/account/conversations/{conversation_id}', response_model=Response[SavedConversation])
def read_conversation(conversation_id: ClientId, user_id: str = Depends(require_user), session: Session = Depends(get_session)):
    return Response.success(SqlConversationStore(session, user_id).get(conversation_id))


@router.post('/account/conversations/import', response_model=Response[None])
def import_conversations(body: ConversationImport, user_id: str = Depends(require_user), session: Session = Depends(get_session)):
    SqlConversationStore(session, user_id).import_sessions(body.sessions)
    session.commit()
    return Response.success()
