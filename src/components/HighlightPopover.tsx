import { Fragment, useEffect, useRef, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useSettingsStore } from '../stores/settingsStore'
import {
  EXPLANATION_NEED_LABELS,
  type ExplanationNeed,
  type ExplanationSection,
  type StructuredExplanation,
  type TeachingMode,
} from '../types'

interface SelectionInfo {
  text: string
  context: string
  rect: DOMRect
}

interface Props {
  selection: SelectionInfo
  bookId: string
  chapterId: string | null
  bookTitle?: string
  chapterTitle?: string
  action: 'explain' | 'explain-highlight'
  onClose: () => void
  onSaved: () => void
}

const NEEDS = Object.keys(EXPLANATION_NEED_LABELS) as ExplanationNeed[]

const LEGACY_MODE: Record<ExplanationNeed, TeachingMode> = {
  not_understood: 'analogy',
  clarify: 'contrast',
  memorize: 'summary',
  why_design: 'history',
  apply: 'practice',
}

function richText(text: string) {
  return text.split(/(<b>.*?<\/b>)/gis).map((part, index) => {
    const match = part.match(/^<b>(.*?)<\/b>$/is)
    return match ? <strong key={index}>{match[1]}</strong> : <Fragment key={index}>{part}</Fragment>
  })
}

function explanationAsText(result: StructuredExplanation): string {
  return result.sections.map((section) => `### ${section.label}\n${section.text.replace(/<\/?b>/g, '**')}`).join('\n\n')
}

