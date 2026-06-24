"""Embedding 工具 — 原生 HTTP 请求 Qwen Embedding API（避免 langchain_openai 兼容性问题）"""
import json
import urllib.request
from . import config


def embed_query(text: str) -> list[float]:
    """
    对单个查询文本做 Embedding，返回 1024 维向量。

    Args:
        text: 待向量化的文本

    Returns:
        1024 维浮点向量列表

    Raises:
        RuntimeError: API 调用失败时抛出
    """
    if not text or not isinstance(text, str):
        raise ValueError(f"embed_query 需要非空字符串，收到: {type(text)}")

    body = json.dumps({
        "model": config.EMBEDDING_MODEL,
        "input": text,
    }).encode("utf-8")

    req = urllib.request.Request(
        f"{config.LLM_BASE_URL}/embeddings",
        body,
        {
            "Authorization": f"Bearer {config.LLM_API_KEY}",
            "Content-Type": "application/json",
        },
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        err_body = e.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Embedding API 返回 {e.code}: {err_body[:500]}")
    except Exception as e:
        raise RuntimeError(f"Embedding API 请求失败: {e}")

    embeddings = data.get("data", [])
    if not embeddings:
        raise RuntimeError(f"Embedding API 返回空数据: {json.dumps(data, ensure_ascii=False)[:300]}")

    vec = embeddings[0].get("embedding", [])
    if not vec:
        raise RuntimeError(f"Embedding API 返回无向量: {json.dumps(embeddings[0], ensure_ascii=False)[:200]}")

    return vec


def embed_texts(texts: list[str]) -> list[list[float]]:
    """
    对多条文本批量做 Embedding。

    Args:
        texts: 待向量化的文本列表

    Returns:
        向量列表
    """
    return [embed_query(t) for t in texts]
