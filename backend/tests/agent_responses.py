from pydantic_ai.messages import ToolCallPart


def answer_part(content, recommendations=None):
    return ToolCallPart('respond_to_user', {
        'content': content,
        'recommendations': recommendations or [],
    })
