import pytest
from services.csv_provisioner import provision_users_from_csv


class _Savepoint:
    """Async context manager pretending to be a SQLAlchemy SAVEPOINT."""
    async def __aenter__(self):
        return self
    async def __aexit__(self, exc_type, exc, tb):
        return False  # never swallow


class MockSession:
    def __init__(self):
        self.added = []

    def add(self, item):
        self.added.append(item)

    def begin_nested(self):
        return _Savepoint()

    async def flush(self):
        pass

    async def commit(self):
        pass


@pytest.mark.asyncio
async def test_provision_users_from_csv_success():
    csv_data = """name,email
Alice,alice@example.com
Bob,bob@example.com"""

    mock_db = MockSession()
    results = await provision_users_from_csv(mock_db, csv_data)

    assert len(results) == 2
    assert results[0]['email'] == 'alice@example.com'
    assert results[0]['status'] == 'created'
    assert 'temp_password' in results[0]
    assert results[1]['email'] == 'bob@example.com'

    assert len(mock_db.added) == 2
    assert mock_db.added[0].display_name == 'Alice'
    assert mock_db.added[1].display_name == 'Bob'


@pytest.mark.asyncio
async def test_provision_users_empty_rows():
    csv_data = """name,email
Alice,alice@example.com
,
Charlie,charlie@example.com"""

    mock_db = MockSession()
    results = await provision_users_from_csv(mock_db, csv_data)

    assert len(results) == 2
    assert results[0]['email'] == 'alice@example.com'
    assert results[1]['email'] == 'charlie@example.com'


@pytest.mark.asyncio
async def test_provision_users_duplicate_email_skips_only_dup_row():
    """A duplicate-email IntegrityError on row N must not abort row N+1."""
    from sqlalchemy.exc import IntegrityError

    class DupOnceSession(MockSession):
        """Raises IntegrityError on flush() for the second .add() call only."""
        def __init__(self):
            super().__init__()
            self._dup_target_idx = 1  # 0-indexed: second row

        async def flush(self):
            if len(self.added) - 1 == self._dup_target_idx:
                # Simulate Postgres unique-violation; SQLAlchemy would raise IntegrityError.
                raise IntegrityError("duplicate", params=None, orig=Exception("unique violation"))

    csv_data = """name,email
Alice,alice@example.com
Bob,bob@example.com
Charlie,charlie@example.com"""

    mock_db = DupOnceSession()
    results = await provision_users_from_csv(mock_db, csv_data)

    assert len(results) == 3
    assert results[0]['status'] == 'created'
    assert results[1]['status'] == 'skipped_duplicate'
    assert results[1]['temp_password'] is None
    assert results[2]['status'] == 'created'
