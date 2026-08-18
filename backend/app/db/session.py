from collections.abc import AsyncGenerator

from sqlalchemy import event, select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.models import Base, FloorMapRecord

settings = get_settings()

_is_sqlite = settings.database_url.startswith("sqlite")
engine = create_async_engine(
    settings.database_url,
    echo=False,
    connect_args={"timeout": 30} if _is_sqlite else {},
    pool_pre_ping=True,
)

if _is_sqlite:

    @event.listens_for(engine.sync_engine, "connect")
    def _sqlite_pragma(dbapi_connection, _connection_record):  # type: ignore[no-untyped-def]
        try:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA busy_timeout=5000")
            cursor.execute("PRAGMA synchronous=NORMAL")
            cursor.close()
        except Exception:
            pass

SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def _ensure_sqlite_columns() -> None:
    """Best-effort ALTER for existing SQLite DBs (create_all does not add columns)."""
    alters = [
        ("devices", "map_id", "INTEGER"),
        ("devices", "zone_id", "VARCHAR(64)"),
        ("devices", "disable", "VARCHAR(16)"),
        ("devices", "model", "VARCHAR(64)"),
        ("devices", "link", "VARCHAR(8) DEFAULT ''"),
        ("devices", "map_icon", "VARCHAR(64) DEFAULT ''"),
        ("devices", "map_icon_size", "FLOAT DEFAULT 2.0"),
        ("devices", "reaction", "VARCHAR(32) DEFAULT 'instant'"),
        ("panels", "stream_code", "VARCHAR(32)"),
        ("automation_rules", "if_require_armed", "BOOLEAN DEFAULT 0"),
    ]
    async with engine.begin() as conn:
        for table, column, coltype in alters:
            rows = await conn.execute(text(f"PRAGMA table_info({table})"))
            existing = {r[1] for r in rows.fetchall()}
            if column not in existing:
                await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {coltype}"))


async def seed_default_map() -> None:
    async with SessionLocal() as session:
        result = await session.execute(select(FloorMapRecord).limit(1))
        if result.scalar_one_or_none() is None:
            session.add(
                FloorMapRecord(
                    name="Mặt bằng chính",
                    description="Bản đồ mặc định",
                    width=100.0,
                    height=70.0,
                )
            )
            await session.commit()


async def init_db() -> None:
    settings.hwid_cache_path.parent.mkdir(parents=True, exist_ok=True)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    try:
        await _ensure_sqlite_columns()
    except Exception:
        pass
    await seed_default_map()


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    async with SessionLocal() as session:
        yield session
