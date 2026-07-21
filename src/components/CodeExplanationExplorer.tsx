import { Fragment, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  Eye,
  Footprints,
  ListTree,
  Loader2,
  MessageSquareCode,
  Sparkles,
  X,
} from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import type {
  CodeExplanationMode,
  CodeExplanationResult,
  CodeLineRange,
  CodeSelectionInfo,
} from '../types'

type ExplorerTab = 'overview' | 'mainline' | 'annotations' | 'dry_run'

interface Props {
  selection: CodeSelectionInfo
  bookId: string
  chapterId: string | null
  bookTitle?: string
  chapterTitle?: string
  onClose: () => void
}

const TABS: { id: ExplorerTab; label: string; icon: typeof Eye }[] = [
  { id: 'overview', label: '这段在干嘛', icon: Eye },
  { id: 'mainline', label: '只看主线', icon: ListTree },
  { id: 'annotations', label: '逐行讲', icon: MessageSquareCode },
  { id: 'dry_run', label: '带值走一遍', icon: Footprints },
]

function lineInRanges(line: number, ranges: CodeLineRange[]): boolean {
  return ranges.some((range) => line >= range.start && line <= range.end)
}

function modeForTab(tab: ExplorerTab): CodeExplanationMode {
  if (tab === 'annotations') return 'annotations'
  if (tab === 'dry_run') return 'dry_run'
  return 'structure'
}

