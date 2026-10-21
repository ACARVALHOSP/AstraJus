FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY pyproject.toml README.md server.py db.py _util.py google_integracao.py asaas_integracao.py guia-do-usuario.html ./
COPY static/ ./static/
RUN pip install --no-cache-dir . \
    && useradd --uid 10001 --no-create-home --shell /usr/sbin/nologin app \
    && mkdir -p /data && chown app:app /data

# O processo roda sem privilégios de root.
USER app

# A porta é lida de CNJ_MCP_PORT, então a hospedagem pode definir qualquer valor.
# CNJ_MCP_USUARIOS, CNJ_MCP_ARVORES_CJPG_DIR e CNJ_MCP_FERIADOS_DIR devem apontar para um volume
# persistente (ex.: /data/...): além de perderem o cache a cada recriação do container, o processo
# roda como usuário sem privilégios e não tem permissão de escrita em /app (WORKDIR, dono root) -
# sem essas variáveis, o caminho relativo default cai em /app e a escrita falha com PermissionError.
ENV CNJ_MCP_TRANSPORT=http \
    CNJ_MCP_HOST=0.0.0.0 \
    CNJ_MCP_PORT=8000 \
    CNJ_MCP_USUARIOS=/data/usuarios.json \
    CNJ_MCP_ARVORES_CJPG_DIR=/data/arvores_cjpg \
    CNJ_MCP_FERIADOS_DIR=/data/feriados_forenses

EXPOSE 8000

# Os tokens não ficam na imagem: são criados depois do deploy com --criar-usuario.
CMD ["python", "server.py"]
