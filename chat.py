import chromadb
from llama_index.core import VectorStoreIndex, Settings
from llama_index.vector_stores.chroma import ChromaVectorStore
from llama_index.llms.ollama import Ollama
from llama_index.embeddings.ollama import OllamaEmbedding

# Configura o modelo
Settings.llm = Ollama(model="mistral", request_timeout=1000.0)
Settings.embed_model = OllamaEmbedding(model_name="nomic-embed-text", request_timeout=1000.0)

# Carrega o banco já indexado
chroma_client = chromadb.PersistentClient(path="./banco")
chroma_collection = chroma_client.get_or_create_collection("espiritualista")
vector_store = ChromaVectorStore(chroma_collection=chroma_collection)

index = VectorStoreIndex.from_vector_store(vector_store)

# Configura o chat com personalidade
chat_engine = index.as_chat_engine(
    chat_mode="condense_plus_context",
    system_prompt="""Você é uma IA especializada em espiritualidade e tradições místicas.
Suas respostas são sempre baseadas nos livros indexados.
Sempre responda em português brasileiro.
Não julgue nem opine sobre as tradições, apenas apresente o que cada uma diz.
Se a pergunta for abrangente, mostre como diferentes tradições respondem.
Se a pergunta usar terminologia específica de uma tradição, responda dentro dessa tradição."""
)

print("🔮 IA Espiritualista pronta! Digite 'sair' para encerrar.\n")

while True:
    pergunta = input("Você: ")
    if pergunta.lower() == "sair":
        break
    
    print("\n🔮 IA: ", end="")
    resposta = chat_engine.chat(pergunta)
    print(resposta)
    print()