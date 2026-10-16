import yaml
from pathlib import Path
from pydantic import BaseModel, Field
from typing import Dict

class SystemPrompt(BaseModel):
    content: str

class AppConfig(BaseModel):
    api_url: str
    port: int = 8875
    default_system_prompt_name: str
    default_llm_model: str
    system_prompts: Dict[str, SystemPrompt]

def load_config(config_path: str = "config.yaml") -> AppConfig:
    path = Path(config_path)
    if not path.exists():
        raise FileNotFoundError(f"Config file not found: {config_path}")
    
    with open(path, "r", encoding="utf-8") as f:
        config_dict = yaml.safe_load(f)
    
    return AppConfig(**config_dict)

if __name__ == "__main__":
    try:
        config = load_config()
        print("Configuration loaded successfully:")
        print(config.model_dump_json(indent=2))
    except Exception as e:
        print(f"Error loading configuration: {e}")
