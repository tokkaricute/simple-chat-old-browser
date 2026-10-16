import httpx
import json
from typing import List, Dict, AsyncGenerator

class LLMService:
    def __init__(self, api_url: str):
        # Ensure the URL has /v1 if not already present (OpenAI compatibility)
        if not api_url.endswith("/v1"):
            self.api_url = api_url.rstrip("/") + "/v1"
        else:
            self.api_url = api_url

    async def get_models(self) -> List[str]:
        """Fetch available models from the OpenAI-compatible API."""
        url = f"{self.api_url}/models"
        async with httpx.AsyncClient() as client:
            try:
                response = await client.get(url, timeout=10.0)
                response.raise_for_status()
                data = response.json()
                # OpenAI models list structure: {"data": [{"id": "model-name", ...}, ...]}
                return [model["id"] for model in data.get("data", [])]
            except Exception as e:
                print(f"Error fetching models: {e}")
                return []

    async def stream_chat(
        self, 
        model: str, 
        messages: List[Dict[str, str]], 
        stream: bool = True
    ) -> AsyncGenerator[str, None]:
        """Stream chat completion from the OpenAI-compatible API."""
        url = f"{self.api_url}/chat/completions"
        payload = {
            "model": model,
            "messages": messages,
            "stream": stream
        }

        async with httpx.AsyncClient() as client:
            try:
                async with client.stream("POST", url, json=payload, timeout=60.0) as response:
                    response.raise_for_status()
                    async for line in response.aiter_lines():
                        if not line:
                            continue
                        
                        # SSE lines start with "data: "
                        if line.startswith("data: "):
                            data_str = line[6:].strip()
                            if data_str == "[DONE]":
                                break
                            
                            try:
                                data = json.loads(data_str)
                                delta = data["choices"][0].get("delta", {})
                                if "content" in delta:
                                    yield delta["content"]
                            except json.JSONDecodeError:
                                continue
            except Exception as e:
                print(f"Error during streaming chat: {e}")
                yield f"\n[Error: {str(e)}]\n"

    async def get_non_streaming_chat(self, model: str, messages: List[Dict[str, str]]) -> str:
        """Get chat completion without streaming (fallback or for saving)."""
        url = f"{self.api_url}/chat/completions"
        payload = {
            "model": model,
            "messages": messages,
            "stream": False
        }

        async with httpx.AsyncClient() as client:
            try:
                response = await client.post(url, json=payload, timeout=60.0)
                response.raise_for_status()
                data = response.json()
                return data["choices"][0]["message"]["content"]
            except Exception as e:
                print(f"Error in non-streaming chat: {e}")
                return f"[Error: {str(e)}]"
