import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker, DeclarativeBase, Mapped, mapped_column
from sqlalchemy import String, JSON, Integer, Text, DateTime
from datetime import datetime

DATABASE_URL = os.getenv("DATABASE_URL")
if DATABASE_URL and DATABASE_URL.startswith("postgresql+") and "+psycopg2" in DATABASE_URL:
    # Convert sync psycopg2 URL to async driver (psycopg)
    DATABASE_URL_ASYNC = DATABASE_URL.replace("+psycopg2", "+psycopg")
else:
    # Allow already-async URLs
    DATABASE_URL_ASYNC = DATABASE_URL


class Base(DeclarativeBase):
    pass


class Generation(Base):
    __tablename__ = "generations"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    s3_key: Mapped[str] = mapped_column(String(512), nullable=False)
    pose: Mapped[str] = mapped_column(String(64), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    options_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class EnvSource(Base):
    __tablename__ = "env_sources"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    s3_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class ModelDefault(Base):
    __tablename__ = "model_defaults"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    gender: Mapped[str] = mapped_column(String(16), nullable=False, unique=True)  # one per gender
    s3_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class ModelSource(Base):
    __tablename__ = "model_sources"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    gender: Mapped[str] = mapped_column(String(16), nullable=False)
    s3_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class ModelDescription(Base):
    __tablename__ = "model_descriptions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    s3_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class PoseSource(Base):
    __tablename__ = "pose_sources"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    s3_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class PoseDescription(Base):
    __tablename__ = "pose_descriptions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    s3_key: Mapped[str] = mapped_column(String(512), nullable=False, unique=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class ProductDescription(Base):
    __tablename__ = "product_descriptions"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(128), nullable=True, index=True)
    s3_key: Mapped[str] = mapped_column(String(512), nullable=False)
    gender: Mapped[str] = mapped_column(String(16), nullable=True)
    brand: Mapped[str] = mapped_column(String(128), nullable=True)
    model: Mapped[str] = mapped_column(String(256), nullable=True)
    size: Mapped[str] = mapped_column(String(64), nullable=True)
    condition: Mapped[str] = mapped_column(String(256), nullable=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


# Per-user environment defaults table.
class EnvDefaultUser(Base):
    __tablename__ = "env_defaults_user"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(String(128), nullable=False, index=True)
    s3_key: Mapped[str] = mapped_column(String(512), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


# Listings group a source garment image, settings, description, and generated images
class Listing(Base):
    __tablename__ = "listings"
    # Use a hex uuid string as primary key for easy client routing
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(128), index=True, nullable=False)
    source_s3_key: Mapped[str] = mapped_column(String(512), nullable=False)
    settings_json: Mapped[dict] = mapped_column(JSON, nullable=False)
    description_text: Mapped[str | None] = mapped_column(Text, nullable=True)
    cover_s3_key: Mapped[str | None] = mapped_column(String(512), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


class ListingImage(Base):
    __tablename__ = "listing_images"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    listing_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    s3_key: Mapped[str] = mapped_column(String(512), nullable=False)
    pose: Mapped[str] = mapped_column(String(64), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=datetime.utcnow, nullable=False)


_engine: AsyncEngine | None = None
_SessionFactory: sessionmaker | None = None


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        if not DATABASE_URL_ASYNC:
            raise RuntimeError("DATABASE_URL not configured")
        _engine = create_async_engine(DATABASE_URL_ASYNC, pool_pre_ping=True)
    return _engine


def get_sessionmaker() -> sessionmaker:
    global _SessionFactory
    if _SessionFactory is None:
        _SessionFactory = sessionmaker(bind=get_engine(), class_=AsyncSession, expire_on_commit=False)
    return _SessionFactory


@asynccontextmanager
async def db_session() -> AsyncIterator[AsyncSession]:
    session = get_sessionmaker()()
    try:
        yield session
        await session.commit()
    except Exception:
        await session.rollback()
        raise
    finally:
        await session.close()


async def init_db() -> None:
    engine = get_engine()
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
