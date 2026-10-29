"""Provisionamento inicial: acrescenta /novo ao site existente, com backup."""
from datetime import datetime, timezone
from pathlib import Path
import shutil
import subprocess
import re

config = Path('/etc/caddy/Caddyfile')
source = config.read_text()
marker = r'^191-252-110-22\.sslip\.io \{\n'
include = '    import /etc/caddy/astrajus-novo.caddy\n'
if include in source:
    print('Import do frontend já configurado.')
    raise SystemExit(0)
if len(re.findall(marker, source, flags=re.MULTILINE)) != 1:
    raise SystemExit('Site esperado não encontrado de forma inequívoca; nenhuma alteração aplicada.')
candidate = config.with_name('Caddyfile.frontend-candidate')
candidate.write_text(re.sub(marker, lambda match: match.group(0) + include, source, count=1, flags=re.MULTILINE))
candidate.chmod(0o644)
subprocess.run(['caddy', 'validate', '--config', str(candidate), '--adapter', 'caddyfile'], check=True)
backup = config.with_name('Caddyfile.before-frontend-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
shutil.copy2(config, backup)
try:
    shutil.copyfile(candidate, config)
    subprocess.run(['systemctl', 'reload', 'caddy'], check=True)
except BaseException:
    shutil.copyfile(backup, config)
    subprocess.run(['systemctl', 'reload', 'caddy'], check=True)
    raise
print(f'Proxy configurado; backup: {backup}')
