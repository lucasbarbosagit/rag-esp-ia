from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import chromadb
import json
import os
import threading
import fitz  # pymupdf
from llama_index.core import (
    VectorStoreIndex, Document, StorageContext, Settings, PromptTemplate
)
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.llms.ollama import Ollama
from llama_index.embeddings.ollama import OllamaEmbedding

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

Settings.llm = Ollama(model="mistral", request_timeout=360.0)
Settings.embed_model = OllamaEmbedding(model_name="nomic-embed-text", request_timeout=120.0)
Settings.chunk_size = 512
Settings.chunk_overlap = 64

QA_PROMPT = PromptTemplate(
    "Você é um assistente que responde EXCLUSIVAMENTE com base nos trechos dos livros abaixo.\n"
    "REGRAS:\n"
    "- Use APENAS o que está escrito nos trechos. Não invente.\n"
    "- Se a resposta não estiver nos trechos, diga: 'Não encontrei essa informação nos livros disponíveis.'\n"
    "- Ao responder, mencione de qual livro e página a informação veio.\n"
    "- Responda sempre em português brasileiro.\n\n"
    "Trechos:\n"
    "---------------------\n"
    "{context_str}\n"
    "---------------------\n"
    "Pergunta: {query_str}\n"
    "Resposta:"
)

REGISTRO = "indexados.json"
LIVROS_DIR = "livros"

chroma_client = chromadb.PersistentClient(path="./banco")
chroma_collection = chroma_client.get_or_create_collection("espiritualista")
vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
index = VectorStoreIndex.from_vector_store(vector_store)


def _build_engine(idx: VectorStoreIndex):
    return idx.as_query_engine(
        similarity_top_k=15,
        text_qa_template=QA_PROMPT,
    )


query_engine = _build_engine(index)

indexing_state: dict = {"running": False, "log": [], "error": None}
indexing_lock = threading.Lock()


def _nome_legivel(arquivo: str) -> str:
    return arquivo.replace(".pdf", "").split(" -- ")[0].strip()


def _carregar_indexados() -> list[str]:
    if not os.path.exists(REGISTRO):
        return []
    with open(REGISTRO, "r") as f:
        return json.load(f)


def _salvar_indexados(lista: list[str]):
    with open(REGISTRO, "w") as f:
        json.dump(lista, f, indent=2)


def _ler_pdf(caminho: str) -> list[Document]:
    doc = fitz.open(caminho)
    nome = os.path.basename(caminho)
    paginas = []
    for i, page in enumerate(doc):
        texto = page.get_text()
        if texto.strip():
            paginas.append(Document(
                text=texto,
                metadata={"livro": _nome_legivel(nome), "pagina": i + 1}
            ))
    return paginas


def _rodar_indexacao():
    global index, query_engine
    with indexing_lock:
        indexing_state["running"] = True
        indexing_state["log"] = []
        indexing_state["error"] = None

    def log(msg: str):
        indexing_state["log"].append(msg)

    try:
        indexados = _carregar_indexados()
        todos = [f for f in os.listdir(LIVROS_DIR) if f.endswith(".pdf")]
        novos = [f for f in todos if f not in indexados]

        if not novos:
            log("Nenhum livro novo encontrado. Tudo já está indexado.")
            return

        log(f"{len(novos)} livro(s) novo(s) encontrado(s).")

        for nome in novos:
            log(f"Lendo: {_nome_legivel(nome)}...")
            docs = _ler_pdf(f"{LIVROS_DIR}/{nome}")
            if not docs:
                log(f"  AVISO: nenhum texto extraído de {nome}, pulando.")
                continue
            log(f"{len(docs)} página(s) com texto. Gerando embeddings...")

            storage_context = StorageContext.from_defaults(vector_store=vector_store)
            VectorStoreIndex.from_documents(docs, storage_context=storage_context)

            indexados.append(nome)
            _salvar_indexados(indexados)
            log(f'"{_nome_legivel(nome)}" indexado.')

        new_index = VectorStoreIndex.from_vector_store(vector_store)
        index = new_index
        query_engine = _build_engine(new_index)
        log("Indexação concluída!")

    except Exception as e:
        indexing_state["error"] = str(e)
        log(f"Erro: {e}")
    finally:
        indexing_state["running"] = False


class Pergunta(BaseModel):
    mensagem: str


@app.post("/chat")
async def chat(pergunta: Pergunta):
    resposta = query_engine.query(pergunta.mensagem)
    return {"resposta": str(resposta)}


@app.get("/livros")
async def listar_livros():
    indexados = _carregar_indexados()
    todos = [f for f in os.listdir(LIVROS_DIR) if f.endswith(".pdf")] if os.path.exists(LIVROS_DIR) else []
    return {
        "indexados": [_nome_legivel(f) for f in indexados],
        "pendentes": [_nome_legivel(f) for f in todos if f not in indexados],
    }


@app.post("/indexar")
async def iniciar_indexacao():
    if indexing_state["running"]:
        return {"ok": False, "mensagem": "Indexação já em andamento."}
    t = threading.Thread(target=_rodar_indexacao, daemon=True)
    t.start()
    return {"ok": True, "mensagem": "Indexação iniciada."}


@app.get("/indexar/status")
async def status_indexacao():
    return {
        "running": indexing_state["running"],
        "log": indexing_state["log"],
        "error": indexing_state["error"],
    }


@app.post("/indexar/resetar")
async def resetar_indexacao():
    if indexing_state["running"]:
        return {"ok": False, "mensagem": "Indexação em andamento. Aguarde terminar."}
    global index, query_engine, chroma_collection, vector_store
    try:
        chroma_client.delete_collection("espiritualista")
        chroma_collection = chroma_client.get_or_create_collection("espiritualista")
        vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
        index = VectorStoreIndex.from_vector_store(vector_store)
        query_engine = _build_engine(index)
        if os.path.exists(REGISTRO):
            os.remove(REGISTRO)
        return {"ok": True, "mensagem": "Banco limpo. Indexe os livros novamente."}
    except Exception as e:
        return {"ok": False, "mensagem": str(e)}


@app.get("/debug/contagem")
async def debug_contagem():
    return {"total_chunks": chroma_collection.count()}


@app.get("/debug/busca")
async def debug_busca(q: str):
    nodes = index.as_retriever(similarity_top_k=8).retrieve(q)
    return {
        "chunks": [{"score": round(n.score or 0, 4), "texto": n.text[:300]} for n in nodes]
    }


@app.get("/health")
async def health():
    return {"status": "online"}
