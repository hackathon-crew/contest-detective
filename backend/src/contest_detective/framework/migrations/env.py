from alembic import context

from contest_detective.framework.db import Base, engine, load_models

load_models()
config = context.config


def migrate(connection):
    context.configure(connection=connection, target_metadata=Base.metadata, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


if context.is_offline_mode():
    context.configure(url=str(engine.url), target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
elif (connection := config.attributes.get('connection')) is not None:
    migrate(connection)
else:
    with engine.connect() as connection:
        migrate(connection)
