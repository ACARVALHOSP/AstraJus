import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, IconButton } from '@radix-ui/themes'
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import './avisos.scss'

type Tipo = 'sucesso' | 'erro' | 'info'
export type Aviso = {
  texto: string
  tipo?: Tipo
  /** Ação que reverte o que acabou de ser feito; mostra o botão "Desfazer". */
  desfazer?: () => void | Promise<void>
}
type AvisoAtivo = Aviso & { id: number }
type ContextoAvisos = { avisar: (aviso: Aviso) => void }

const Contexto = createContext<ContextoAvisos>({ avisar: () => {} })
const MAXIMO = 3
const DURACAO = { sucesso: 6000, info: 6000, erro: 10000 }
const DURACAO_COM_DESFAZER = 10000

/** Avisos flutuantes no canto da tela, para o resultado de uma ação ficar sempre à vista. */
export function AvisosProvider({ children }: { children: ReactNode }) {
  const [avisos, setAvisos] = useState<AvisoAtivo[]>([])
  const proximo = useRef(1)

  const fechar = useCallback((id: number) => setAvisos(lista => lista.filter(a => a.id !== id)), [])
  const avisar = useCallback((aviso: Aviso) => {
    const id = proximo.current++
    setAvisos(lista => [...lista.filter(a => a.texto !== aviso.texto), { ...aviso, id }].slice(-MAXIMO))
  }, [])

  return (
    <Contexto.Provider value={{ avisar }}>
      {children}
      <div className="avisos-regiao" role="region" aria-label="Avisos">
        {avisos.map(a => <ItemAviso key={a.id} aviso={a} fechar={fechar} />)}
      </div>
    </Contexto.Provider>
  )
}

function ItemAviso({ aviso, fechar }: { aviso: AvisoAtivo; fechar: (id: number) => void }) {
  const { id } = aviso
  const tipo = aviso.tipo ?? 'sucesso'
  const [pausado, setPausado] = useState(false)
  const [desfazendo, setDesfazendo] = useState(false)
  useEffect(() => {
    if (pausado) return
    const t = window.setTimeout(() => fechar(id), aviso.desfazer ? DURACAO_COM_DESFAZER : DURACAO[tipo])
    return () => window.clearTimeout(t)
  }, [pausado, fechar, id, aviso.desfazer, tipo])

  async function desfazer() {
    if (!aviso.desfazer) return
    setDesfazendo(true)
    try { await aviso.desfazer() } finally { fechar(id) }
  }

  const Icone = tipo === 'erro' ? AlertTriangle : tipo === 'info' ? Info : CheckCircle2
  return (
    <div
      className={`aviso aviso-${tipo}`}
      role={tipo === 'erro' ? 'alert' : 'status'}
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={() => setPausado(false)}
    >
      <Icone size={16} aria-hidden className="aviso-icone" />
      <span className="aviso-texto">{aviso.texto}</span>
      {aviso.desfazer && (
        <Button size="1" variant="soft" color="gray" highContrast disabled={desfazendo} onClick={desfazer}>Desfazer</Button>
      )}
      <IconButton size="1" variant="ghost" color="gray" aria-label="Fechar aviso" onClick={() => fechar(id)}><X size={14} /></IconButton>
    </div>
  )
}

export function useAvisos() {
  return useContext(Contexto)
}
