import { useEffect, useMemo, useState } from 'react'
import { Braces, Calculator, ChevronLeft, ChevronRight, GitBranch, Lightbulb, Loader2, X } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import type { FormulaExplanationMode, FormulaExplanationResult, FormulaSelectionInfo, FormulaSymbol } from '../types'

interface Props {
  selection: FormulaSelectionInfo
  bookId: string
  chapterId: string | null
  bookTitle?: string
  chapterTitle?: string
  onClose: () => void
}

const TABS: { id: FormulaExplanationMode; label: string; icon: typeof Braces }[] = [
  { id: 'symbols', label: '每个符号是谁', icon: Braces },
  { id: 'pipeline', label: '拆开读', icon: GitBranch },
  { id: 'tiny_run', label: '代入算一遍', icon: Calculator },
  { id: 'rationale', label: '为什么长这样', icon: Lightbulb },
]

function FormulaDisplay({ text, symbols, selected, onSelect }: {
  text: string
  symbols: FormulaSymbol[]
  selected: string
  onSelect: (symbol: FormulaSymbol) => void
}) {
  const parts = useMemo(() => {
    const tokens = symbols.map((item) => item.token).filter(Boolean).sort((a, b) => b.length - a.length)
    if (!tokens.length) return [text]
    const escaped = tokens.map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    return text.split(new RegExp(`(${escaped.join('|')})`, 'g'))
  }, [symbols, text])
  return <div className="formula-explorer-equation" aria-label="interactive-formula">
    {parts.map((part, index) => {
      const symbol = symbols.find((item) => item.token === part)
      return symbol
        ? <button key={`${part}-${index}`} type="button" className={selected === part ? 'is-selected' : ''} onClick={() => onSelect(symbol)}>{part}</button>
        : <span key={`${part}-${index}`}>{part}</span>
    })}
  </div>
}

