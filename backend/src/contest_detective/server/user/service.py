from .schemas import Profile, PublicUser


def create(session, username: str, password: str) -> PublicUser:
    raise NotImplementedError


def verify(session, username: str, password: str) -> PublicUser | None:
    raise NotImplementedError


def get(session, user_id: str) -> PublicUser | None:
    raise NotImplementedError


def confirm_profile(session, user_id: str, profile: Profile) -> PublicUser:
    raise NotImplementedError
