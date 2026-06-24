"""RAG Agent FastAPI 服务"""
import json
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from typing import List, Optional
from . import config
from .agent import stream_rag
from .knowledge_loader import build_knowledge_base
from .retriever import Retriever

# ── 请求/响应模型 ───────────────────────────────────
class ChatMessage(BaseModel):
    role: str = Field(..., description="user 或 assistant")
    content: str = Field(..., description="消息内容")

class QueryRequest(BaseModel):
    query: str = Field(..., description="用户问题")
    history: List[ChatMessage] = Field(default=[], description="对话历史")

class HealthResponse(BaseModel):
    status: str
    knowledge_chunks: int
    model: str

# ── 生命周期 ────────────────────────────────────────
_retriever = Retriever()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """启动时构建知识库，关闭时清理"""
    try:
        result = build_knowledge_base()
        print(f"[rag] 知识库就绪: {result['chunks_count']} chunks, "
              f"{result['files_count']} files")
    except Exception as e:
        print(f"[rag] 警告: 知识库构建失败 ({e})，服务仍将启动")

    yield
    print("[rag] 服务关闭")


# ── 应用 ────────────────────────────────────────────
app = FastAPI(
    title="敦煌 RAG 科普智能体",
    description="基于检索增强生成的敦煌气象与地理科普对话系统",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── 端点 ────────────────────────────────────────────
@app.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok",
        knowledge_chunks=_retriever.count(),
        model=config.LLM_MODEL,
    )


@app.post("/api/rag/query/stream")
async def query_stream(req: QueryRequest):
    """SSE 流式对话"""
    if not req.query.strip():
        raise HTTPException(status_code=400, detail="问题不能为空")

    history = [{"role": m.role, "content": m.content} for m in req.history]

    async def event_generator():
        try:
            async for event in stream_rag(req.query, history):
                yield f"event: {event['event']}\ndata: {json.dumps(event['data'], ensure_ascii=False)}\n\n"
        except Exception as e:
            yield f"event: error\ndata: {json.dumps({'message': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
