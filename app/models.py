from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class Message(BaseModel):
    role: str
    content: str
    created_at: Optional[str] = None

class Session(BaseModel):
    id: int
    name: str
    created_at: str

class ChatRequest(BaseModel):
    session_id: int
    message: str
    system_prompt: Optional[str] = None
    model: Optional[str] = None

class ChatResponse(BaseModel):
    role: str
    content: str
