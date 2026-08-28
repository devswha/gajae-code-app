import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PermissionPanelProps } from '../../configs/permissionPanelRegistry';
import type { Question } from '../../../types/types';
import { MarkdownContent } from '../ContentRenderers/MarkdownContent';

export const AskUserQuestionPanel: React.FC<PermissionPanelProps> = ({
  request,
  onDecision,
}) => {
  const input = request.input as { questions?: Question[] } | undefined;
  const questions = useMemo<Question[]>(() => input?.questions || [], [input?.questions]);

  const [currentStep, setCurrentStep] = useState(0);
  const [selections, setSelections] = useState<Map<number, Set<string>>>(() => new Map());
  const [otherTexts, setOtherTexts] = useState<Map<number, string>>(() => new Map());
  const [otherActive, setOtherActive] = useState<Map<number, boolean>>(() => new Map());
  const [mounted, setMounted] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const otherInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => setMounted(true));
  }, []);

  // Focus the container for keyboard events when step changes
  useEffect(() => {
    if (!otherActive.get(currentStep)) {
      containerRef.current?.focus();
    }
  }, [currentStep, otherActive]);

  useEffect(() => {
    if (otherActive.get(currentStep)) {
      otherInputRef.current?.focus();
    }
  }, [otherActive, currentStep]);

  const toggleOption = useCallback((qIdx: number, label: string, multiSelect: boolean) => {
    setSelections(prev => {
      const next = new Map(prev);
      const current = new Set(next.get(qIdx) || []);
      if (multiSelect) {
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
        setOtherActive(p => { const n = new Map(p); n.set(qIdx, false); return n; });
      }
      next.set(qIdx, current);
      return next;
    });
  }, []);

  const toggleOther = useCallback((qIdx: number, multiSelect: boolean) => {
    setOtherActive(prev => {
      const next = new Map(prev);
      const wasActive = next.get(qIdx) || false;
      next.set(qIdx, !wasActive);
      if (!multiSelect && !wasActive) {
        setSelections(p => { const n = new Map(p); n.set(qIdx, new Set()); return n; });
      }
      return next;
    });
  }, []);

  const setOtherText = useCallback((qIdx: number, text: string) => {
    setOtherTexts(prev => { const next = new Map(prev); next.set(qIdx, text); return next; });
  }, []);

  const buildAnswers = useCallback(() => {
    const answers: Record<string, string> = {};
    questions.forEach((q, idx) => {
      const selected = Array.from(selections.get(idx) || []);
      const isOther = otherActive.get(idx) || false;
      const otherText = (otherTexts.get(idx) || '').trim();
      if (isOther && otherText) selected.push(otherText);
      if (selected.length > 0) answers[q.question] = selected.join(', ');
    });
    return answers;
  }, [questions, selections, otherActive, otherTexts]);

  const handleSubmit = useCallback(() => {
    onDecision(request.requestId, { allow: true, updatedInput: { ...input, answers: buildAnswers() } });
  }, [onDecision, request.requestId, input, buildAnswers]);

  const handleSkip = useCallback(() => {
    // Declining has to be `allow: false`. An `allow: true` carrying no answer
    // is rejected by the ask controller by design, which leaves the question
    // open and the turn waiting on an answer that already came and went.
    onDecision(request.requestId, { allow: false, message: 'User skipped the question' });
  }, [onDecision, request.requestId]);

  // Keyboard handler for number keys and navigation
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Don't capture keys when typing in the "Other" input
    if (e.target instanceof HTMLInputElement) return;

    const q = questions[currentStep];
    if (!q) return;
    const multi = q.multiSelect || false;
    const optCount = q.options.length;

    // Number keys 1-9 for options
    const num = parseInt(e.key);
    if (!isNaN(num) && num >= 1 && num <= optCount) {
      e.preventDefault();
      toggleOption(currentStep, q.options[num - 1].label, multi);
      return;
    }

    // 0 for "Other"
    if (e.key === '0') {
      e.preventDefault();
      toggleOther(currentStep, multi);
      return;
    }

    // Enter to advance / submit
    if (e.key === 'Enter') {
      e.preventDefault();
      const isLast = currentStep === questions.length - 1;
      if (isLast) handleSubmit();
      else setCurrentStep(s => s + 1);
      return;
    }

    // Escape to skip
    if (e.key === 'Escape') {
      e.preventDefault();
      handleSkip();
      return;
    }
  }, [currentStep, questions, toggleOption, toggleOther, handleSubmit, handleSkip]);

  if (questions.length === 0) return null;

  const total = questions.length;
  const isSingle = total === 1;
  const q = questions[currentStep];
  const multi = q.multiSelect || false;
  const selected = selections.get(currentStep) || new Set<string>();
  const isOtherOn = otherActive.get(currentStep) || false;
  const isLast = currentStep === total - 1;
  const isFirst = currentStep === 0;
  const hasCurrentSelection = selected.size > 0 || (isOtherOn && (otherTexts.get(currentStep) || '').trim().length > 0);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={`w-full outline-hidden transition-all duration-500 ease-out ${
        mounted ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ transform: mounted ? 'translateY(0)' : 'translateY(0.75rem)' }}
    >
      <div className="relative overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
        {/* Accent line */}
        <div className="absolute top-0 right-0 left-0 h-px bg-primary" />

        {/* Header + Question — compact */}
        <div className="px-4 pt-3.5 pb-2">
          <div className="mb-1.5 flex items-center gap-2.5">
            {/* Question icon */}
            <div className="relative shrink-0">
              <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent">
                <svg className="h-3.5 w-3.5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827m0 3h.01" />
                </svg>
              </div>
              <div className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" />
            </div>

            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">
                Gajae Code needs your input
              </span>
              {q.header && (
                <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-px text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  {q.header}
                </span>
              )}
            </div>

            {/* Step counter */}
            {!isSingle && (
              <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                {currentStep + 1}/{total}
              </span>
            )}
          </div>

          {/* Progress dots (multi-question) */}
          {!isSingle && (
            <div className="mb-2 flex items-center gap-1">
              {questions.map((_, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => setCurrentStep(i)}
                  className={`h-[3px] rounded-full transition-all duration-300 ${
                    i === currentStep
                      ? 'w-5 bg-primary'
                      : i < currentStep
                        ? 'w-2.5 bg-primary/50'
                        : 'w-2.5 bg-muted'
                  }`}
                />
              ))}
            </div>
          )}

          {/* Question text */}
          <MarkdownContent
            content={q.question}
            className="text-sm leading-relaxed font-medium text-foreground [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
          />
          {multi && (
            <span className="text-xs text-muted-foreground">Select all that apply</span>
          )}
        </div>

        {/* Options — tight spacing */}
        <div className="scrollbar-thin max-h-88 overflow-y-auto px-4 pb-2" role={multi ? 'group' : 'radiogroup'} aria-label={q.question}>
          <div className="space-y-1">
            {q.options.map((opt, optIdx) => {
              const isSelected = selected.has(opt.label);
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => toggleOption(currentStep, opt.label, multi)}
                  className={`group flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-all duration-150 ${
                    isSelected
                      ? 'border-primary/40 bg-accent/70'
                      : 'border-border hover:bg-accent'
                  }`}
                >
                  {/* Keyboard hint */}
                  <kbd className={`flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[10px] transition-all duration-150 ${
                    isSelected
                      ? 'bg-primary font-semibold text-primary-foreground'
                      : 'border border-border bg-muted text-muted-foreground'
                  }`}>
                    {optIdx + 1}
                  </kbd>

                  <div className="min-w-0 flex-1">
                    <div className={`text-sm leading-relaxed transition-colors duration-150 ${
                      isSelected
                        ? 'font-medium text-foreground'
                        : 'text-foreground'
                    }`}>
                      {opt.label}
                    </div>
                    {opt.description && (
                      <div className={`text-xs leading-relaxed transition-colors duration-150 ${
                        isSelected
                          ? 'text-primary'
                          : 'text-muted-foreground'
                      }`}>
                        {opt.description}
                      </div>
                    )}
                  </div>

                  {/* Selection check */}
                  {isSelected && (
                    <svg className="h-4 w-4 shrink-0 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  )}
                </button>
              );
            })}

            {/* "Other" option */}
            <button
              type="button"
              onClick={() => toggleOther(currentStep, multi)}
              className={`group flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-all duration-150 ${
                isOtherOn
                  ? 'border-primary/40 bg-accent/70'
                  : 'border-dashed border-border hover:bg-accent'
              }`}
            >
              <kbd className={`flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[10px] transition-all duration-150 ${
                isOtherOn
                  ? 'bg-primary font-semibold text-primary-foreground'
                  : 'border border-border bg-muted text-muted-foreground'
              }`}>
                0
              </kbd>
              <span className={`text-sm leading-relaxed transition-colors ${
                isOtherOn
                  ? 'font-medium text-foreground'
                  : 'text-muted-foreground'
              }`}>
                Other...
              </span>
              {isOtherOn && (
                <svg className="ml-auto h-4 w-4 shrink-0 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
              )}
            </button>

            {/* Other text input — inline */}
            {isOtherOn && (
              <div className="pr-0.5 pl-[30px]">
                <div className="relative">
                  <input
                    ref={otherInputRef}
                    type="text"
                    value={otherTexts.get(currentStep) || ''}
                    onChange={(e) => setOtherText(currentStep, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (isLast) handleSubmit();
                        else setCurrentStep(s => s + 1);
                      }
                      // Prevent container keydown from firing
                      e.stopPropagation();
                    }}
                    placeholder="Type your answer..."
                    className="w-full rounded-lg border-0 bg-muted px-3 py-1.5 text-sm text-foreground ring-1 ring-border outline-hidden transition-shadow duration-200 placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
                  />
                  <kbd className="absolute top-1/2 right-2 rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground" style={{ transform: 'translateY(-50%)' }}>
                    Enter
                  </kbd>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer — compact */}
        <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-2">
          <button
            type="button"
            onClick={handleSkip}
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {isSingle ? 'Skip' : 'Skip all'}
            <span className="ml-1 text-[10px] text-muted-foreground">Esc</span>
          </button>

          <div className="flex items-center gap-1.5">
            {!isSingle && !isFirst && (
              <button
                type="button"
                onClick={() => setCurrentStep(s => s - 1)}
                className="inline-flex items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground transition-all duration-150 hover:bg-accent"
              >
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                </svg>
                Back
              </button>
            )}

            {isLast ? (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!hasCurrentSelection && !Object.keys(buildAnswers()).length}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition-all duration-200 hover:bg-primary/90 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none"
              >
                Submit
                <span className="ml-0.5 font-mono text-[10px] opacity-70">Enter</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setCurrentStep(s => s + 1)}
                className="inline-flex items-center gap-1 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition-all duration-200 hover:bg-primary/90 hover:shadow-md"
              >
                Next
                <span className="ml-0.5 font-mono text-[10px] opacity-70">Enter</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
