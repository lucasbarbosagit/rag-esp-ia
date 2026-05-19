import chromadb
import os
import json
from llama_index.core import SimpleDirectoryReader, VectorStoreIndex, StorageContext, Settings
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.llms.ollama import Ollama
from llama_index.embeddings.ollama import OllamaEmbedding

Settings.llm = Ollama(model="llama3.2:3b", request_timeout=300.0)
Settings.embed_model = OllamaEmbedding(model_name="nomic-embed-text", request_timeout=300.0)

# Arquivo que guarda quais livros já foram indexados
REGISTRO = "indexados.json"

def carregar_registro():
    if os.path.exists(REGISTRO):
        with open(REGISTRO, "r") as f:
            return json.load(f)
    return []

def salvar_registro(indexados):
    with open(REGISTRO, "w") as f:
        json.dump(indexados, f, indent=2)

# Verifica quais PDFs ainda não foram indexados
indexados = carregar_registro()
todos = [f for f in os.listdir("livros") if f.endswith(".pdf")]
novos = [f for f in todos if f not in indexados]

if not novos:
    print("✅ Nenhum livro novo encontrado. Tudo já está indexado!")
    exit()

print(f"📚 {len(novos)} livro(s) novo(s) encontrado(s): {novos}")

# Lê só os novos
documentos = SimpleDirectoryReader(
    input_files=[f"livros/{f}" for f in novos]
).load_data()

print(f"🔄 Indexando {len(documentos)} páginas...")

chroma_client = chromadb.PersistentClient(path="./banco")
chroma_collection = chroma_client.get_or_create_collection("espiritualista")
vector_store = ChromaVectorStore(chroma_collection=chroma_collection)
storage_context = StorageContext.from_defaults(vector_store=vector_store)

index = VectorStoreIndex.from_documents(
    documentos,
    storage_context=storage_context,
)

# Salva o registro atualizado
salvar_registro(indexados + novos)
print(f"✅ Concluído! Total indexado: {indexados + novos}")