import { lazy, type ComponentType, type LazyExoticComponent } from 'react'
import { BarChart2, BookOpen, Puzzle, type LucideIcon } from 'lucide-react'

// Cada pasta `modulos/<id>/index.tsx` é a tela do módulo de mesmo id no servidor (manifest.json em
// modulos/<id>/ no backend). O servidor diz quais módulos existem, estão ligados e onde aparecem no
// menu; aqui só se acha o componente de cada um. Módulo novo = pasta nova, sem mexer no App.
const carregadores = import.meta.glob<{ default: ComponentType }>('./*/index.tsx')
const componentes = new Map<string, LazyExoticComponent<ComponentType>>()

export function componenteDoModulo(id: string): LazyExoticComponent<ComponentType> | null {
  const carregador = carregadores[`./${id}/index.tsx`]
  if (!carregador) return null
  let componente = componentes.get(id)
  if (!componente) {
    componente = lazy(carregador)
    componentes.set(id, componente)
  }
  return componente
}

// O manifesto traz o nome do ícone (lucide); novos ícones entram aqui.
const ICONES: Record<string, LucideIcon> = { BarChart2, BookOpen }
export const iconeDoModulo = (nome: string): LucideIcon => ICONES[nome] ?? Puzzle
