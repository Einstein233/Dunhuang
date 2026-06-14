"""LangGraph Agent - 主从结构"""
from typing import Annotated, TypedDict, List
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage, BaseMessage
from langgraph.graph import StateGraph, END
from langgraph.graph.message import add_messages
from langgraph.prebuilt import ToolNode
from . import config
from .mcp_tools import get_mcp_tools

# Agent 状态
class AgentState(TypedDict):
    messages: Annotated[List[BaseMessage], add_messages]

# 系统提示
SYSTEM_PROMPT = """你是敦煌气象数据智能助手。你可以帮助用户查询和分析全国气象数据。

## 你的能力
1. **数据查询**: 当用户询问气象数据时，使用工具查询数据库
2. **图表生成**: 根据查询结果生成可视化图表
3. **对话交流**: 回答气象相关问题，提供数据分析建议

## 工作流程
1. 首先调用 `query_schema` 获取数据库结构
2. 根据用户问题调用 `build_and_execute_sql` 生成并执行 SQL
3. 如果需要可视化，调用 `generate_chart` 生成图表
4. 用自然语言总结结果

## 注意事项
- 使用中文回答
- 地区名称使用中文（如"敦煌"、"酒泉"）
- 小时级数据使用 `granularity = 2`
- 查询结果可能很大，合理使用 LIMIT 和聚合函数

请友好地与用户交流，必要时使用工具查询数据。
"""

# 创建 LLM
def create_llm():
    return ChatOpenAI(
        model=config.LLM_MODEL,
        temperature=config.LLM_TEMPERATURE,
        base_url=config.LLM_BASE_URL,
        api_key=config.LLM_API_KEY,
        streaming=True,
    )

# 构建 Agent 图
async def create_agent_graph():
    """创建 LangGraph Agent"""
    tools = await get_mcp_tools()
    llm = create_llm()
    llm_with_tools = llm.bind_tools(tools)

    # 节点：调用 LLM
    async def agent_node(state: AgentState):
        messages = state["messages"]
        # 添加系统提示（如果还没有）
        if not any(isinstance(m, SystemMessage) for m in messages):
            messages = [SystemMessage(content=SYSTEM_PROMPT)] + list(messages)

        response = await llm_with_tools.ainvoke(messages)
        return {"messages": [response]}

    # 节点：执行工具
    tool_node = ToolNode(tools)

    # 路由：决定是否继续调用工具
    def should_continue(state: AgentState):
        last_message = state["messages"][-1]
        if hasattr(last_message, 'tool_calls') and last_message.tool_calls:
            return "tools"
        return END

    # 构建图
    workflow = StateGraph(AgentState)

    workflow.add_node("agent", agent_node)
    workflow.add_node("tools", tool_node)

    workflow.set_entry_point("agent")
    workflow.add_conditional_edges("agent", should_continue, {"tools": "tools", END: END})
    workflow.add_edge("tools", "agent")

    return workflow.compile()

# 全局 Agent 实例
_agent = None

async def get_agent():
    """获取 Agent 实例（带缓存）"""
    global _agent
    if _agent is None:
        _agent = await create_agent_graph()
    return _agent

# 运行 Agent
async def run_agent(user_query: str, history: List[dict] = None):
    """运行 Agent 并返回完整响应"""
    agent = await get_agent()

    messages = []
    if history:
        for msg in history:
            if msg["role"] == "user":
                messages.append(HumanMessage(content=msg["content"]))
            elif msg["role"] == "assistant":
                messages.append(AIMessage(content=msg["content"]))

    messages.append(HumanMessage(content=user_query))

    result = await agent.ainvoke({"messages": messages})

    # 提取最终回答
    final_message = result["messages"][-1]
    answer = final_message.content if hasattr(final_message, 'content') else str(final_message)

    return {
        "answer": answer,
        "messages": result["messages"],
    }

# 流式运行
async def stream_agent(user_query: str, history: List[dict] = None):
    """流式运行 Agent，yield 事件"""
    agent = await get_agent()

    messages = []
    if history:
        for msg in history:
            if msg["role"] == "user":
                messages.append(HumanMessage(content=msg["content"]))
            elif msg["role"] == "assistant":
                messages.append(AIMessage(content=msg["content"]))

    messages.append(HumanMessage(content=user_query))

    async for event in agent.astream_events(
        {"messages": messages},
        version="v2",
    ):
        kind = event.get("event")

        # LLM 流式输出
        if kind == "on_chat_model_stream":
            chunk = event.get("data", {}).get("chunk")
            if chunk and hasattr(chunk, 'content') and chunk.content:
                yield {
                    "event": "text",
                    "data": {"chunk": chunk.content}
                }

        # 工具调用开始
        elif kind == "on_tool_start":
            tool_name = event.get("name", "unknown")
            yield {
                "event": "tool_start",
                "data": {"tool": tool_name}
            }

        # 工具调用结束
        elif kind == "on_tool_end":
            tool_name = event.get("name", "unknown")
            output = event.get("data", {}).get("output", "")
            yield {
                "event": "tool_end",
                "data": {"tool": tool_name, "output": str(output)[:500]}
            }

    yield {"event": "done", "data": {}}
