"""Finaliza a migração da credencial administrativa no host do deploy, sem expor segredos."""
import json
import subprocess
import time
from pathlib import Path
from urllib.request import urlopen

VERIFICAR = '''
import os
from pathlib import Path
import db, usuarios_admin
p = Path(os.environ.get('CNJ_MCP_USUARIOS', 'usuarios.json')).parent / os.environ.get('CNJ_MCP_BANCO', 'cnj.db')
r = db.RegistroUsuarios(p)
legado = os.environ.get('CNJ_MCP_ADMIN_TOKEN', '').strip()
if legado:
    assert usuarios_admin.token_admin_configurado(r), 'Hash administrativo ausente'
    assert usuarios_admin.validar_token_admin(r, legado), 'Token legado não corresponde ao hash'
print('ok')
'''


def limpar_ambiente(caminho):
    texto = caminho.read_text()
    linhas = texto.splitlines(keepends=True)
    novas = [l for l in linhas if l.strip().split('=', 1)[0].strip() != 'CNJ_MCP_ADMIN_TOKEN']
    if novas == linhas:
        return False
    caminho.write_text(''.join(novas))
    return True


def main():
    # Segredos ficam restritos aos subprocessos; nunca imprimir docker inspect/env.
    resultado = subprocess.run(['docker', 'exec', 'cnj-processual', 'python', '-c', VERIFICAR], capture_output=True)
    if resultado.returncode:
        raise SystemExit('Migração administrativa não validada; configuração preservada.')
    inspecao = json.loads(subprocess.check_output(['docker', 'inspect', 'cnj-processual']))[0]
    tem_legado = any(v.split('=', 1)[0] == 'CNJ_MCP_ADMIN_TOKEN' for v in inspecao['Config']['Env'])
    ambiente = Path('/root/apps/cnj-processual/.env')
    # Se o arquivo divergiu da configuração em execução, não descartar uma credencial sem validação.
    if not tem_legado and any(l.strip().split('=', 1)[0].strip() == 'CNJ_MCP_ADMIN_TOKEN' for l in ambiente.read_text().splitlines()):
        raise SystemExit('Configuração administrativa divergente; arquivo preservado para revisão.')
    limpar_ambiente(ambiente)
    if tem_legado:
        subprocess.run(['docker', 'rm', '-f', 'cnj-processual'], check=True, stdout=subprocess.DEVNULL)
        subprocess.run(['docker', 'run', '-d', '--name', 'cnj-processual', '--restart', 'unless-stopped',
                        '-p', '127.0.0.1:8000:8000', '-v', '/root/apps/cnj-processual/dados:/app/dados',
                        '--env-file', str(ambiente), 'cnj-processual'], check=True, stdout=subprocess.DEVNULL)
    for _ in range(20):
        try:
            with urlopen('http://127.0.0.1:8000/healthz', timeout=3) as r:
                if r.status == 200:
                    break
        except OSError:
            time.sleep(1)
    else:
        raise SystemExit('Servidor não ficou saudável após a migração administrativa.')
    resultado = subprocess.run(['docker', 'exec', 'cnj-processual', 'python', '-c',
        "import os; from pathlib import Path; import db, usuarios_admin; "
        "r=db.RegistroUsuarios(Path(os.environ.get('CNJ_MCP_USUARIOS','usuarios.json')).parent / os.environ.get('CNJ_MCP_BANCO','cnj.db')); "
        "assert 'CNJ_MCP_ADMIN_TOKEN' not in os.environ; "
        "print('configurada=' + str(usuarios_admin.token_admin_configurado(r)))"], capture_output=True, text=True)
    if resultado.returncode:
        raise SystemExit('Falha na verificação final da credencial administrativa.')
    print('Variável legada ausente do arquivo e do container; ' + resultado.stdout.strip())


if __name__ == '__main__':
    main()
