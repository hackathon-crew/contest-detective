from datetime import date
import importlib

import pytest
from pydantic import ValidationError
from sqlalchemy import create_engine, inspect

from contest_detective.framework.db import init_db


def test_account_storage_is_migrated_with_owner_constraints(tmp_path):
    engine = create_engine(f'sqlite:///{tmp_path / "account.db"}')
    init_db(engine)
    inspector = inspect(engine)
    assert {'account_settings', 'account_follows', 'account_tracks', 'account_mail',
            'personal_tokens', 'email_changes'} <= set(inspector.get_table_names())
    for table in ('account_settings', 'account_follows', 'account_tracks', 'account_mail',
                  'personal_tokens', 'email_changes'):
        assert any(key['referred_table'] == 'users' for key in inspector.get_foreign_keys(table))
    assert 'token' not in {col['name'] for col in inspector.get_columns('personal_tokens')}
    init_db(engine)
    engine.dispose()


def test_push_and_tracking_contracts_reject_ambiguous_values():
    schemas = importlib.import_module('contest_detective.system.account.schemas')
    with pytest.raises(ValidationError):
        schemas.PushSettings(time='25:00')
    with pytest.raises(ValidationError):
        schemas.TrackingConditions(deadline_from=date(2027, 2, 1), deadline_to=date(2027, 1, 1))
    with pytest.raises(ValidationError):
        schemas.TrackingConditions(unsupported_guess=True)
    assert schemas.PushSettings().timezone == 'Asia/Shanghai'
