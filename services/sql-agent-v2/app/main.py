"""FastAPI 入口"""
import asyncio
from contextlib import asynccontextmanager
from typing import List, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sse_starlette.sse import EventSourceResponse
from . import config
from .agent import run_agent, stream_agent
from .mcp_tools import get_mcp_tools, close_mcp_client

# 请求/响应模型
class ChatRequest(BaseModel):
    query: str
    session_id: Optional[str] = None
    history: Optional[List[dict]] = None

class ChatResponse(BaseModel):
    success: bool
    answer: str
    messages_count: int

class StreamRequest(BaseModel):
    query: str
    session_id: Optional[str] = None
    history: Optional[List[dict]] = None

# 生命周期
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("\n" + "="*60)
    print("  Dunhuang SQL Agent V2 - Starting")
    print("="*60 + "\n")

    # 启动时加载工具
    try:
        tools = await get_mcp_tools()
        print(f"\n[Agent] Ready with {len(tools)} tools\n")
    except Exception as e:
        print(f"[Agent] Warning: Failed to load MCP tools: {e}")
        print("[Agent] Agent will retry on first request\n")

    yield

    # 关闭时清理
    print("\n[Agent] Shutting down...")
    await close_mcp_client()

# 创建应用
app = FastAPI(
    title="Dunhuang SQL Agent V2",
    version="2.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 健康检查
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "sql-agent-v2",
        "version": "2.0.0",
        "mcp_url": config.MCP_TOOLS_URL,
    }

# 同步查询
@app.post("/api/v2/query", response_model=ChatResponse)
async def query(request: ChatRequest):
    """同步查询接口"""
    try:
        result = await run_agent(
            user_query=request.query,
            history=request.history or []
        )

        return ChatResponse(
            success=True,
            answer=result["answer"],
            messages_count=len(result["messages"])
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# 流式查询
@app.post("/api/v2/query/stream")
async def query_stream(request: StreamRequest):
    """流式查询接口（SSE）"""
    async def event_generator():
        try:
            async for event in stream_agent(
                user_query=request.query,
                history=request.history or []
            ):
                yield {
                    "event": event["event"],
                    "data": event["data"]
                }
        except Exception as e:
            yield {
                "event": "error",
                "data": {"message": str(e)}
            }

    return EventSourceResponse(event_generator())

# 启动
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host=config.AGENT_HOST,
        port=config.AGENT_PORT,
        reload=True,
    )
