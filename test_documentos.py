import io
import tempfile
import unittest
from pathlib import Path

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH

import documentos


def _modelo():
    doc = Document()
    p = doc.add_paragraph()
    p.add_run("Outorgante: ")
    p.add_run("{{cliente_")  # o Word costuma partir o campo em vários trechos
    p.add_run("nome}}").bold = True
    p.add_run(", poderes: {{poderes}}.")
    tabela = doc.add_table(rows=1, cols=1)
    tabela.cell(0, 0).text = "Processo {{caso_numero}} e {{ sem_valor }}"
    doc.sections[0].footer.paragraphs[0].text = "Em {{data_extenso}}"
    saida = io.BytesIO()
    doc.save(saida)
    return saida.getvalue()


def _texto(docx):
    d = Document(io.BytesIO(docx))
    return "\n".join(p.text for p in documentos._paragrafos(d))


class TestDocumentos(unittest.TestCase):
    def test_variaveis_e_preenchimento(self):
        modelo = _modelo()
        self.assertEqual(documentos.validar_docx(modelo), ["cliente_nome", "poderes", "caso_numero", "sem_valor", "data_extenso"])
        pronto = documentos.preencher(modelo, {"cliente_nome": "Ana Souza", "poderes": "ad judicia\nreceber citação",
                                               "caso_numero": "123", "data_extenso": "1 de janeiro de 2026"})
        texto = _texto(pronto)
        self.assertIn("Outorgante: Ana Souza, poderes: ad judicia\nreceber citação.", texto)
        self.assertIn("Processo 123 e ________", texto)  # sem valor: linha para preencher à mão
        self.assertIn("Em 1 de janeiro de 2026", texto)
        self.assertNotIn("{{", texto)
        negrito = Document(io.BytesIO(pronto)).paragraphs[0].runs[1]
        self.assertIn("Ana Souza", negrito.text)  # o valor fica no trecho onde o campo começa, com a formatação dele

    def test_texto_do_modelo(self):
        doc = Document()
        titulo = doc.add_paragraph()
        titulo.add_run("{{cliente_nome}}").bold = True
        centro = doc.add_paragraph("Cidade, {{data_hoje}}.")
        centro.alignment = WD_ALIGN_PARAGRAPH.CENTER
        doc.add_paragraph("   ")  # vazio: não entra na prévia
        doc.add_table(rows=1, cols=1).cell(0, 0).text = "Processo {{caso_numero}}"
        saida = io.BytesIO()
        doc.save(saida)

        paragrafos = documentos.texto_do_modelo(saida.getvalue())

        self.assertEqual([p["texto"] for p in paragrafos],
                         ["{{cliente_nome}}", "Cidade, {{data_hoje}}.", "Processo {{caso_numero}}"])
        self.assertTrue(paragrafos[0]["negrito"])
        self.assertFalse(paragrafos[1]["negrito"])
        self.assertTrue(paragrafos[1]["centralizado"])
        self.assertFalse(paragrafos[2]["centralizado"])

    def test_arquivo_invalido(self):
        for ruim in (b"", b"nao e docx"):
            with self.assertRaises(documentos.ErroDocumento):
                documentos.validar_docx(ruim)
        vazio = io.BytesIO()
        Document().save(vazio)
        with tempfile.TemporaryDirectory() as pasta, self.assertRaises(documentos.ErroDocumento):
            documentos.Repositorio(Path(pasta) / "d.db").criar_modelo("Sem campos", "outro", vazio.getvalue(), "u")

    def test_valores_automaticos(self):
        v = documentos.valores_automaticos(
            {"nome": "Ana", "cpf_cnpj": "123", "nacionalidade": "brasileira", "estado_civil": "solteira", "profissao": "médica",
             "rg_numero": "1", "rg_emissor": "SSP", "endereco_rua": "Rua A", "endereco_numero": "10", "endereco_cidade": "SP", "endereco_estado": "SP"},
            {"numero": "0001", "titulo": "Caso"})
        self.assertEqual(v["cliente_qualificacao"], "Ana, brasileira, solteira, médica, RG 1 SSP, CPF/CNPJ 123, residente em Rua A, 10, SP/SP")
        self.assertEqual(v["caso_numero"], "0001")
        self.assertNotIn("cliente_email", v)

    def test_signatarios(self):
        s = documentos.signatarios_zapsign([{"nome": "Ana", "email": "a@b.com", "telefone": "+55 (11) 99999-8888"}], "email")
        self.assertEqual((s[0]["phone_number"], s[0]["send_automatic_email"], s[0]["send_automatic_whatsapp"]), ("11999998888", True, False))
        with self.assertRaises(documentos.ErroDocumento):
            documentos.signatarios_zapsign([{"nome": "Ana", "email": "ruim"}], "email")
        with self.assertRaises(documentos.ErroDocumento):
            documentos.signatarios_zapsign([{"nome": "Ana"}], "whatsapp")
        with self.assertRaises(documentos.ErroDocumento):
            documentos.signatarios_zapsign([], "email")

    def test_fluxo_de_estados(self):
        with tempfile.TemporaryDirectory() as pasta:
            repo = documentos.Repositorio(Path(pasta) / "d.db")
            modelo = repo.criar_modelo("Procuração", "procuracao", _modelo(), "u")
            doc = repo.criar_documento(modelo["id"], "Procuração Ana", "c1", None, {}, b"docx", b"pdf", "u")
            self.assertEqual(doc["status"], "gerado")
            repo.marcar_enviado(doc["id"], "tok", [{"nome": "Ana"}])
            self.assertTrue(repo.aplicar_estado("tok", "assinado", [{"nome": "Ana", "status": "signed"}], b"%PDF"))
            self.assertEqual(repo.documento(doc["id"])["status"], "assinado")
            repo.aplicar_estado("tok", "enviado")  # aviso atrasado/duplicado não desfaz a assinatura
            self.assertEqual(repo.documento(doc["id"])["status"], "assinado")
            self.assertEqual(repo.arquivo(doc["id"], "assinado"), b"%PDF")
            self.assertFalse(repo.aplicar_estado("outro", "assinado"))
            self.assertEqual(documentos.status_do_retorno({"status": "signed"}), "assinado")
            self.assertEqual(documentos.status_do_retorno({"status": "pending"}, "doc_refused"), "recusado")

    def test_migracao_de_tabela_antiga(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as pasta:
            caminho = Path(pasta) / "d.db"
            c = sqlite3.connect(caminho)
            c.execute("CREATE TABLE documentos_gerados (id INTEGER PRIMARY KEY AUTOINCREMENT, modelo_id INTEGER, nome TEXT NOT NULL, "
                      "cliente_id TEXT, caso_id TEXT, valores TEXT NOT NULL, docx BLOB NOT NULL, pdf BLOB, status TEXT NOT NULL DEFAULT 'gerado', "
                      "zap_token TEXT, signatarios TEXT, assinado BLOB, criado_em TEXT NOT NULL, criado_por TEXT, atualizado_em TEXT NOT NULL)")
            c.execute("INSERT INTO documentos_gerados (nome,valores,docx,criado_em,atualizado_em) VALUES ('Antigo','{}',x'00','a','a')")
            c.commit(); c.close()
            repo = documentos.Repositorio(caminho)
            doc = repo.documentos()[0]
            self.assertEqual((doc["nome"], doc["visualizado_em"], doc["alerta"]), ("Antigo", None, None))
            documentos.Repositorio(caminho)  # segunda abertura não falha


if __name__ == "__main__":
    unittest.main()
