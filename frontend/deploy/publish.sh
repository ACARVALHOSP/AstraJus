#!/usr/bin/env bash
set -Eeuo pipefail

# Executado como root por sudo; nunca reconstrói ou reinicia containers.
release_id="${1:?Informe o SHA da versão}"
[[ "$release_id" =~ ^[0-9a-f]{40}$ ]] || { echo 'SHA inválido' >&2; exit 1; }
base=/srv/astrajus-frontend
archive="/tmp/astrajus-frontend-${release_id}.tar.gz"
release="$base/releases/$release_id"
origin=https://191-252-110-22.sslip.io

test -f "$archive"
test -f "$archive.sha256"
(cd /tmp && sha256sum --check "astrajus-frontend-${release_id}.tar.gz.sha256")
install -d -m 0755 "$base" "$base/releases" "$base/assets"
if test -e "$release"; then
    test "$(cat "$release/release.txt")" = "$release_id"
else
    staging="$(mktemp -d "$base/releases/.pending-$release_id-XXXXXX")"
    tar --extract --gzip --file "$archive" --directory "$staging" --no-same-owner --no-same-permissions
    test -s "$staging/index.html"
    test -d "$staging/assets"
    test "$(cat "$staging/release.txt")" = "$release_id"
    chmod -R a+rX "$staging"
    mv -T "$staging" "$release"
fi
test -s "$release/index.html"
test -d "$release/assets"
# Arquivos com hash de versões anteriores continuam disponíveis para abas abertas.
cp -an "$release/assets/." "$base/assets/"
previous="$(readlink "$base/current" || true)"
activate() {
    ln -s "$1" "$base/current.next-$release_id"
    mv -Tf "$base/current.next-$release_id" "$base/current"
}
rollback() {
    if test -n "$previous"; then activate "$previous"; fi
    echo 'Falha na verificação; versão anterior restaurada quando disponível.' >&2
}
activate "$release"
trap rollback ERR
test "$(curl --fail --silent --show-error "$origin/novo/release.txt")" = "$release_id"
curl --fail --silent --show-error "$origin/novo/" | cmp - "$release/index.html"
curl --fail --silent --show-error --output /dev/null "$origin/healthz"
trap - ERR
printf 'Frontend publicado: %s\n' "$release_id"
