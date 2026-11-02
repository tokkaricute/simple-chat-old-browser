import datetime
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, HTTPException, Body
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import json
import os
import tempfile
import uuid

from app.config_loader import load_config, AppConfig
from app.database import (
    init_db_from_main, 
    create_session, 
    get_sessions, 
    update_session_name, 
    delete_session, 
    add_message, 
    get_messages,
    set_db_path
)
from app.llm_service import LLMService
from app.models import ChatRequest, Session, Message

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup logic
    db_path = getattr(app.state, 'db_path', None)
    mode = getattr(app.state, 'mode', 'persistent')
    
    if mode == 'persistent':
        if db_path:
            set_db_path(db_path)
            await init_db_from_main()
    else:
        # ephemeral mode doesn't need a central DB to init at startup.
        pass
    
    yield
    
    # Shutdown logic: Remove temp file if it was created for in-memory mode
    if mode == 'persistent' and getattr(app.state, 'is_temp', False) and db_path:
        if os.path.exists(db_path):
            try:
                os.remove(db_path)
            except Exception as e:
                print(f'Error removing temporary database file: {e}')

app = FastAPI(lifespan=lifespan)

# Load configuration
config: AppConfig = load_config()

# Setup static files
app.mount('/static', StaticFiles(directory='static'), name='static')

# Initialize LLM service
llm_service = LLMService(config.api_url)

def get_db_path_for_request(request: Request, session_id: str) -> str:
    mode = getattr(app.state, 'mode', 'persistent')
    if mode == 'ephemeral':
        # For ephemeral mode, use a session-specific temp file in the OS-specific temp directory.
        return os.path.join(tempfile.gettempdir(), f'chat_ephemeral_{session_id}.db')
    else:
        return getattr(app.state, 'db_path', 'chat_sessions.db')

@app.get('/', response_class=HTMLResponse)
async def read_root():
    return FileResponse('templates/index.html')

@app.get('/api/config')
async def api_get_config():
    mode = getattr(app.state, 'mode', 'persistent')
    return {
        **config.model_dump(),
        'mode': mode
    }
@app.get("/api/sessions")
async def api_get_sessions(request: Request):
    mode = getattr(app.state, "mode", "persistent")
    if mode == "ephemeral":
        return []
    
    db_path = getattr(app.state, "db_path", None)
    sessions = await get_sessions(db_path=db_path)
    return sessions

@app.post("/api/sessions")
async def api_create_session(request: Request):
    mode = getattr(app.state, "mode", "persistent")
    if mode == "ephemeral":
        new_id = str(uuid.uuid4())
        return {"id": new_id, "name": f"Temporary Session {new_id[:8]}"}

    db_path = getattr(app.state, "db_path", None)
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    name = f"対話 {now}"
    session_id = await create_session(name, db_path=db_path)
    return {"id": session_id, "name": name}

@app.patch("/api/sessions/{session_id}")
async def api_update_session(request: Request, session_id: str, name: str = Body(..., embed=True)):
    mode = getattr(app.state, "mode", "persistent")
    if mode == "ephemeral":
        return {"status": "success"}

    db_path = getattr(app.state, "db_path", None)
    await update_session_name(session_id, name, db_path=db_path)
    return {"status": "success"}

@app.delete("/api/sessions/{session_id}")
async def api_delete_session(request: Request, session_id: str):
    mode = getattr(app.state, "mode", "persistent")
    if mode == "ephemeral":
        return {"status": "success"}

    db_path = getattr(app.state, "db_path", None)
    await delete_session(session_id, db_path=db_path)
    return {"status": "success"}

@app.get("/api/sessions/{session_id}/messages")
async def api_get_messages(request: Request, session_id: str):
    db_path = get_db_path_for_request(request, session_id)
    messages = await get_messages(session_id, db_path=db_path)
    return messages

@app.get("/api/models")
async def api_get_models():
    models = await llm_service.get_models()
    return {"models": models}

@app.post("/api/chat")
async def api_chat(request: Request, chat_request: ChatRequest):
    db_path = get_db_path_for_request(request, str(chat_request.session_id))
    await add_message(chat_request.session_id, "user", chat_request.message, db_path=db_path)

    llm_messages = []
    system_prompt_content = ""
    if chat_request.system_prompt:
        if chat_request.system_prompt in config.system_prompts:
            system_prompt_content = config.system_prompts[chat_request.system_prompt].content
        else:
            system_prompt_content = chat_request.system_prompt

    if system_prompt_content:
        llm_messages.append({"role": "system", "content": system_prompt_content})

    history = await get_messages(chat_request.session_id, db_path=db_path)
    for msg in history:
        llm_messages.append({"role": msg["role"], "content": msg["content"]})

    async def streaming_with_saving(session_id: str, model: str, messages: list):
        full_response = ""
        async for chunk in llm_service.stream_chat(model, messages):
            full_response += chunk
            yield chunk
        
        if full_response:
            await add_message(session_id, "assistant", full_response, db_path=db_path)

    return StreamingResponse(
        streaming_with_saving(str(chat_request.session_id), chat_request.model or config.default_llm_model, llm_messages),
        media_type="text/event-stream"
    )

if __name__ == "__main__":
    import argparse
    import uvicorn

    parser = argparse.ArgumentParser()
    parser.add_argument("--db", nargs="?", const="chat_sessions.db", default=None)
    args = parser.parse_args()

    if args.db is None:
        app.state.mode = "ephemeral"
    else:
        app.state.mode = "persistent"
        app.state.db_path = args.db

    uvicorn.run(app, host="0.0.0.0", port=config.port)


