"""RAG Agent — LangGraph 检索增强生成"""
from typing import Annotated, List, TypedDict
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, BaseMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from . import config
from .retriever import Retriever

# ── 状态 ─────────────────────────────────────────────
class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], add_messages]
    retrieved_docs: List[dict]

# ── 系统提示 ─────────────────────────────────────────
SYSTEM_PROMPT = """你是敦煌气象与地理科普助手。你的名字是"沙舟"。

## 你的能力
1. **知识科普**: 回答关于敦煌地理、气候、文化、丝绸之路、莫高窟等方面的问题
2. **气象解读**: 解释温度、降水、风速、辐射等气象指标的含义
3. **地区介绍**: 介绍中国各地区（特别是西北地区）的气候特征

## 回复原则
1. **基于检索到的知识回答**——不要编造事实，如果检索到的知识不够，请坦诚说明
2. **用通俗易懂的语言**——把专业知识讲得生动有趣
3. **适当引用来源**——回答中可以提及信息的出处（如"根据敦煌气候文献记载..."）
4. **鼓励深入探索**——回答后可以建议用户追问相关的延伸话题
5. **用中文回复**——保持温暖、专业的语气

## 格式要求
- 回答简洁有条理，每段不宜过长
- 可以用列表或分段使内容更清晰
- 数字和单位要准确

你正在和一位对敦煌文化、地理和气候感兴趣的访客对话，请友好、专业地回应。"""


def _format_docs(docs: list[dict]) -> str:
    """将检索到的文档格式化为 Prompt 片段"""
    if not docs:
        return "（未检索到相关文献资料，请基于通用知识回答，并告知用户信息可能不够精确）"

    parts = []
    for i, doc in enumerate(docs, 1):
        source = doc.get("source", "未知来源")
        content = doc.get("content", "")
        parts.append(f"[文献{i}] 来源: {source}\n{content}")

    return "\n\n".join(parts)


# ── Agent 图构建 ──────────────────────────────────────
_agent = None
_retriever = Retriever()


async def get_agent():
    """获取 Agent 实例（单例）"""
    global _agent
    if _agent is None:
        _agent = await _build_agent()
    return _agent


def _create_llm():
    return ChatOpenAI(
        model=config.LLM_MODEL,
        temperature=config.LLM_TEMPERATURE,
        base_url=config.LLM_BASE_URL,
        api_key=config.LLM_API_KEY,
        streaming=True,
    )


async def _build_agent():
    """构建 RAG LangGraph"""
    llm = _create_llm()
    retriever = _retriever

    # ── 检索节点 ───────────────────
    async def retrieve_node(state: AgentState):
        user_msg = state["messages"][-1]
        query = user_msg.content if hasattr(user_msg, "content") else str(user_msg)

        docs = retriever.query(query, top_k=3)
        return {"retrieved_docs": docs}

    # ── 增强+回答节点 ──────────────
    async def generate_node(state: AgentState):
        docs = state.get("retrieved_docs", [])
        knowledge_context = _format_docs(docs)

        # 构建消息：系统提示 + 检索到的知识 + 对话历史
        messages = [SystemMessage(content=SYSTEM_PROMPT)]

        # 插入检索知识作为上下文
        context_msg = HumanMessage(content=f"""请根据以下检索到的文献资料回答用户的问题。

## 检索到的文献资料
{knowledge_context}

## 历史对话
{_format_history(state['messages'])}

请基于文献资料回答。如果文献中没有相关信息，请诚实说明，可提供一般性科普知识作为补充。""")

        messages.append(context_msg)

        response = await llm.ainvoke(messages)
        return {"messages": [response]}

    # ── 图 ─────────────────────────
    workflow = StateGraph(AgentState)
    workflow.add_node("retrieve", retrieve_node)
    workflow.add_node("generate", generate_node)

    workflow.set_entry_point("retrieve")
    workflow.add_edge("retrieve", "generate")
    workflow.add_edge("generate", END)

    return workflow.compile()


def _format_history(messages: list) -> str:
    """只取最近 6 条对话历史"""
    recent = [m for m in messages if isinstance(m, (HumanMessage, AIMessage))]
    recent = recent[-6:]
    lines = []
    for m in recent:
        role = "用户" if isinstance(m, HumanMessage) else "助手"
        content = m.content[:300] if hasattr(m, "content") else str(m)[:300]
        lines.append(f"{role}: {content}")
    return "\n".join(lines)


# ── 流式执行 ────────────────────────────────────────
async def stream_rag(user_query: str, history: List[dict] = None):
    """流式执行 RAG Agent"""
    agent = await get_agent()

    messages = []
    if history:
        for msg in history[-10:]:  # 最近 10 轮
            if msg["role"] == "user":
                messages.append(HumanMessage(content=msg["content"]))
            elif msg["role"] == "assistant":
                messages.append(AIMessage(content=msg["content"]))
    messages.append(HumanMessage(content=user_query))

    # 通过 astream_events 获取流式输出
    async for event in agent.astream_events(
        {"messages": messages, "retrieved_docs": []},
        version="v2",
    ):
        kind = event.get("event")

        if kind == "on_chat_model_stream":
            chunk = event.get("data", {}).get("chunk")
            if chunk and hasattr(chunk, "content") and chunk.content:
                yield {"event": "text", "data": {"chunk": chunk.content}}

    yield {"event": "done", "data": {}}