export default function CodeExplanationExplorer({
  selection,
  bookId,
  chapterId,
  bookTitle,
  chapterTitle,
  onClose,
}: Props) {
  const tone = useSettingsStore((state) => state.explanationTone)
  const [tab, setTab] = useState<ExplorerTab>('overview')
  const [results, setResults] = useState<Partial<Record<CodeExplanationMode, CodeExplanationResult>>>({})
  const [loadingMode, setLoadingMode] = useState<CodeExplanationMode | null>('structure')
  const [error, setError] = useState('')
  const [expandedFolds, setExpandedFolds] = useState<Set<number>>(new Set())
  const [dryStep, setDryStep] = useState(0)
  const lines = useMemo(() => selection.code.replace(/\r\n?/g, '\n').split('\n'), [selection.code])

  const requestMode = async (mode: CodeExplanationMode) => {
    setLoadingMode(mode)
    setError('')
    try {
      const result = await window.specula.ai.explainCode({
        bookId,
        chapterId,
        code: selection.code,
        language: selection.language,
        contextBefore: selection.contextBefore,
        contextAfter: selection.contextAfter,
        mode,
        tone,
        bookTitle,
        chapterTitle,
      })
      setResults((current) => ({ ...current, [mode]: result }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '代码解读失败，请稍后重试')
    } finally {
      setLoadingMode((current) => current === mode ? null : current)
    }
  }

  useEffect(() => {
    void requestMode('structure')
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previousOverflow
    }
    // The explorer is remounted for each selected code block.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const switchTab = (next: ExplorerTab) => {
    setTab(next)
    setError('')
    const mode = modeForTab(next)
    if (!results[mode] && loadingMode !== mode) void requestMode(mode)
  }

  const structure = results.structure
  const annotationResult = results.annotations
  const dryRunResult = results.dry_run
  const activeMode = modeForTab(tab)
  const activeResult = results[activeMode]
  const dryRun = dryRunResult?.dryRun
  const safeDryStep = dryRun?.steps.length ? Math.min(dryStep, dryRun.steps.length - 1) : 0
  const currentDryStep = dryRun?.steps[safeDryStep]

  const toggleFold = (start: number) => {
    setExpandedFolds((current) => {
      const next = new Set(current)
      if (next.has(start)) next.delete(start)
      else next.add(start)
      return next
    })
  }

  const renderCode = (mode: ExplorerTab) => {
    const folds = mode === 'mainline' ? structure?.foldRanges || [] : []
    const annotations = mode === 'annotations' ? annotationResult?.annotations || [] : []
    const rows: ReactNode[] = []
    let lineIndex = 0
    while (lineIndex < lines.length) {
      const lineNumber = lineIndex + 1
      const fold = folds.find((item) => item.start === lineNumber)
      if (fold && !expandedFolds.has(fold.start)) {
        rows.push(
          <button
            key={`fold-${fold.start}`}
            type="button"
            className="code-explorer-fold"
            onClick={() => toggleFold(fold.start)}
            aria-label={`展开 ${fold.start}-${fold.end} 行`}
          >
            <ChevronRight aria-hidden />
            <span>{fold.label || '辅助逻辑'} · {fold.end - fold.start + 1} 行</span>
            <small>{fold.reason}</small>
          </button>
        )
        lineIndex = fold.end
        continue
      }

      const isCore = mode === 'mainline' && lineInRanges(lineNumber, structure?.coreRanges || [])
      const isDimmed = mode === 'mainline' && !isCore
      const isDryCurrent = mode === 'dry_run' && currentDryStep?.line === lineNumber
      const annotation = annotations.find((item) => item.afterLine === lineNumber)
      const expandedFold = folds.find((item) => lineNumber >= item.start && lineNumber <= item.end && expandedFolds.has(item.start))
      rows.push(
        <Fragment key={`line-${lineNumber}`}>
          <div
            className={`code-explorer-line ${isCore ? 'is-core' : ''} ${isDimmed ? 'is-dimmed' : ''} ${isDryCurrent ? 'is-current-step' : ''}`}
            data-line={lineNumber}
          >
            <span>{lineNumber}</span>
            <code>{lines[lineIndex] || ' '}</code>
            {expandedFold?.start === lineNumber && (
              <button type="button" onClick={() => toggleFold(expandedFold.start)} aria-label="收起辅助逻辑">
                <ChevronLeft aria-hidden />
              </button>
            )}
          </div>
          {annotation && (
            <aside className="code-explorer-annotation" aria-label={`第 ${lineNumber} 行注释`}>
              <span>WHY · L{String(lineNumber).padStart(3, '0')}</span>
              <p>{annotation.why}</p>
              {annotation.relatedConcept && <small>关联本章 · {annotation.relatedConcept}</small>}
            </aside>
          )}
        </Fragment>
      )
      lineIndex += 1
    }
    return rows
  }

  return (
    <section className="code-explorer" aria-label="AI 代码解读器">
      <header className="code-explorer-header">
        <div>
          <span>SPECULA · CODE NOTES</span>
          <h2>AI 代码解读</h2>
          <p>{selection.language || 'CODE'} · {selection.originalLineCount} LINES</p>
        </div>
        <button type="button" onClick={onClose} aria-label="关闭代码解读"><X aria-hidden /></button>
      </header>

      <nav className="code-explorer-tabs" aria-label="代码讲解视图">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            aria-label={`code-tab-${id}`}
            aria-current={tab === id ? 'page' : undefined}
            className={tab === id ? 'is-current' : ''}
            onClick={() => switchTab(id)}
          >
            <Icon aria-hidden />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      {selection.truncated && (
        <div className="code-explorer-notice">代码超过分析上限，本次只解读前 {lines.length} 行，原文保持不变。</div>
      )}

      <div className="code-explorer-body">
        <div className="code-explorer-code" aria-label="带行号的源代码">
          <div className="code-explorer-codebar">
            <span>{selection.language || 'plain text'}</span>
            {structure?.fromCache && <small>CACHED</small>}
          </div>
          <div className="code-explorer-lines">{renderCode(tab)}</div>
        </div>

        <div className="code-explorer-notes" aria-live="polite">
          {loadingMode === activeMode && !activeResult && (
            <div className="code-explorer-loading"><Loader2 aria-hidden /> 正在沿着代码主线阅读</div>
          )}
          {error && (
            <div className="code-explorer-error">
              <p>{error}</p>
              <button type="button" onClick={() => void requestMode(activeMode)}>重试</button>
            </div>
          )}
          {activeResult?.fallback && (
            <div className="code-explorer-fallback">
              <span>PLAIN NOTES</span>
              <p>{activeResult.fallbackText}</p>
            </div>
          )}

          {tab === 'overview' && structure && !structure.fallback && (
            <>
              <section className="code-explorer-note-section">
                <span>ROLE · 整体职责</span>
                <p>{structure.overview?.responsibility || '这段代码的职责暂时无法可靠判断。'}</p>
              </section>
              <section className="code-explorer-note-section">
                <span>IN THIS TRACK · 和本章的关系</span>
                <p>{structure.overview?.chapterRelation || '附近正文没有提供足够线索。'}</p>
              </section>
            </>
          )}

          {tab === 'mainline' && structure && !structure.fallback && (
            <>
              <section className="code-explorer-note-section">
                <span>MAIN ROUTE · 阅读顺序</span>
                <p>先读蓝底行。低对比度内容仍是原代码；折叠条只收起 AI 判断为可暂时略读的辅助逻辑。</p>
              </section>
              <ol className="code-explorer-range-list">
                {structure.coreRanges.map((range) => (
                  <li key={`${range.start}-${range.end}`}>
                    <b>L{range.start}{range.end > range.start ? `–L${range.end}` : ''}</b>
                    <span>{range.reason}</span>
                  </li>
                ))}
              </ol>
            </>
          )}

          {tab === 'annotations' && annotationResult && !annotationResult.fallback && (
            <section className="code-explorer-note-section">
              <span>WHY NOTES · 不是语法翻译</span>
              <p>注释只落在关键行之后，说明为什么这里需要这样做。代码区可以独立滚动查看全部注释。</p>
            </section>
          )}

          {tab === 'dry_run' && dryRun && !dryRunResult?.fallback && (
            <>
              <section className="code-explorer-note-section">
                <span>ASSUMED INPUT · 假设输入</span>
                <ul>{dryRun.assumptions.map((item, index) => <li key={index}>{item}</li>)}</ul>
              </section>
              {currentDryStep && (
                <section className="code-explorer-step" aria-label="dry-run-current-step">
                  <header><span>STEP {safeDryStep + 1}/{dryRun.steps.length}</span><b>L{currentDryStep.line}</b></header>
                  <p>{currentDryStep.action}</p>
                  {Object.keys(currentDryStep.variables).length > 0 && (
                    <dl>
                      {Object.entries(currentDryStep.variables).map(([name, value]) => (
                        <div key={name}><dt>{name}</dt><dd>{value}</dd></div>
                      ))}
                    </dl>
                  )}
                  <footer>
                    <button type="button" disabled={safeDryStep === 0} onClick={() => setDryStep((step) => Math.max(0, step - 1))} aria-label="dry-run-previous"><ChevronLeft aria-hidden /> 上一步</button>
                    <button type="button" disabled={safeDryStep >= dryRun.steps.length - 1} onClick={() => setDryStep((step) => Math.min(dryRun.steps.length - 1, step + 1))} aria-label="dry-run-next">下一步 <ChevronRight aria-hidden /></button>
                  </footer>
                </section>
              )}
              {safeDryStep === dryRun.steps.length - 1 && (
                <section className="code-explorer-note-section is-conclusion">
                  <span>BACK TO THE TRACK · 回到本章</span>
                  {dryRun.result && <p><b>结果：</b>{dryRun.result}</p>}
                  {dryRun.chapterConnection && <p>{dryRun.chapterConnection}</p>}
                </section>
              )}
            </>
          )}
        </div>
      </div>

      <footer className="code-explorer-footer">
        <Sparkles aria-hidden />
        <span>解释基于本段代码与附近正文 · dry run 是假想推演，不是真实执行</span>
      </footer>
    </section>
  )
}
