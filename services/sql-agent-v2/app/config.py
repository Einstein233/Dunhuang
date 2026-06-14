"""配置管理"""
import os
from dotenv import load_dotenv

load_dotenv()

# LLM
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen-plus")
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.1"))

# MCP
MCP_TOOLS_URL = os.getenv("MCP_TOOLS_URL", "http://localhost:3100/sse")

# Server
AGENT_PORT = int(os.getenv("AGENT_PORT", "8000"))
AGENT_HOST = os.getenv("AGENT_HOST", "0.0.0.0")
