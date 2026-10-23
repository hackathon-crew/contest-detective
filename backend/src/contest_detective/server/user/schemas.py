from pydantic import BaseModel, Field


class Profile(BaseModel):
    skills: list[str] = Field(default_factory=list)
    identity: str | None = None
    available_time: str | None = None
    city: str | None = None
    github: str | None = None


class PublicUser(BaseModel):
    id: str
    username: str
    profile: Profile
