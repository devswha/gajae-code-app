import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search, Sparkles } from 'lucide-react';

export type SelectableSkill = {
  name: string;
  description?: string;
  path?: string;
  type?: string;
  metadata?: Record<string, unknown>;
};

type SkillPickerProps = {
  skills: SelectableSkill[];
  onSelect: (skill: SelectableSkill, index: number) => void;
};

const displayName = (skill: SelectableSkill): string =>
  String(skill.metadata?.skillName ?? skill.name.replace(/^\/skill:/, ''));

export default function SkillPicker({ skills, onSelect }: SkillPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [popupPosition, setPopupPosition] = useState({ bottom: 0, left: 0 });

  // The composer form clips its children (overflow-hidden rounded corners), so
  // the popup must escape through a body portal with fixed positioning.
  useEffect(() => {
    if (!open) return;
    setQuery('');
    const rect = rootRef.current?.getBoundingClientRect();
    if (rect) {
      setPopupPosition({
        bottom: window.innerHeight - rect.top + 8,
        left: Math.max(8, Math.min(rect.left, window.innerWidth - 320 - 8)),
      });
    }
    window.requestAnimationFrame(() => searchRef.current?.focus());
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!rootRef.current?.contains(target) && !popupRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const filteredSkills = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return skills;
    return skills.filter((skill) =>
      `${displayName(skill)} ${skill.description ?? ''}`.toLowerCase().includes(normalized),
    );
  }, [query, skills]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        disabled={skills.length === 0}
        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40"
        aria-label="스킬 선택"
        aria-expanded={open}
        title="스킬 선택"
      >
        <Sparkles className="size-4" />
        {skills.length > 0 && (
          <span className="absolute top-0 right-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold text-primary-foreground">
            {skills.length}
          </span>
        )}
      </button>

      {open && createPortal(
        <div
          ref={popupRef}
          className="fixed z-80 w-80 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
          style={{ bottom: popupPosition.bottom, left: popupPosition.left }}
        >
          <div className="px-2 pt-1 pb-1.5">
            <p className="text-xs font-semibold">스킬</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">현재 프로젝트에서 사용할 스킬을 선택합니다.</p>
          </div>
          <div className="relative px-1 pb-1.5">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-3 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="스킬 검색"
              aria-label="스킬 검색"
              className="h-7 w-full rounded-md border border-input bg-background pr-2 pl-7 text-xs outline-hidden placeholder:text-muted-foreground focus:border-ring"
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {filteredSkills.length > 0 ? filteredSkills.map((skill) => {
              const originalIndex = skills.indexOf(skill);
              return (
                <button
                  key={skill.name}
                  type="button"
                  onClick={() => {
                    onSelect(skill, originalIndex);
                    setOpen(false);
                  }}
                  className="flex w-full flex-col rounded-lg px-2.5 py-2 text-left hover:bg-accent"
                >
                  <span className="text-xs font-medium">{displayName(skill)}</span>
                  {skill.description && (
                    <span className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
                      {skill.description}
                    </span>
                  )}
                </button>
              );
            }) : (
              <p className="px-2.5 py-6 text-center text-[11px] text-muted-foreground">
                일치하는 스킬이 없습니다.
              </p>
            )}
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
