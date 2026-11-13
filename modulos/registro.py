"""Descoberta, estado (ligado/desligado) e carga dos módulos plugáveis.

Fonte da verdade de cada módulo: `modulos/<id>/manifest.json`. O estado ligado/desligado fica na
tabela `modulos_estado` do banco do escritório (cada instalação do AstraJus é um escritório).
Sem banco configurado (testes, CLI), todo módulo vale pelo padrão do manifesto."""
import functools
import importlib
import json
import logging
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path

from modulos.nucleo import nucleo

log = logging.getLogger("cnj-processual")
RAIZ = Path(__file__).resolve().parent

_OBRIGATORIOS = ("id", "nome", "versao", "aba", "area_permissao")
_ABA_OBRIGATORIA = ("id", "rotulo", "grupo", "icone")


class ConflitoModulo(ValueError):
    """Ligar ou desligar o módulo quebraria uma dependência (HTTP 409)."""


def _validar(manifesto: dict, origem: str) -> dict:
    faltando = [c for c in _OBRIGATORIOS if not manifesto.get(c)]
    if faltando:
        raise ValueError(f"Manifesto {origem}: faltam campos {', '.join(faltando)}.")
    aba = manifesto["aba"]
    if not isinstance(aba, dict) or any(not aba.get(c) for c in _ABA_OBRIGATORIA):
        raise ValueError(f"Manifesto {origem}: 'aba' precisa de {', '.join(_ABA_OBRIGATORIA)}.")
    if manifesto["id"] != Path(origem).parent.name:
        raise ValueError(f"Manifesto {origem}: 'id' deve ser igual ao nome da pasta.")
    resultado = dict(manifesto)
    for lista in ("ferramentas", "ferramentas_consulta", "rotas_http", "dependencias", "tabelas"):
        resultado[lista] = list(manifesto.get(lista) or [])
    resultado["permissoes"] = dict(manifesto.get("permissoes") or {})
    resultado["ativo_por_padrao"] = manifesto.get("ativo_por_padrao", True) is not False
    return resultado


