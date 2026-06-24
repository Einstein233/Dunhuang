"""知识库加载器 — 使用原生 Embedding API（避开 langchain_openai 兼容问题）"""
import os
import glob
import chromadb
from langchain_text_splitters import MarkdownHeaderTextSplitter, RecursiveCharacterTextSplitter
from . import config
from .embedding import embed_query

_md_splitter = MarkdownHeaderTextSplitter(
    headers_to_split_on=[
        ("#", "h1"),
        ("##", "h2"),
        ("###", "h3"),
    ],
    strip_headers=False,
)

_fallback_splitter = RecursiveCharacterTextSplitter(
    chunk_size=800,
    chunk_overlap=100,
    separators=["\n\n", "\n", "。", "；", "，", " ", ""],
)


def _load_markdown_files(knowledge_dir: str) -> list[dict]:
    md_files = glob.glob(os.path.join(knowledge_dir, "**", "*.md"), recursive=True)
    md_files.sort()
    documents = []
    for filepath in md_files:
        try:
            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read().strip()
            if content:
                documents.append({
                    "path": filepath,
                    "filename": os.path.relpath(filepath, knowledge_dir),
                    "content": content,
                })
        except Exception as e:
            print(f"[rag] 跳过文件 {filepath}: {e}")
    return documents


def _chunk_document(doc: dict) -> list[dict]:
    chunks = []
    try:
        md_splits = _md_splitter.split_text(doc["content"])
    except Exception:
        md_splits = None

    source = doc["filename"]

    if md_splits:
        for split in md_splits:
            text = split.page_content.strip()
            if len(text) < 30:
                continue
            meta = dict(split.metadata)
            meta["source"] = source
            if len(text) > 1000:
                sub_splits = _fallback_splitter.split_text(text)
                for sub in sub_splits:
                    if len(sub.strip()) >= 30:
                        chunks.append({"text": sub.strip(), "metadata": meta})
            else:
                chunks.append({"text": text, "metadata": meta})
    else:
        sub_splits = _fallback_splitter.split_text(doc["content"])
        for sub in sub_splits:
            t = sub.strip()
            if len(t) >= 30:
                chunks.append({"text": t, "metadata": {"source": source}})

    return chunks


def build_knowledge_base(knowledge_dir: str = None, force_rebuild: bool = False):
    if knowledge_dir is None:
        knowledge_dir = config.KNOWLEDGE_DIR

    if not os.path.isdir(knowledge_dir):
        raise FileNotFoundError(f"知识库目录不存在: {knowledge_dir}")

    print(f"[rag] 加载知识库: {knowledge_dir}")

    docs = _load_markdown_files(knowledge_dir)
    if not docs:
        raise RuntimeError(f"知识库目录下没有找到 .md 文件: {knowledge_dir}")

    print(f"[rag] 找到 {len(docs)} 个文档")

    all_chunks = []
    for doc in docs:
        chunks = _chunk_document(doc)
        all_chunks.extend(chunks)

    print(f"[rag] 切片完成: {len(all_chunks)} 个片段")

    os.makedirs(config.CHROMA_PERSIST_DIR, exist_ok=True)
    chroma_client = chromadb.PersistentClient(path=config.CHROMA_PERSIST_DIR)

    if force_rebuild:
        try:
            chroma_client.delete_collection(config.CHROMA_COLLECTION_NAME)
        except Exception:
            pass

    collection = chroma_client.get_or_create_collection(
        name=config.CHROMA_COLLECTION_NAME,
        metadata={"description": "敦煌气象科普知识库"},
    )

    # 检查已存在的 ID，避免重复
    existing_ids = set()
    try:
        existing = collection.get(include=[])
        existing_ids = set(existing.get("ids", []))
    except Exception:
        pass

    total_added = 0
    batch_size = 10  # 小批量以避免 API 速率限制

    for i in range(0, len(all_chunks), batch_size):
        batch = all_chunks[i:i + batch_size]
        ids = []
        vectors = []
        out_texts = []
        out_metas = []

        for j, chunk in enumerate(batch):
            chunk_id = f"chunk_{i + j:06d}"
            if chunk_id in existing_ids:
                continue
            try:
                vec = embed_query(chunk["text"])
            except Exception as e:
                print(f"[rag] 向量化失败 [{chunk_id}]: {e}")
                continue
            ids.append(chunk_id)
            vectors.append(vec)
            out_texts.append(chunk["text"])
            out_metas.append(chunk["metadata"])

        if ids:
            try:
                collection.add(
                    ids=ids,
                    embeddings=vectors,
                    documents=out_texts,
                    metadatas=out_metas,
                )
                total_added += len(ids)
                print(f"[rag] 批次 {i // batch_size + 1}: {len(ids)} chunks 已入库")
            except Exception as e:
                print(f"[rag] 批次写入失败: {e}")

    print(f"[rag] 知识库构建完成: {total_added} chunks "
          f"(files={len(docs)}, collection={config.CHROMA_COLLECTION_NAME})")

    return {
        "chunks_count": total_added,
        "files_count": len(docs),
        "collection_name": config.CHROMA_COLLECTION_NAME,
    }
