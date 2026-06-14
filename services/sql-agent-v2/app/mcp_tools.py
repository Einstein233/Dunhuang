"""MCP 工具客户端 - 连接到 MCP Tools Server"""
import asyncio
from typing import List
from langchain_core.tools import BaseTool
from langchain_mcp_adapters.client import MultiServerMCPClient
from . import config

_client: MultiServerMCPClient | None = None
_tools: List[BaseTool] = []

async def get_mcp_tools() -> List[BaseTool]:
    """获取 MCP 工具列表（带缓存）"""
    global _client, _tools

    if _tools:
        return _tools

    print(f"[MCP] Connecting to {config.MCP_TOOLS_URL}")

    _client = MultiServerMCPClient({
        "weather_tools": {
            "url": config.MCP_TOOLS_URL,
            "transport": "sse",
        }
    })

    _tools = await _client.get_tools()

    print(f"[MCP] Loaded {len(_tools)} tools:")
    for tool in _tools:
        print(f"  - {tool.name}: {tool.description[:60]}...")

    return _tools

async def close_mcp_client():
    """关闭 MCP 客户端连接"""
    global _client, _tools
    _client = None
    _tools = []
