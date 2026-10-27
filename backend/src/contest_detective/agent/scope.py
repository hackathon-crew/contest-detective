"""Check public-data boundaries without an extra model preflight."""
from .verification import scope_check


async def classify_scope(model, text, *, context_question='', usage=None, usage_limits=None):
    return scope_check(text, require_contest=False, context_question=context_question)
