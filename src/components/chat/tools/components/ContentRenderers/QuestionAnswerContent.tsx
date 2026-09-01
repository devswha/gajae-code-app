import React, { useState } from 'react';

import type { Question } from '../../../types/types';

import { MarkdownContent } from './MarkdownContent';

interface QuestionAnswerContentProps { questions: Question[]; answers: Record<string, string>; className?: string; }

type SafeOption = Question['options'][number];
type SafeQuestion = Question & { options?: unknown };

const questionIsUsable = (value: unknown): value is SafeQuestion =>
  typeof value === 'object' && value !== null && typeof (value as { question?: unknown }).question === 'string';

const availableOptions = (question: SafeQuestion): SafeOption[] =>
  Array.isArray(question.options)
    ? question.options.filter((option): option is SafeOption => (
      typeof option === 'object' && option !== null && typeof (option as { label?: unknown }).label === 'string'
    ))
    : [];

const CheckMark = () => (
  <svg className="h-2 w-2 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
  </svg>
);

const AnswerChip = ({ label, custom }: { label: string; custom: boolean }) => (
  <span className="inline-flex items-center gap-1 rounded-md bg-accent px-1.5 py-0.5 text-xs font-medium text-foreground">
    {label}
    {custom && <span className="text-[10px] font-normal text-muted-foreground">(custom)</span>}
  </span>
);

const SelectionIndicator = ({ selected, multiSelect }: { selected: boolean; multiSelect?: boolean }) => (
  <div className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${multiSelect ? 'rounded-[3px]' : 'rounded-full'} flex items-center justify-center border-[1.5px] ${
    selected ? 'border-primary bg-primary' : 'border-border'
  }`}>
    {selected && <CheckMark />}
  </div>
);

export const QuestionAnswerContent: React.FC<QuestionAnswerContentProps> = ({ questions, answers, className = '' }) => {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  if (!Array.isArray(questions) || questions.length === 0) return null;

  const hasAnyAnswer = Object.keys(answers || {}).length > 0;
  const count = questions.length;

  return (
    <div className={`space-y-2 ${className}`}>
      {questions.map((candidate, index) => {
        if (!questionIsUsable(candidate)) return null;

        const options = availableOptions(candidate);
        const rawAnswer = answers?.[candidate.question];
        const labels = typeof rawAnswer === 'string' ? rawAnswer.split(', ') : [];
        const expanded = expandedIdx === index;
        const skipped = !rawAnswer;
        const isKnownOption = (label: string) => options.some((option) => option.label === label);

        return (
          <div key={index} className="overflow-hidden rounded-xl border border-border bg-card text-foreground">
            <button
              type="button"
              onClick={() => setExpandedIdx(expanded ? null : index)}
              className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent"
            >
              <div className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${labels.length > 0 ? 'bg-accent' : 'bg-muted'}`}>
                {labels.length > 0 ? (
                  <svg className="h-2.5 w-2.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : <div className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  {candidate.header && <span className="inline-flex items-center rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">{candidate.header}</span>}
                  {count > 1 && <span className="text-[10px] text-muted-foreground tabular-nums">{index + 1}/{count}</span>}
                </div>
                <MarkdownContent
                  content={candidate.question}
                  className="mt-0.5 text-sm leading-relaxed text-foreground [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
                />

                {!expanded && labels.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {labels.map((label) => <AnswerChip key={label} label={label} custom={!isKnownOption(label)} />)}
                  </div>
                )}
                {!expanded && skipped && hasAnyAnswer && <span className="mt-1 inline-block text-[10px] text-muted-foreground italic">Skipped</span>}
              </div>

              <svg
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {expanded && (
              <div className="border-t border-border px-3 pt-0.5 pb-2.5">
                <div className="ml-6.5 space-y-1">
                  {options.map((option) => {
                    const selected = labels.includes(option.label);
                    return (
                      <div key={option.label} className={`flex items-start gap-2 rounded-lg px-2.5 py-1.5 text-xs leading-relaxed ${selected ? 'border border-primary/40 bg-accent/70' : 'text-muted-foreground'}`}>
                        <SelectionIndicator selected={selected} multiSelect={candidate.multiSelect} />
                        <div className="min-w-0 flex-1">
                          <span className={selected ? 'font-medium text-foreground' : ''}>{option.label}</span>
                          {option.description && <span className={`mt-0.5 block text-xs leading-relaxed ${selected ? 'text-primary' : 'text-muted-foreground'}`}>{option.description}</span>}
                        </div>
                      </div>
                    );
                  })}
                  {labels.filter((label) => !isKnownOption(label)).map((label) => (
                    <div key={label} className="flex items-start gap-2 rounded-lg border border-primary/40 bg-accent/70 px-2.5 py-1.5 text-xs leading-relaxed">
                      <SelectionIndicator selected multiSelect={candidate.multiSelect} />
                      <div className="min-w-0 flex-1">
                        <span className="font-medium text-foreground">{label}</span>
                        <span className="ml-1 text-[10px] text-muted-foreground">(custom)</span>
                      </div>
                    </div>
                  ))}
                  {skipped && hasAnyAnswer && <div className="px-2.5 py-1 text-xs text-muted-foreground italic">No answer provided</div>}
                </div>
              </div>
            )}
          </div>
        );
      })}
      {!hasAnyAnswer && count === 1 && <div className="text-xs text-muted-foreground italic">Skipped</div>}
    </div>
  );
};
