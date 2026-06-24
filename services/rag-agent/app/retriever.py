"""ChromaDB 检索器封装（使用原生 Embedding）"""
import chromadb
from . import config
from .embedding import embed_query


class Retriever:
    """基于 ChromaDB 的向量检索器"""

    def __init__(self):
        self._client = chromadb.PersistentClient(path=config.CHROMA_PERSIST_DIR)
        self._collection = self._client.get_or_create_collection(
            name=config.CHROMA_COLLECTION_NAME
        )

    def query(self, question: str, top_k: int = 3) -> list[dict]:
        """语义检索 top_k 个最相关的文档片段"""
        try:
            query_embedding = embed_query(question)
        except Exception:
            return []

        try:
            results = self._collection.query(
                query_embeddings=[query_embedding],
                n_results=top_k,
            )
        except Exception:
            return []

        if not results or not results.get("documents") or not results["documents"][0]:
            return []

        docs = []
        documents = results["documents"][0]
        metadatas = results.get("metadatas", [[]])[0]

        for i, text in enumerate(documents):
            meta = metadatas[i] if i < len(metadatas) else {}
            docs.append({
                "content": text,
                "source": meta.get("source", "未知来源"),
                "metadata": {k: v for k, v in meta.items() if k != "source"},
            })

        return docs

    def count(self) -> int:
        """返回库中向量总数"""
        try:
            return self._collection.count()
        except Exception:
            return 0
