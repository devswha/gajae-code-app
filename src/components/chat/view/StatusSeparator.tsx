/**
 * The ` · ` between the parts of a status line. `whitespace-pre` keeps its
 * spaces when it opens a flex item, where ordinary leading whitespace is
 * dropped and the line read "Thinking…· Reading".
 */
export default function StatusSeparator() {
  return <span aria-hidden className="whitespace-pre">{' · '}</span>;
}
