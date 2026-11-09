"""Issue the first registration invite from a configured server shell."""

from contest_detective.framework.db import SessionLocal
from contest_detective.system.auth.invites import issue


def main() -> None:
    with SessionLocal() as session:
        print(issue(session))


if __name__ == '__main__':
    main()
