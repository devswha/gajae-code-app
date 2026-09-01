import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PermissionPanelProps } from '../../configs/permissionPanelRegistry';
import type { Question } from '../../../types/types';
import { MarkdownContent } from '../ContentRenderers/MarkdownContent';

const replaceMap = <T,>(previous: Map<number, T>, key: number, value: T) => new Map(previous).set(key, value);
const optionClass = (selected: boolean) => `group flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-all duration-150 ${selected ? 'border-primary/40 bg-accent/70' : 'border-border hover:bg-accent'}`;
const keyClass = (selected: boolean) => `flex h-5 w-5 shrink-0 items-center justify-center rounded font-mono text-[10px] transition-all duration-150 ${selected ? 'bg-primary font-semibold text-primary-foreground' : 'border border-border bg-muted text-muted-foreground'}`;

export const AskUserQuestionPanel: React.FC<PermissionPanelProps> = ({ request, onDecision }) => {
  const input = request.input as { questions?: Question[] } | undefined;
  const questions = useMemo(() => input?.questions || [], [input]);
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<Map<number, Set<string>>>(() => new Map());
  const [other, setOther] = useState<Map<number, boolean>>(() => new Map());
  const [otherText, setOtherText] = useState<Map<number, string>>(() => new Map());
  const [visible, setVisible] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const otherField = useRef<HTMLInputElement>(null);
  useEffect(() => { requestAnimationFrame(() => setVisible(true)); }, []);
  useEffect(() => { if (!other.get(step)) panel.current?.focus(); }, [step, other]);
  useEffect(() => { if (other.get(step)) otherField.current?.focus(); }, [step, other]);

  const select = useCallback((index: number, label: string, multiple: boolean) => {
    setPicked((previous) => {
      const choices = new Set(previous.get(index) || []);
      if (multiple) { if (choices.has(label)) { choices.delete(label); } else { choices.add(label); } }
      else { choices.clear(); choices.add(label); setOther((state) => replaceMap(state, index, false)); }
      return replaceMap(previous, index, choices);
    });
  }, []);
  const toggleOther = useCallback((index: number, multiple: boolean) => {
    setOther((previous) => {
      const enabled = !(previous.get(index) || false);
      if (!multiple && enabled) setPicked((state) => replaceMap(state, index, new Set()));
      return replaceMap(previous, index, enabled);
    });
  }, []);
  const answers = useCallback(() => {
    const result: Record<string, string> = {};
    questions.forEach((question, index) => {
      const values = Array.from(picked.get(index) || []);
      const custom = (otherText.get(index) || '').trim();
      if (other.get(index) && custom) values.push(custom);
      if (values.length) result[question.question] = values.join(', ');
    });
    return result;
  }, [other, otherText, picked, questions]);
  const submit = useCallback(() => onDecision(request.requestId, { allow: true, updatedInput: { ...input, answers: answers() } }), [answers, input, onDecision, request.requestId]);
  const skip = useCallback(() => onDecision(request.requestId, { allow: false, message: 'User skipped the question' }), [onDecision, request.requestId]);
  const keyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.target instanceof HTMLInputElement) return;
    const question = questions[step]; if (!question) return;
    const multiple = question.multiSelect || false; const number = parseInt(event.key);
    if (!isNaN(number) && number >= 1 && number <= question.options.length) { event.preventDefault(); select(step, question.options[number - 1].label, multiple); return; }
    if (event.key === '0') { event.preventDefault(); toggleOther(step, multiple); return; }
    if (event.key === 'Enter') { event.preventDefault(); if (step === questions.length - 1) { submit(); } else { setStep((value) => value + 1); } return; }
    if (event.key === 'Escape') { event.preventDefault(); skip(); }
  }, [questions, select, skip, step, submit, toggleOther]);
  if (!questions.length) return null;
  const question = questions[step]; const multiple = question.multiSelect || false; const selected = picked.get(step) || new Set<string>(); const otherOn = other.get(step) || false; const last = step === questions.length - 1; const single = questions.length === 1; const canSubmit = selected.size > 0 || (otherOn && (otherText.get(step) || '').trim().length > 0) || Object.keys(answers()).length > 0;
  const advance = () => setStep((value) => value + 1);
  return <div ref={panel} tabIndex={-1} onKeyDown={keyDown} className={`w-full outline-hidden transition-all duration-500 ease-out ${visible ? 'opacity-100' : 'opacity-0'}`} style={{ transform: visible ? 'translateY(0)' : 'translateY(0.75rem)' }}><div className="relative overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-xl">
    <div className="absolute top-0 right-0 left-0 h-px bg-primary" />
    <div className="px-4 pt-3.5 pb-2"><div className="mb-1.5 flex items-center gap-2.5"><div className="relative shrink-0"><div className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent"><svg className="h-3.5 w-3.5 text-primary" fill="none" viewBox="0 0 24 24" strokeWidth={1.75} stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827m0 3h.01" /></svg></div><div className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary" /></div><div className="flex min-w-0 flex-1 items-center gap-2"><span className="text-[10px] font-medium tracking-wide text-muted-foreground uppercase">Gajae Code needs your input</span>{question.header && <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-px text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{question.header}</span>}</div>{!single && <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">{step + 1}/{questions.length}</span>}</div>
    {!single && <div className="mb-2 flex items-center gap-1">{questions.map((_, index) => <button key={index} type="button" onClick={() => setStep(index)} className={`h-[3px] rounded-full transition-all duration-300 ${index === step ? 'w-5 bg-primary' : index < step ? 'w-2.5 bg-primary/50' : 'w-2.5 bg-muted'}`} />)}</div>}
    <MarkdownContent content={question.question} className="text-sm leading-relaxed font-medium text-foreground [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5" />{multiple && <span className="text-xs text-muted-foreground">Select all that apply</span>}</div>
    <div className="scrollbar-thin max-h-88 overflow-y-auto px-4 pb-2" role={multiple ? 'group' : 'radiogroup'} aria-label={question.question}><div className="space-y-1">{question.options.map((option, index) => { const chosen = selected.has(option.label); return <button key={option.label} type="button" onClick={() => select(step, option.label, multiple)} className={optionClass(chosen)}><kbd className={keyClass(chosen)}>{index + 1}</kbd><div className="min-w-0 flex-1"><div className={`text-sm leading-relaxed transition-colors duration-150 ${chosen ? 'font-medium text-foreground' : 'text-foreground'}`}>{option.label}</div>{option.description && <div className={`text-xs leading-relaxed transition-colors duration-150 ${chosen ? 'text-primary' : 'text-muted-foreground'}`}>{option.description}</div>}</div>{chosen && <svg className="h-4 w-4 shrink-0 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}</button>; })}
    <button type="button" onClick={() => toggleOther(step, multiple)} className={`group flex w-full items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-all duration-150 ${otherOn ? 'border-primary/40 bg-accent/70' : 'border-dashed border-border hover:bg-accent'}`}><kbd className={keyClass(otherOn)}>0</kbd><span className={`text-sm leading-relaxed transition-colors ${otherOn ? 'font-medium text-foreground' : 'text-muted-foreground'}`}>Other...</span>{otherOn && <svg className="ml-auto h-4 w-4 shrink-0 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" /></svg>}</button>
    {otherOn && <div className="pr-0.5 pl-[30px]"><div className="relative"><input ref={otherField} type="text" value={otherText.get(step) || ''} onChange={(event) => setOtherText((state) => replaceMap(state, step, event.target.value))} onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (last) { submit(); } else { advance(); } } event.stopPropagation(); }} placeholder="Type your answer..." className="w-full rounded-lg border-0 bg-muted px-3 py-1.5 text-sm text-foreground ring-1 ring-border outline-hidden transition-shadow duration-200 placeholder:text-muted-foreground focus:ring-2 focus:ring-ring" /><kbd className="absolute top-1/2 right-2 rounded border border-border bg-muted px-1 py-0.5 font-mono text-[10px] text-muted-foreground" style={{ transform: 'translateY(-50%)' }}>Enter</kbd></div></div>}</div></div>
    <div className="flex items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-2"><button type="button" onClick={skip} className="text-xs text-muted-foreground transition-colors hover:text-foreground">{single ? 'Skip' : 'Skip all'}<span className="ml-1 text-[10px] text-muted-foreground">Esc</span></button><div className="flex items-center gap-1.5">{!single && step !== 0 && <button type="button" onClick={() => setStep((value) => value - 1)} className="inline-flex items-center gap-0.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-foreground transition-all duration-150 hover:bg-accent"><svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>Back</button>}{last ? <button type="button" onClick={submit} disabled={!canSubmit} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition-all duration-200 hover:bg-primary/90 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-30 disabled:shadow-none">Submit<span className="ml-0.5 font-mono text-[10px] opacity-70">Enter</span></button> : <button type="button" onClick={advance} className="inline-flex items-center gap-1 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-xs transition-all duration-200 hover:bg-primary/90 hover:shadow-md">Next<span className="ml-0.5 font-mono text-[10px] opacity-70">Enter</span></button>}</div></div>
  </div></div>;
};
