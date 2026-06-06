import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context

# ── Alembic Config ─────────────────────────────────────────────────────────────
config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

# ── Import all models so autogenerate can detect them ─────────────────────────
from core.database import Base  # noqa: E402
import models  # noqa: E402, F401  — side-effect import registers all mappers

target_metadata = Base.metadata


# ── URL helper (postgres:// → postgresql+asyncpg://) ─────────────────────────
def _async_db_url(url: str) -> str:
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+asyncpg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+asyncpg://", 1)
    return url


# ── Offline mode ──────────────────────────────────────────────────────────────
def run_migrations_offline() -> None:
    from core.config import settings

    url = _async_db_url(settings.DATABASE_URL)
    context.configure(
        url=url,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


# ── Online (async) mode ───────────────────────────────────────────────────────
def do_run_migrations(connection):
    context.configure(connection=connection, target_metadata=target_metadata)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    from core.config import settings

    configuration = config.get_section(config.config_ini_section, {})
    configuration["sqlalchemy.url"] = _async_db_url(settings.DATABASE_URL)

    connectable = async_engine_from_config(
        configuration,
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )

    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)

    await connectable.dispose()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
