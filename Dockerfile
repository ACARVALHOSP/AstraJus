FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml README.md server.py guia-do-usuario.html ./
COPY static/ ./static/
RUN pip install --no-cache-dir . \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app \
    && mkdir -p /data && chown app:app /data

# O processo roda sem privilégios de root.
USER app

# A porta é lida de CNJ_MCP_PORT, então a hospedagem pode definir qualquer valor.
# CNJ_MCP_USUARIOS e CNJ_MCP_ARVORES_CJPG_DIR devem apontar para um volume persistente
# (ex.: /data/...) - sem isso, as árvores de Vara/Classe/Assunto/Magistrado somem a cada
# recriação do container e precisam ser rebaixadas com --atualizar-arvores-cjpg.
ENV CNJ_MCP_TRANSPORT=http \
    CNJ_MCP_HOST=0.0.0.0 \
    CNJ_MCP_PORT=8000 \
    CNJ_MCP_USUARIOS=/data/usuarios.json \
    CNJ_MCP_ARVORES_CJPG_DIR=/data/arvores_cjpg

EXPOSE 8000

# Os tokens não ficam na imagem: são criados depois do deploy com --criar-usuario.
CMD ["python", "server.py"]
