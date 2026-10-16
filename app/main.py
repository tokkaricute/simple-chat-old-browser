import datetime
from fastapi import FastAPI, Request, HTTPException, Body
from fastapi.responses import HTMLResponse, StreamingResponse, FileResponse
from fastapi.staticfiles import StaticFiles
import json
import os

from app.config_loader import load_config, AppConfig
from app.database import init_db_from_main, create_session, get_sessions, update_session_name, delete_session, add_message, get_messages
from app.llm_service import LLMService
from app.models import ChatRequest, Session, Message

app = FastAPI()

# Load configuration
config: AppConfig = load_config()

# Setup static files
# We serve the HTML file directly via FileResponse to avoid any Jinja2 issues.
app.mount("/static", StaticFiles(directory="static"), name="static")

# Initialize LLM service
llm_service = LLMService(config.api_url)

@app.on_event("startup")
async def startup_event():
    await init_db_from_main()

@app.get("/", response_class=HTMLResponse)
async def read_root():
    # Bypass Jinja2 entirely to avoid 'unhashable type: dict' errors.
    # The client (main.js) will fetch config via /api/config.
    return FileResponse("templates/index.html")

@app.get("/api/config")
async def api_get_config():
    # Return config as a plain dictionary for the frontend to consume via fetch()
    return config.model_dump()

@app.get("/api/sessions")
async def api_get_sessions():
    sessions = await get_sessions()
    return sessions

@app.post("/api/sessions")
async def api_create_session():
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    name = f"対話 {now}"
    session_id = await create_session(name)
    return {"id": session_id, "name": name}

@app.patch("/api/sessions/{session_id}")
async def api_update_session(session_id: int, name: str = Body(..., embed=True)):
    await update_session_name(session_id, name)
    return {"status": "success"}

@app.delete("/api/sessions/{session_id}")
async def api_delete_session(session_id: int):
    await delete_session(session_id)
    return {"status": "success"}

@app.get("/api/sessions/{session_id}/messages")
async def api_get_messages(session_id: int):
    messages = await get_messages(session_id)
    return messages

@app.get("/api/models")
async def api_get_models():
    models = await llm_service.get_models()
    return {"models": models}

@app.post("/api/chat")
async def api_chat(request: ChatRequest):
    # 1. Save the user message to the database IMMEDIATELY to ensure it's recorded
    await add_message(request.session_id, "user", request.message)

    # 2. Prepare messages for LLM (including system prompt if provided)
    llm_messages = []
    
    # If a specific system prompt is requested by name from config, or if provided in request
    system_prompt_content = ""
    if request.system_prompt:
        # Use the provided content directly if it's a full prompt, 
        # or look it up in config if it's a name.
        if request.system_prompt in config.system_prompts:
            system_prompt_content = config.system_prompts[request.system_prompt].content
        else:
            system_prompt_content = request.system_prompt

    if system_prompt_content:
        llm_messages.append({"role": "system", "content": system_prompt_content})

    # Add existing chat history to LLM context.
    history = await get_messages(request.session_id)
    for msg in history:
        llm_messages.append({"role": msg["role"], "content": msg["content"]})

    # 3. Define the streaming generator
    async def streaming_with_saving(session_id: int, model: str, messages: list):
        full_response = ""
        async for chunk in llm_service.stream_chat(model, messages):
            full_response += chunk
            yield chunk
        
        # Save the assistant's full response to DB after streaming is complete
        if full_response:
            await add_message(session_id, "assistant", full_response)

    return StreamingResponse(
        streaming_with_saving(request.session_id, request.model or config.default_llm_model, llm_messages),
        media_type="text/event-stream"
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=config.port)
