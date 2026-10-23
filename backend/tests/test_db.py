from sqlalchemy import Column, Integer, Table, inspect, select

from contest_detective.framework.db import Base, init_db


def test_initialize_tables_in_the_requested_engine(session):
    table = Table("fixture_probe", Base.metadata, Column("id", Integer, primary_key=True))
    try:
        init_db(session.get_bind())
        assert "fixture_probe" in inspect(session.get_bind()).get_table_names()
        session.execute(table.insert().values(id=7))
        session.commit()
        assert session.execute(select(table.c.id)).scalar_one() == 7
    finally:
        table.drop(session.get_bind())
        Base.metadata.remove(table)


def test_health_uses_isolated_app(client):
    assert client.get("/health").json()["data"] == {"status": "ok"}
