import json

from fastapi import APIRouter
from fastapi.responses import StreamingResponse

from contest_detective.server.agent.loop import ask
from contest_detective.server.agent.schemas import AskRequest

router = APIRouter()


@router.post('/agent/ask', response_class=StreamingResponse, responses={200: {'content': {'text/event-stream': {}}}})
def ask_question(body: AskRequest):
    def stream():
        for event in ask(body.question):
            yield f'event: {event.type}\ndata: {json.dumps(event.payload, ensure_ascii=False)}\n\n'
    return StreamingResponse(stream(), media_type='text/event-stream', headers={'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no'})