export default function FormulaExplanationExplorer({ selection, bookId, chapterId, bookTitle, chapterTitle, onClose }: Props) {
  const tone = useSettingsStore((state) => state.explanationTone)
  const [tab, setTab] = useState<FormulaExplanationMode>('symbols')
  const [result, setResult] = useState<FormulaExplanationResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedSymbol, setSelectedSymbol] = useState<FormulaSymbol | null>(null)
  const [tinyStep, setTinyStep] = useState(0)

  const load = async () => {
    setLoading(true)
    setError('')
    try {
      const next = await window.specula.ai.explainFormula({
        bookId, chapterId, source: selection.source, displayText: selection.displayText,
        format: selection.format, contextBefore: selection.contextBefore, contextAfter: selection.contextAfter,
        tone, bookTitle, chapterTitle,
      })
      setResult(next)
      setSelectedSymbol(next.symbols[0] || null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '公式解读失败，请稍后重试')
    } finally { setLoading(false) }
  }

  useEffect(() => {
    void load()
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = overflow }
    // The explorer remounts for each formula.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const steps = result?.tinyRun?.steps || []
  const safeStep = steps.length ? Math.min(tinyStep, steps.length - 1) : 0
  return <section className="formula-explorer" aria-label="AI 公式解读器">
    <header className="formula-explorer-header">
      <div><span>SPECULA · FORMULA NOTES</span><h2>AI 公式解读</h2><p>{selection.format.toUpperCase()} · VERIFIED MATH</p></div>
      <button type="button" onClick={onClose} aria-label="关闭公式解读"><X aria-hidden /></button>
    </header>
    <nav className="formula-explorer-tabs" aria-label="公式讲解视图">
      {TABS.map(({ id, label, icon: Icon }) => <button key={id} type="button" className={tab === id ? 'is-current' : ''} aria-current={tab === id ? 'page' : undefined} aria-label={`formula-tab-${id}`} onClick={() => setTab(id)}><Icon aria-hidden /><span>{label}</span></button>)}
    </nav>
    <div className="formula-explorer-body">
      <div className="formula-explorer-stage">
        <FormulaDisplay text={selection.displayText || selection.source} symbols={result?.symbols || []} selected={selectedSymbol?.token || ''} onSelect={setSelectedSymbol} />
        {selectedSymbol && <aside className="formula-symbol-popover" aria-label="formula-symbol-detail">
          <b>{selectedSymbol.token}</b><p>{selectedSymbol.meaning}</p>
          <dl><div><dt>SHAPE</dt><dd>{selectedSymbol.dimension}</dd></div><div><dt>DEFINED</dt><dd>{selectedSymbol.definedAt || '当前公式'}</dd></div><div><dt>LAST SEEN</dt><dd>{selectedSymbol.previousOccurrence || '未确认'}</dd></div></dl>
        </aside>}
        <small>点带下划线的符号查看身份与维度</small>
      </div>
      <div className="formula-explorer-notes" aria-live="polite">
        {loading && <div className="formula-explorer-loading"><Loader2 aria-hidden /> 正在核对符号与运算顺序</div>}
        {error && <div className="formula-explorer-error"><p>{error}</p><button type="button" onClick={() => void load()}>重试</button></div>}
        {result?.fallback && <div className="formula-explorer-error"><p>{result.fallbackText}</p></div>}
        {!loading && result && !result.fallback && tab === 'symbols' && <div className="formula-symbol-table">
          <header><span>SYMBOL</span><span>它是谁</span><span>SHAPE / DIMENSION</span></header>
          {result.symbols.map((symbol) => <button type="button" key={symbol.token} onClick={() => setSelectedSymbol(symbol)}><b>{symbol.token}</b><span>{symbol.meaning}</span><small>{symbol.dimension}</small></button>)}
        </div>}
        {!loading && result && tab === 'pipeline' && <ol className="formula-pipeline">
          {result.pipelineSteps.map((step, index) => <li key={`${step.expression}-${index}`}><b>{String(index + 1).padStart(2, '0')}</b><div><code>{step.expression}</code><p>{step.explanation}</p><small>{step.inputShape || '?'} → {step.outputShape || '?'}</small></div></li>)}
          {result.mnemonic && <li className="is-mnemonic"><b>记</b><div><p>{result.mnemonic}</p></div></li>}
        </ol>}
        {!loading && result && tab === 'tiny_run' && (result.tinyRun ? <div className="formula-tiny-run">
          <section><span>ASSUMPTIONS</span>{result.tinyRun.assumptions.map((item, index) => <code key={index}>{item}</code>)}</section>
          {steps[safeStep] && <article><header><span>STEP {safeStep + 1}/{steps.length}</span><b>VERIFIED</b></header><code>{steps[safeStep].expression}</code><p>{steps[safeStep].calculation}</p><strong>= {steps[safeStep].result}</strong><footer><button disabled={safeStep === 0} onClick={() => setTinyStep((value) => Math.max(0, value - 1))}><ChevronLeft />上一步</button><button disabled={safeStep === steps.length - 1} onClick={() => setTinyStep((value) => Math.min(steps.length - 1, value + 1))}>下一步<ChevronRight /></button></footer></article>}
          {safeStep === steps.length - 1 && <p className="formula-tiny-run__conclusion">{result.tinyRun.conclusion}</p>}
        </div> : <div className="formula-explorer-error"><p>数值例子未通过独立复算，本次不展示，避免用错误计算误导你。</p></div>)}
        {!loading && result && tab === 'rationale' && <div className="formula-rationale">{result.rationale.map((item, index) => <article key={`${item.part}-${index}`}><header><code>{item.part}</code><span>WHY IT EXISTS</span></header><p>{item.purpose}</p><aside><b>拿掉它会怎样？</b>{item.counterfactual}</aside></article>)}</div>}
      </div>
    </div>
    <footer className="formula-explorer-footer">公式、上下文与维度是唯一依据 · 数值例子通过独立模型复算后才展示</footer>
  </section>
}
