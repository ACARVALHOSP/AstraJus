// Cores de destaque do tema, escolhidas no menu da conta.
export type AccentColor = 'indigo' | 'violet' | 'teal' | 'crimson'

export const ACCENTS: { key: AccentColor; label: string; cor: string }[] = [
  { key: 'indigo',  label: 'Índigo',   cor: 'var(--indigo-9)' },
  { key: 'violet',  label: 'Violeta',  cor: 'var(--violet-9)' },
  { key: 'teal',    label: 'Verde-azulado', cor: 'var(--teal-9)' },
  { key: 'crimson', label: 'Carmesim', cor: 'var(--crimson-9)' },
]
