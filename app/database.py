import aiosqlite
import os
from datetime import datetime
from typing import Optional, Union

_DB_PATH = "chat_sessions.db"

def set_db_path(path: str):
    global _DB_PATH
    _DB_PATH = path

async def init_db(db_path: Optional[str] = None):
    target_path = db_path if db_path else _DB_PATH
    async with aiosqlite.connect(target_path) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                created_at DATETIME NOT NULL
            )
        """)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                role TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at DATETIME NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions (id) ON DELETE CASCADE
            )
        """)
        await db.commit()

async def create_session(name: str, db_path: Optional[str] = None) -> str:
    target_path = db_path if db_path else _DB_PATH
    # Ensure DB is initialized (important for ephemeral mode)
    await init_db(target_path)
    
    async with aiosqlite.connect(target_path) as db:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        import uuid
        session_id = str(uuid.uuid4())
        await db.execute(
            "INSERT INTO sessions (id, name, created_at) VALUES (?, ?, ?)",
            (session_id, name, now)
        )
        await db.commit()
        return session_id

async def get_sessions(db_path: Optional[str] = None) -> list:
    target_path = db_path if db_path else _DB_PATH
    if not os.path.exists(target_path):
        return []
    async with aiosqlite.connect(target_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT id, name, created_at FROM sessions ORDER BY created_at DESC") as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

async def update_session_name(session_id: str, new_name: str, db_path: Optional[str] = None):
    target_path = db_path if db_path else _DB_PATH
    async with aiosqlite.connect(target_path) as db:
        await db.execute("UPDATE sessions SET name = ? WHERE id = ?", (new_name, session_id))
        await db.commit()

async def delete_session(session_id: str, db_path: Optional[str] = None):
    target_path = db_path if db_path else _DB_PATH
    async with aiosqlite.connect(target_path) as db:
        await db.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
        await db.commit()

async def add_message(session_id: str, role: str, content: str, db_path: Optional[str] = None):
    target_path = db_path if db_path else _DB_PATH
    # Ensure DB is initialized (important for ephemeral mode)
    await init_db(target_path)
    async with aiosqlite.connect(target_path) as db:
        now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        await db.execute(
            "INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)",
            (session_id, role, content, now)
        )
        await db.commit()

async def get_messages(session_id: str, db_path: Optional[str] = None) -> list:
    target_path = db_path if db_path else _DB_PATH
    if not os.path.exists(target_path):
        return []
    async with aiosqlite.connect(target_path) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT role, content, created_at FROM messages WHERE session_id = ? ORDER BY created_at ASC",
            (session_id,)
        ) as cursor:
            rows = await cursor.fetchall()
            return [dict(row) for row in rows]

async def init_db_from_main(db_path: Optional[str] = None):
    await init_db(db_path)