def _agora() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class RegistroModulos:
    def __init__(self, raiz: Path = RAIZ) -> None:
        self._trava = threading.Lock()
        self._caminho: Path | None = None
        self._estado: dict[str, bool] = {}
        self._servicos: dict[str, object] = {}
        self.manifestos: dict[str, dict] = {}
        self.descobrir(raiz)

    # -- descoberta -----------------------------------------------------------------------
    def descobrir(self, raiz: Path) -> None:
        manifestos: dict[str, dict] = {}
        for arquivo in sorted(raiz.glob("*/manifest.json")):
            manifesto = _validar(json.loads(arquivo.read_text(encoding="utf-8")), str(arquivo))
            if manifesto["id"] in manifestos:
                raise ValueError(f"Módulo duplicado: {manifesto['id']}.")
            manifestos[manifesto["id"]] = manifesto
        for m in manifestos.values():
            for dep in m["dependencias"]:
                if dep == m["id"] or dep not in manifestos:
                    raise ValueError(f"Módulo {m['id']}: dependência inválida '{dep}'.")
        self._sem_ciclo(manifestos)
        self.manifestos = manifestos

    @staticmethod
    def _sem_ciclo(manifestos: dict[str, dict]) -> None:
        visitando: set[str] = set()
        feitos: set[str] = set()

        def visitar(id_: str) -> None:
            if id_ in feitos:
                return
            if id_ in visitando:
                raise ValueError(f"Dependência circular envolvendo o módulo {id_}.")
            visitando.add(id_)
            for dep in manifestos[id_]["dependencias"]:
                visitar(dep)
            visitando.discard(id_)
            feitos.add(id_)

        for id_ in manifestos:
            visitar(id_)

    # -- estado ---------------------------------------------------------------------------
    def configurar(self, caminho: str | Path) -> None:
        """Liga o registro ao banco do escritório, lê o estado e roda as migrações dos módulos."""
        self._caminho = Path(caminho)
        with sqlite3.connect(self._caminho) as conexao:
            conexao.execute(
                "CREATE TABLE IF NOT EXISTS modulos_estado (modulo_id TEXT PRIMARY KEY, "
                "ativo INTEGER NOT NULL, atualizado_em TEXT, atualizado_por TEXT)")
            linhas = conexao.execute("SELECT modulo_id, ativo FROM modulos_estado").fetchall()
            self._estado = {id_: bool(ativo) for id_, ativo in linhas}
            for id_ in self.manifestos:
                if self.manifestos[id_]["tabelas"] and self.ativo(id_):  # só quem tem tabelas próprias
                    migrar = getattr(self._servico(id_), "migrar", None)
                    if migrar:
                        migrar(conexao)
        conexao.close()

    def ativo(self, id_: str) -> bool:
        manifesto = self.manifestos.get(id_)
        if manifesto is None:
            return False
        return self._estado.get(id_, manifesto["ativo_por_padrao"])

    def dependentes_ativos(self, id_: str) -> list[str]:
        return [m["nome"] for m in self.manifestos.values() if id_ in m["dependencias"] and self.ativo(m["id"])]

    def definir_ativo(self, id_: str, ativo: bool, usuario: str | None = None) -> dict:
        manifesto = self.manifestos.get(id_)
        if manifesto is None:
            raise LookupError("Módulo não encontrado.")
        if ativo:
            faltando = [self.manifestos[d]["nome"] for d in manifesto["dependencias"] if not self.ativo(d)]
            if faltando:
                raise ConflitoModulo(f"Ative antes: {', '.join(faltando)}.")
        else:
            dependentes = self.dependentes_ativos(id_)
            if dependentes:
                raise ConflitoModulo(f"Desative antes: {', '.join(dependentes)}.")
        with self._trava:
            if self._caminho is not None:
                with sqlite3.connect(self._caminho) as conexao:
                    conexao.execute(
                        "INSERT INTO modulos_estado VALUES (?, ?, ?, ?) ON CONFLICT(modulo_id) DO UPDATE SET "
                        "ativo=excluded.ativo, atualizado_em=excluded.atualizado_em, atualizado_por=excluded.atualizado_por",
                        (id_, int(ativo), _agora(), usuario))
                conexao.close()
            self._estado[id_] = ativo
        log.info("Módulo %s %s por %s", id_, "ativado" if ativo else "desativado", usuario or "?")
        return self.descrever(id_)

    # -- consulta -------------------------------------------------------------------------
    def descrever(self, id_: str) -> dict:
        m = self.manifestos[id_]
        return {
            "id": m["id"], "nome": m["nome"], "descricao": m.get("descricao", ""), "versao": m["versao"],
            "aba": m["aba"], "area_permissao": m["area_permissao"], "dependencias": m["dependencias"],
            "ferramentas": m["ferramentas"], "tabelas": m["tabelas"], "ativo": self.ativo(id_),
            "dependentes_ativos": self.dependentes_ativos(id_),
        }

    def listar(self) -> list[dict]:
        return [self.descrever(i) for i in self.manifestos]

    def permissoes(self) -> dict[str, str]:
        """Áreas de permissão novas que os módulos declaram (além das do núcleo)."""
        areas: dict[str, str] = {}
        for m in self.manifestos.values():
            areas.update(m["permissoes"])
        return areas

    def ferramentas_consulta(self) -> frozenset:
        return frozenset(f for m in self.manifestos.values() for f in m["ferramentas_consulta"])

    def area_da_rota(self, caminho: str) -> str | None:
        for m in self.manifestos.values():
            if any(caminho.startswith(prefixo) for prefixo in m["rotas_http"]):
                return m["area_permissao"]
        return None

    # -- carga ----------------------------------------------------------------------------
    def _servico(self, id_: str):
        if id_ not in self._servicos:
            self._servicos[id_] = importlib.import_module(f"modulos.{id_}.servico")
        return self._servicos[id_]

    def carregar(self, mcp) -> None:
        """Importa cada módulo, registra as ferramentas MCP declaradas no manifesto e as áreas de
        permissão novas. Ferramenta de módulo desligado devolve erro em vez de executar."""
        import usuarios_admin
        for area, rotulo in self.permissoes().items():
            usuarios_admin.MODULOS.setdefault(area, rotulo)
        for id_, manifesto in self.manifestos.items():
            servico = self._servico(id_)
            marcadas = {f.__name__: f for f in vars(servico).values() if getattr(f, "_ferramenta_modulo", False)}
            if set(marcadas) != set(manifesto["ferramentas"]):
                raise ValueError(f"Módulo {id_}: ferramentas do manifesto {sorted(manifesto['ferramentas'])} "
                                 f"diferem das do código {sorted(marcadas)}.")
            for fn in marcadas.values():
                mcp.tool()(self._guardar(id_, manifesto["nome"], fn))

    def _guardar(self, id_: str, nome: str, fn):
        @functools.wraps(fn)
        async def protegida(*args, **kwargs):
            if not self.ativo(id_):
                return nucleo._erro(f"O módulo {nome} está desativado. Um administrador pode ativá-lo em Configurações › Módulos.")
            return await fn(*args, **kwargs)
        return protegida

    async def despachar_http(self, scope, send, caminho: str, receive=None) -> bool:
        """Entrega a rota ao módulo dono do prefixo. True se a resposta já foi enviada. O módulo que precisa
        do corpo da requisição (PUT/POST) define `http_com_corpo(scope, receive, send, caminho)`; os demais
        seguem com `http(scope, send, caminho)`."""
        for id_, m in self.manifestos.items():
            if not any(caminho.startswith(p) for p in m["rotas_http"]):
                continue
            if not self.ativo(id_):
                await nucleo._json(send, 404, nucleo._erro(f"O módulo {m['nome']} está desativado."))
                return True
            servico = self._servico(id_)
            if receive is not None and hasattr(servico, "http_com_corpo"):
                return await servico.http_com_corpo(scope, receive, send, caminho)
            return await servico.http(scope, send, caminho)
        return False

    async def gerenciador_http(self, scope, receive, send, caminho: str, usuario: str | None) -> bool:
        """GET /modulos (lista, qualquer usuário) e PATCH /modulos/<id> {"ativo": bool} (administrador)."""
        metodo = scope.get("method")
        if caminho == "/modulos" and metodo == "GET":
            await nucleo._json(send, 200, {"modulos": self.listar(), "permissoes": self.permissoes()})
            return True
        if not caminho.startswith("/modulos/"):
            return False
        id_ = caminho[len("/modulos/"):]
        if metodo != "PATCH":
            await nucleo._json(send, 405, {"mensagem": "Método não permitido."})
            return True
        if scope.get("nivel_acesso") != "administrador":
            await nucleo._json(send, 403, nucleo._erro("Só um administrador gerencia os módulos."))
            return True
        bruto = await nucleo._ler_corpo(receive)
        try:
            dados = json.loads(bruto or b"")
            if not isinstance(dados, dict) or not isinstance(dados.get("ativo"), bool):
                raise ValueError("Informe ativo: true ou false.")
            modulo = self.definir_ativo(id_, dados["ativo"], usuario)
        except LookupError as e:
            await nucleo._json(send, 404, {"mensagem": str(e)})
        except ConflitoModulo as e:
            await nucleo._json(send, 409, {"mensagem": str(e)})
        except (ValueError, UnicodeDecodeError) as e:
            await nucleo._json(send, 400, {"mensagem": "JSON inválido." if isinstance(e, json.JSONDecodeError) else str(e)})
        else:
            await nucleo._json(send, 200, {"modulo": modulo})
        return True


modulos = RegistroModulos()