export default function HighlightPopover({
  selection,
  bookId,
  chapterId,
  bookTitle,
  chapterTitle,
  action,
  onClose,
  onSaved,
}: Props) {
  const tone = useSettingsStore((state) => state.explanationTone)
  const [need, setNeed] = useState<ExplanationNeed | null>(null)
  const [results, setResults] = useState<Partial<Record<ExplanationNeed, StructuredExplanation>>>({})
  const [loadingNeed, setLoadingNeed] = useState<ExplanationNeed | null>(null)
  const [error, setError] = useState('')
  const [checkChoice, setCheckChoice] = useState<boolean | null>(null)
  const [tailDone, setTailDone] = useState<Partial<Record<ExplanationNeed, boolean>>>({})
  const [followUpSections, setFollowUpSections] = useState<ExplanationSection[]>([])
  const [tailError, setTailError] = useState('')
  const savedHighlight = useRef(false)
  const requestSerial = useRef(0)

  useEffect(() => {
    if (!need || results[need]) return
    const serial = ++requestSerial.current
    setLoadingNeed(need)
    setError('')
    void window.specula.ai.explainNeed({
      bookId,
      chapterId,
      selectedText: selection.text,
      contextBefore: selection.context,
      need,
      tone,
      bookTitle,
      chapterTitle,
    }).then(async (result) => {
      if (serial !== requestSerial.current) return
      setResults((current) => ({ ...current, [need]: result }))
      if (action === 'explain-highlight' && !savedHighlight.current) {
        savedHighlight.current = true
        await window.specula.highlights.create({
          bookId,
          chapterId,
          selectedText: selection.text,
          context: selection.context,
          aiExplanation: explanationAsText(result),
          teachingMode: LEGACY_MODE[need],
          source: 'user',
          weakPointTopic: null,
          weakPointIndex: null,
        })
        onSaved()
      }
    }).catch((reason) => {
      if (serial === requestSerial.current) setError(reason instanceof Error ? reason.message : 'AI 解释失败')
    }).finally(() => {
      if (serial === requestSerial.current) setLoadingNeed(null)
    })
  }, [action, bookId, bookTitle, chapterId, chapterTitle, need, onSaved, results, selection.context, selection.text, tone])

  const switchNeed = (next: ExplanationNeed) => {
    if (next === need) return
    if (need) {
      void window.specula.ai.recordNeedSwitch({ bookId, chapterId, inferredNeed: null, from: need, to: next })
    }
    setNeed(next)
    setCheckChoice(null)
    setFollowUpSections([])
    setTailError('')
  }

  const result = need ? results[need] : undefined
  const tail = result?.tail

  const answerCheck = async (choice: boolean) => {
    if (!tail || tail.type !== 'check' || checkChoice !== null) return
    setCheckChoice(choice)
    if (choice !== tail.answer) {
      await window.specula.ai.markNeedsReview({
        bookId,
        chapterId,
        selectedText: selection.text,
        question: tail.question,
      })
    }
  }

  const followDeeper = async (question: string) => {
    if (tailDone.clarify) return
    setTailDone((current) => ({ ...current, clarify: true }))
    setTailError('')
    try {
      const deeper = await window.specula.ai.explainNeed({
        bookId,
        chapterId,
        selectedText: selection.text,
        contextBefore: selection.context,
        need: 'clarify',
        tone,
        bookTitle,
        chapterTitle,
        followUp: question,
      })
      setFollowUpSections(deeper.sections)
    } catch (reason) {
      setTailDone((current) => ({ ...current, clarify: false }))
      setTailError(reason instanceof Error ? reason.message : '追问失败，请重试')
    }
  }

  const performTailAction = async () => {
    if (!need || !tail || tailDone[need]) return
    setTailError('')
    setTailDone((current) => ({ ...current, [need]: true }))
    try {
      if (tail.type === 'flashcard') {
        await window.specula.ai.saveFlashcard({ bookId, chapterId, selectedText: selection.text, front: tail.front, back: tail.back })
      } else if (tail.type === 'pattern') {
        await window.specula.ai.saveExploration({ bookId, chapterId, selectedText: selection.text, question: tail.question })
      } else if (tail.type === 'action') {
        await window.specula.ai.createLearningTask({ bookId, chapterId, task: tail.task })
      }
    } catch (reason) {
      setTailDone((current) => ({ ...current, [need]: false }))
      setTailError(reason instanceof Error ? reason.message : '操作失败，请重试')
    }
  }

  return (
    <>
      <button type="button" className="ai-explain-dim" aria-label="关闭 AI 解释" onClick={onClose} />
      <section className="ai-explain-sheet" aria-label="AI 解释面板">
        <div className="ai-explain-inner">
          <header className="ai-explain-header">
            <h2>AI 解释</h2>
            <button type="button" onClick={onClose} aria-label="关闭"><X className="h-5 w-5" /></button>
          </header>

          <blockquote className="ai-explain-quote">{selection.text}</blockquote>

          <div className="ai-explain-needs" role="radiogroup" aria-label="讲解需求">
            {NEEDS.map((item) => (
              <button
                key={item}
                type="button"
                role="radio"
                aria-checked={item === need}
                className={item === need ? 'is-current' : ''}
                onClick={() => switchNeed(item)}
              >
                {EXPLANATION_NEED_LABELS[item]}
              </button>
            ))}
          </div>

          <div className="ai-explain-content">
            {!need && (
              <div className="ai-explain-empty" aria-label="ai-explain-choose-need">
                <b>你想从哪个角度理解？</b>
                <span>选择一种讲解方式后，AI 才会开始生成。</span>
              </div>
            )}
            {need && loadingNeed === need && !result && (
              <div className="ai-explain-loading"><Loader2 className="h-4 w-4 animate-spin" /> 正在组织这次讲解</div>
            )}
            {error && <div className="ai-explain-error">{error}</div>}
            {result?.sections.map((section, index) => (
              <section key={`${section.label}-${index}`} className="ai-explain-section">
                <span>{section.label}</span>
                <p>{richText(section.text)}</p>
              </section>
            ))}
            {followUpSections.map((section, index) => (
              <section key={`follow-${section.label}-${index}`} className="ai-explain-section ai-explain-followup">
                <span>{section.label}</span>
                <p>{richText(section.text)}</p>
              </section>
            ))}

            {tail?.type === 'check' && (
              <div className="ai-explain-tail">
                <span>CHECK · 一道是非题</span>
                <p>{tail.question}</p>
                <div className="ai-explain-tail-row">
                  <button type="button" disabled={checkChoice !== null} onClick={() => void answerCheck(true)}>对</button>
                  <button type="button" disabled={checkChoice !== null} onClick={() => void answerCheck(false)}>错</button>
                </div>
                {checkChoice !== null && (
                  <div className="ai-explain-feedback">
                    {checkChoice === tail.answer ? richText(tail.feedbackRight) : richText(tail.feedbackWrong)}
                  </div>
                )}
              </div>
            )}

            {tail?.type === 'deeper' && (
              <div className="ai-explain-tail">
                <span>GO DEEPER</span>
                <p>{tail.question}</p>
                <div className="ai-explain-tail-row">
                  <button type="button" className="is-primary" disabled={tailDone.clarify} onClick={() => void followDeeper(tail.question)}>
                    {tailDone.clarify ? '已展开追问' : '追问它'}
                  </button>
                  <button type="button" disabled={tailDone.clarify} onClick={() => setTailDone((current) => ({ ...current, clarify: true }))}>已经透了</button>
                </div>
              </div>
            )}

            {tail?.type === 'flashcard' && (
              <div className="ai-explain-tail">
                <span>FLASHCARD</span>
                <div className="ai-explain-mini-card"><b>Q: {tail.front}</b><small>A: {tail.back}</small></div>
                <button type="button" aria-label={tailDone.memorize ? 'flashcard-saved' : 'save-flashcard'} className="ai-explain-wide-action" disabled={tailDone.memorize} onClick={() => void performTailAction()}>
                  {tailDone.memorize ? '✓ 已入复习队列 · 明早见' : '存入复习队列'}
                </button>
              </div>
            )}

            {tail?.type === 'pattern' && (
              <div className="ai-explain-tail">
                <span>PATTERN</span><p>{tail.question}</p>
                <button type="button" aria-label={tailDone.why_design ? 'exploration-saved' : 'save-exploration'} className="ai-explain-wide-action" disabled={tailDone.why_design} onClick={() => void performTailAction()}>
                  {tailDone.why_design ? '✓ 已加入探索清单' : '收进探索清单'}
                </button>
              </div>
            )}

            {tail?.type === 'action' && (
              <div className="ai-explain-tail">
                <span>5-MIN ACTION</span><p>{tail.task}</p>
                <button type="button" aria-label={tailDone.apply ? 'learning-task-claimed' : 'claim-learning-task'} className="ai-explain-wide-action" disabled={tailDone.apply} onClick={() => void performTailAction()}>
                  {tailDone.apply ? '✓ 已领任务 · 明天提醒你' : '领下这个任务'}
                </button>
              </div>
            )}

            {tailError && <div className="ai-explain-error">{tailError}</div>}
            {action === 'explain-highlight' && savedHighlight.current && (
              <p className="ai-explain-saved">已保存为划线</p>
            )}
          </div>
        </div>
      </section>
    </>
  )
}
