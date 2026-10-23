def register(session, username: str, password: str):
    raise NotImplementedError


def login(session, username: str, password: str):
    raise NotImplementedError


def logout(session, token: str) -> None:
    raise NotImplementedError


def current(request) -> str | None:
    raise NotImplementedError
