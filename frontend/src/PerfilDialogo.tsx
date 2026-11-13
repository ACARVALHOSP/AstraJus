import { useRef, useState } from 'react'
import { Avatar, Badge, Button, Callout, Dialog, Flex, RadioGroup, Text, TextField } from '@radix-ui/themes'
import { ACCENTS, type AccentColor } from './aparencia'
import { AlertTriangle, Camera } from 'lucide-react'
import { useAvisos } from './Avisos'
import { useCliente } from './api/ClienteContext'
import { AREAS, usePerfil, type Grau } from './api/PerfilContext'
import MinhaAgendaGoogle from './MinhaAgendaGoogle'
import { reduzirFoto } from './utils/foto'
import { avaliarPerfil } from './utils/perfil'

const NIVEIS: Record<string, string> = { administrador: 'Administrador', operador: 'Operador', consulta: 'Consulta' }
const GRAUS: Record<Grau, { texto: string; cor: 'green' | 'blue' | 'gray' }> = {
  editar: { texto: 'Pode editar', cor: 'green' }, ver: { texto: 'Só consulta', cor: 'blue' }, nenhum: { texto: 'Sem acesso', cor: 'gray' },
}
/** "Meu perfil": foto, nome de exibição e e-mail editáveis; acesso por área só para leitura. */
export default function PerfilDialogo({ onClose, accent, setAccent }: { onClose: () => void; accent: AccentColor; setAccent: (a: AccentColor) => void }) {
  const { cliente } = useCliente()
  const { avisar } = useAvisos()
  const { nome: nomeAtual, email: emailAtual, foto: fotoAtual, login, nivel, permissoes, atualizarPerfil } = usePerfil()
  const [nome, setNome] = useState(nomeAtual ?? '')
  const [email, setEmail] = useState(emailAtual)
  const [foto, setFoto] = useState(fotoAtual)
  const [erro, setErro] = useState('')
  const [salvando, setSalvando] = useState(false)
  const seletor = useRef<HTMLInputElement>(null)
  const administrador = nivel === 'administrador'
  const { erro: erroCampos, mudancas, alterado } = avaliarPerfil({ nome: nomeAtual ?? '', email: emailAtual, foto: fotoAtual }, { nome, email, foto })

  async function escolherFoto(arquivo: File | undefined) {
    if (!arquivo) return
    try { setFoto(await reduzirFoto(arquivo)); setErro('') } catch (e) { setErro((e as Error).message) }
    if (seletor.current) seletor.current.value = ''
  }

  async function salvar() {
    if (erroCampos) { setErro(erroCampos); return }
    if (!cliente) { setErro('Conecte-se na aba Acesso.'); return }
    setSalvando(true); setErro('')
    try {
      const r = await fetch('/responsaveis/me', { method: 'PATCH', cache: 'no-store', headers: { Authorization: `Bearer ${cliente.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(mudancas) })
      const dados = await r.json().catch(() => ({})) as { mensagem?: string; usuario?: { nome_completo?: string; email?: string; foto?: string } }
      if (!r.ok) throw new Error(dados.mensagem || 'Não foi possível salvar o perfil. Tente de novo.')
      atualizarPerfil({ nome: dados.usuario?.nome_completo ?? nome.trim(), email: dados.usuario?.email ?? email.trim(), foto: dados.usuario?.foto ?? foto })
      avisar({ texto: 'Perfil atualizado.', tipo: 'sucesso' })
      onClose()
    } catch (e) {
      setErro(e instanceof TypeError ? 'Não foi possível falar com o servidor. Confira sua conexão.' : (e as Error).message)
    } finally { setSalvando(false) }
  }

  return (
    <Dialog.Root open onOpenChange={aberto => { if (!aberto && !salvando) onClose() }}>
      <Dialog.Content maxWidth="480px">
        <Dialog.Title>Meu perfil</Dialog.Title>
        <form onSubmit={e => { e.preventDefault(); void salvar() }}>
          <Flex direction="column" align="center" gap="2" mt="3">
            <button type="button" className="aj-perfil-foto" onClick={() => seletor.current?.click()} aria-label="Clique para alterar a foto" title="Clique para alterar a foto">
              <Avatar size="7" radius="full" src={foto || undefined} fallback={(nome || login || '?').trim().charAt(0).toUpperCase()} />
              <span className="aj-perfil-foto__camera" aria-hidden="true"><Camera size={14} /></span>
            </button>
            <input ref={seletor} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => void escolherFoto(e.target.files?.[0])} />
            <Text size="1" color="gray">Clique para alterar a foto</Text>
            {foto && <Button type="button" variant="ghost" size="1" color="gray" onClick={() => setFoto('')}>Remover foto</Button>}
          </Flex>

          <Flex direction="column" gap="3" mt="4">
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="perfil-nome">Nome de exibição</label>
              <TextField.Root id="perfil-nome" value={nome} maxLength={200} autoComplete="name" onChange={e => setNome(e.target.value)} />
            </div>
            <div className="form-campo">
              <label className="form-campo-label" htmlFor="perfil-email">E-mail</label>
              <TextField.Root id="perfil-email" type="email" value={email} maxLength={254} autoComplete="email" onChange={e => setEmail(e.target.value)} />
              <Text size="1" color="gray">Usado nos avisos por e-mail. O login de acesso não muda.</Text>
            </div>
          </Flex>

          <Text as="p" size="2" weight="medium" mt="4" mb="2">Cor de destaque</Text>
          <RadioGroup.Root value={accent} onValueChange={v => setAccent(v as AccentColor)} aria-label="Cor de destaque">
            <Flex gap="4" wrap="wrap">
              {ACCENTS.map(a => (
                <Text as="label" size="2" key={a.key}>
                  <Flex align="center" gap="2"><RadioGroup.Item value={a.key} /><span aria-hidden="true" style={{ width: 12, height: 12, borderRadius: '50%', background: a.cor, display: 'inline-block' }} />{a.label}</Flex>
                </Text>
              ))}
            </Flex>
          </RadioGroup.Root>

          <Text as="p" size="2" weight="medium" mt="4" mb="1">Perfil de acesso: {nivel ? (NIVEIS[nivel] ?? nivel) : 'não informado'}</Text>
          {administrador ? (
            <Text as="p" size="2" color="gray">Administradores têm acesso completo a todas as áreas.</Text>
          ) : (
            <Flex direction="column" gap="2" asChild>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {Object.entries(AREAS).map(([area, rotulo]) => {
                  const grau = (permissoes?.[area] ?? 'editar') as Grau
                  return (
                    <li key={area}><Flex justify="between" align="center" gap="3">
                      <Text size="2">{rotulo}</Text>
                      <Badge color={GRAUS[grau].cor} variant="soft">{GRAUS[grau].texto}</Badge>
                    </Flex></li>
                  )
                })}
              </ul>
            </Flex>
          )}
          <Text as="p" size="1" color="gray" mt="2">Nível e acesso por área são definidos por um administrador, em Administração.</Text>

          <Text as="p" size="2" weight="medium" mt="4" mb="1">Minha agenda Google</Text>
          <MinhaAgendaGoogle />

          <div aria-live="polite">
            {erro && (
              <Callout.Root color="red" size="1" mt="3" role="alert">
                <Callout.Icon><AlertTriangle size={14} /></Callout.Icon>
                <Callout.Text>{erro}</Callout.Text>
              </Callout.Root>
            )}
          </div>
          <Flex mt="4" gap="3" justify="end">
            <Button type="button" variant="soft" color="gray" disabled={salvando} onClick={onClose}>Cancelar</Button>
            <Button type="submit" disabled={salvando || !alterado}>{salvando ? 'Salvando…' : 'Salvar perfil'}</Button>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  )
}
