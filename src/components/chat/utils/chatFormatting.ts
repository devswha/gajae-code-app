const ENTITY_VALUES: Record<string, string> = { lt: '<', gt: '>', quot: '"', '#39': "'", amp: '&' };
const ESCAPED_CONTROLS: Record<string, string> = { '\\n': '\n', '\\t': '\t', '\\r': '\r' };
const MONTH_ABBREVIATIONS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function decodeHtmlEntities(text: string) {
  return text ? text.replace(/&(lt|gt|quot|#39|amp);/g, (_, entity: string) => ENTITY_VALUES[entity]) : text;
}

export function normalizeInlineCodeFences(text: string) {
  if (typeof text !== 'string' || !text) return text;
  try {
    return text.replace(/```[ \t]*([^\n\r]+?)[ \t]*```/g, (_, code: string) => `\`${code}\``);
  } catch {
    return text;
  }
}

export function unescapeWithMathProtection(text: string) {
  if (typeof text !== 'string' || !text) return text;

  const protectedSegments: string[] = [];
  const marker = (position: number) => `__MATH_BLOCK_${position}__`;
  const withMarkers = text.replace(/\$\$([\s\S]*?)\$\$|\$([^\$\n]+?)\$/g, (segment) => {
    protectedSegments.push(segment);
    return marker(protectedSegments.length - 1);
  });
  const unescaped = withMarkers.replace(/\\[ntr]/g, (escape) => ESCAPED_CONTROLS[escape]);

  return unescaped.replace(/__MATH_BLOCK_(\d+)__/g, (_, position: string) =>
    protectedSegments[Number.parseInt(position, 10)]);
}

export function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const localTimeZoneLabel = (date: Date) => {
  const offset = -date.getTimezoneOffset();
  const offsetHours = Math.floor(Math.abs(offset) / 60);
  const offsetMinutes = Math.abs(offset) % 60;
  const gmt = `GMT${offset >= 0 ? '+' : '-'}${offsetHours}${offsetMinutes ? `:${String(offsetMinutes).padStart(2, '0')}` : ''}`;
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const location = (zone.split('/').pop() || '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());
  return location ? `${gmt} (${location})` : gmt;
};

export function formatUsageLimitText(text: string) {
  if (typeof text !== 'string') return text;
  try {
    return text.replace(/Claude AI usage limit reached\|(\d{10,13})/g, (original, value: string) => {
      const parsed = Number.parseInt(value, 10);
      if (!Number.isFinite(parsed)) return original;
      const resetAt = new Date(parsed < 1e12 ? parsed * 1000 : parsed);
      const clock = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', hour12: false }).format(resetAt);
      const calendarDate = `${resetAt.getDate()} ${MONTH_ABBREVIATIONS[resetAt.getMonth()]} ${resetAt.getFullYear()}`;
      return `Claude usage limit reached. Your limit will reset at **${clock} ${localTimeZoneLabel(resetAt)}** - ${calendarDate}`;
    });
  } catch {
    return text;
  }
}
