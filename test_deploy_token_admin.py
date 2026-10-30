import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import deploy_token_admin as d


class DeployAdminTest(unittest.TestCase):
    def test_remove_so_variavel_administrativa(self):
        with tempfile.TemporaryDirectory() as tmp:
            p = Path(tmp) / '.env'
            p.write_text('# configurações\nOUTRA_CHAVE=preservada\nCNJ_MCP_ADMIN_TOKEN=exemplo\nCNJ_MCP_BANCO=cnj.db\n')
            self.assertTrue(d.limpar_ambiente(p))
            self.assertEqual(p.read_text(), '# configurações\nOUTRA_CHAVE=preservada\nCNJ_MCP_BANCO=cnj.db\n')
            self.assertFalse(d.limpar_ambiente(p))

    def test_falha_validacao_nao_altera_configuracao(self):
        with patch.object(d.subprocess, 'run') as run, patch.object(d, 'limpar_ambiente') as limpar:
            run.return_value.returncode = 1
            with self.assertRaises(SystemExit):
                d.main()
            limpar.assert_not_called()
            self.assertEqual(run.call_count, 1)
