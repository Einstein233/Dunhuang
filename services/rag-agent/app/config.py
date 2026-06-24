"""RAG Agent 配置"""
import os

# LLM 配置（复用 DashScope）
LLM_BASE_URL = os.getenv("LLM_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "qwen-plus")
LLM_TEMPERATURE = float(os.getenv("LLM_TEMPERATURE", "0.3"))

# Embedding 配置（Qwen text-embedding-v3）
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "text-embedding-v3")
EMBEDDING_DIMENSIONS = int(os.getenv("EMBEDDING_DIMENSIONS", "1024"))

# ChromaDB 配置
CHROMA_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "chroma_data"))
CHROMA_COLLECTION_NAME = os.getenv("CHROMA_COLLECTION_NAME", "dunhuang_knowledge")

# 知识库路径
KNOWLEDGE_DIR = os.getenv("KNOWLEDGE_DIR", os.path.join(os.path.dirname(os.path.dirname(__file__)), "knowledge"))

# 服务配置
RAG_HOST = os.getenv("RAG_HOST", "0.0.0.0")
RAG_PORT = int(os.getenv("RAG_PORT", "8000"))
