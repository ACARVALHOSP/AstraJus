"""Regressões do cadastro individual e da migração de casos legados."""
import sqlite3
import tempfile
import unittest
from datetime import datetime
from pathlib import Path

import db
import server


class ProcessosTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'db.sqlite'
        self.gestao = db.RegistroClientesCasos(self.path)
        self.agora = lambda: datetime(2026, 1, 1)
        self.cliente = self.gestao.criar_cliente('Cliente', None, None, self.agora)['id']
        self.n1 = '10063142720238260005'
        self.n2 = '10063142720238260006'

    def criar(self, numeros):
        return self.gestao.criar_caso(self.cliente, 'Processo', None, numeros, self.agora)

    def test_cadastro_sem_numero_e_numero_com_mascara(self):
        self.assertEqual(self.criar([])['processos'], [])
        self.assertEqual(self.criar(['1006314-27.2023.8.26.0005'])['processos'], [self.n1])
        caso, erro = server._criar_caso_validado(self.gestao, {'cliente_id': self.cliente})
        self.assertIsNone(erro)
        self.assertEqual(caso['processos'], [])

    def test_recusa_multiplos_e_invalidos(self):
        for numeros in ([self.n1, self.n2], ['123'], ['abc' + self.n1], [123], '123'):
            with self.subTest(numeros=numeros):
                with self.assertRaises(ValueError):
                    self.criar(numeros)
                caso, erro = server._criar_caso_validado(self.gestao, {'cliente_id': self.cliente, 'numeros_processo': numeros})
                self.assertIsNone(caso)
                self.assertIsNotNone(erro)

    def test_salvar_cadastro_preserva_capa(self):
        caso = self.criar([self.n1])
        self.gestao.salvar_capa_processo(caso['id'], self.n1, self.agora, tribunal='TJSP', valor_causa=500)
        args = dict(caso_id=caso['id'], titulo='Editado', responsavel=None, acao=None, foro=None, autor=None, reu=None, advogados=None)
        self.gestao.atualizar_caso(**args, numeros_processo=[self.n1])
        self.assertEqual(self.gestao.obter_capa_processo(caso['id'], self.n1)['valor_causa'], 500)
        with self.assertRaises(ValueError):
            self.gestao.atualizar_caso(**args, numeros_processo=[self.n1, self.n2])
        self.assertEqual(self.gestao.obter_caso(caso['id'])['processos'], [self.n1])

    def test_migracao_preserva_dados_e_e_idempotente(self):
        original = self.criar([self.n1])['id']
        # Reconstrói banco legado, anterior à restrição de cardinalidade.
        with db.conectar(self.path) as conn:
            conn.execute('DROP INDEX idx_processo_unico_por_cadastro')
            conn.execute('INSERT INTO caso_processos VALUES (?, ?)', (original, self.n2))
            conn.execute('INSERT INTO caso_processo_capa (caso_id,numero_processo,tribunal) VALUES (?,?,?)', (original, self.n2, 'TJSP'))
            conn.execute("INSERT INTO caso_eventos (caso_id,numero_processo,tipo,conteudo,criado_em) VALUES (?,?,'movimentacao','{}','2026-01-01')", (original, self.n2))
            conn.execute("INSERT INTO caso_eventos (caso_id,tipo,conteudo,criado_em) VALUES (?,'nota','{}','2026-01-01')", (original,))
            conn.execute("INSERT INTO publicacoes_capturadas (hash,numero_processo,dados,caso_id,criado_em) VALUES ('pub',?,'{}',?,'2026-01-01')", (self.n2, original))
            conn.execute("INSERT INTO caso_atividades (caso_id,titulo,criado_em) VALUES (?,'Tarefa','2026-01-01')", (original,))
        casos = self.gestao.listar_casos()
        self.assertEqual(len(casos), 2)
        novo = next(c for c in casos if c['id'] != original)
        self.assertEqual(novo['processos'], [self.n2])
        self.assertEqual(self.gestao.obter_caso(original)['processos'], [self.n1])
        self.assertEqual(self.gestao.obter_capa_processo(novo['id'], self.n2)['tribunal'], 'TJSP')
        with db.conectar(self.path) as conn:
            self.assertEqual(conn.execute("SELECT caso_id FROM publicacoes_capturadas WHERE hash='pub'").fetchone()[0], novo['id'])
            self.assertEqual(conn.execute("SELECT caso_id FROM caso_eventos WHERE numero_processo=?", (self.n2,)).fetchone()[0], novo['id'])
            self.assertEqual(conn.execute("SELECT caso_id FROM caso_eventos WHERE numero_processo IS NULL").fetchone()[0], original)
            self.assertEqual(conn.execute('SELECT caso_id FROM caso_atividades').fetchone()[0], original)
            self.assertEqual(conn.execute('SELECT COUNT(*) FROM caso_vinculos').fetchone()[0], 1)
            self.assertEqual(conn.execute('PRAGMA foreign_key_check').fetchall(), [])
            with self.assertRaises(sqlite3.IntegrityError):
                conn.execute('INSERT INTO caso_processos VALUES (?,?)', (original, self.n2))
        self.assertEqual(len(self.gestao.listar_casos()), 2)

    def test_patch_http_valida_antes_de_alterar(self):
        import asyncio
        import json
        from unittest.mock import AsyncMock
        caso = self.criar([self.n1])
        mw = server._AutenticacaoBearer(app=None, registro=None, gestao=self.gestao)
        for numeros, status in (([self.n1, self.n2], 400), (['123'], 400), (['1006314-27.2023.8.26.0005'], 200), ([], 200)):
            with self.subTest(numeros=numeros):
                send = AsyncMock()
                receive = AsyncMock(return_value={'type': 'http.request', 'body': json.dumps({'numeros_processo': numeros}).encode(), 'more_body': False})
                asyncio.run(mw._caso_detalhe({'method': 'PATCH'}, receive, send, caso['id']))
                inicio = next(c.args[0] for c in send.call_args_list if c.args[0]['type'] == 'http.response.start')
                self.assertEqual(inicio['status'], status)
                self.assertEqual(self.gestao.obter_caso(caso['id'])['processos'], [] if numeros == [] else [self.n1])
