# Website fonts

Self-hosted, so the page makes no font requests to a CDN. Both families are variable on the
weight axis and licensed under the SIL Open Font License 1.1. The full license texts are in
this folder.

| File | CSS family | Weights | Size | Source | License |
|---|---|---|---|---|---|
| `GajaeWebSans-Variable-latin.woff2` | `Gajae Web Sans` | 45–930 | 56,448 B | Pretendard Variable 1.3.9 (Latin subset, renamed) | OFL-1.1, `LICENSE-Pretendard.txt` |
| `GeistMono-Variable-latin.woff2` | `Geist Mono` | 100–900 | 23,128 B | Geist Mono v6, latin subset from `@fontsource-variable/geist-mono` 5.3.0 (unmodified) | OFL-1.1, `LICENSE-GeistMono.txt` |

## Sans: a Latin subset of Pretendard Variable

- **Source:** `node_modules/pretendard/dist/public/variable/PretendardVariable.ttf`
  (npm `pretendard` 1.3.9, font version 1.309, © Kil Hyung-jin,
  https://github.com/orioncactus/pretendard). This is the typeface the app itself uses.
- **Why it has a different name:** Pretendard's license has a Reserved Font Name
  ("Pretendard"). The OFL FAQ counts subsetting as modification, and a modified version may
  not use a Reserved Font Name. So the subset's internal name table says
  `Gajae Web Sans` / `GajaeWebSans-*`. The glyphs, metrics and outlines are Pretendard's,
  unchanged. The copyright, trademark, designer and license name records are kept. Name ID
  10 records where the font came from.
- **Coverage (365 code points):** Basic Latin, Latin-1 Supplement (· × ÷ ± © ®), the
  Windows-1252 extras (Œ œ Š š Ž ž Ÿ ƒ ı), General Punctuation (– — ‘ ’ “ ” … • ‹ › and
  thin/hair spaces), € ₩ ™ − ∞ ≈ ≠ ≤ ≥, arrows (← ↑ → ↓ ↔ ↩ ↵ ⇧ ⇥ and others), Mac key glyphs
  (⌘ ⌥ ⌃ ⌫ ⎋ ⏎), geometric shapes (● ○ ■ □ ▲ ▶ ▼ ◀ ◆), check marks ✓ ✗, and the Hangul
  syllables 가 재 코 드 앱 (so "가재코드" can be used as a brand accent). Any other Hangul
  falls back to the system font.
- **OpenType features kept:** `kern mark mkmk ccmp locl calt clig rlig liga case tnum pnum
  zero frac numr dnom sups subs ordn cpsp`, plus `ss01` (straight-sided 6/9), `ss03`
  (vertically centred colon), `ss06` (high legibility), `ss07` (one-storey a) and
  `cv01 cv05 cv08 cv11 cv12 cv13`. Use `font-variant-numeric: tabular-nums` for version
  numbers and timers, and `font-feature-settings: "case"` for all-caps labels.
- **How it was built** (fontTools 4.66.0 + brotli):

  ```sh
  pyftsubset PretendardVariable.ttf --flavor=woff2 --no-hinting \
    --unicodes="U+0020-007E,U+00A0-00FF,U+0131,U+0152-0153,U+0160-0161,U+0178,U+017D-017E,U+0192,U+02C6,U+02DA,U+02DC,U+2000-206F,U+20A9,U+20AC,U+2122,U+2190-21FF,U+2212,U+2215,U+221E,U+2248,U+2260,U+2264-2265,U+2303,U+2318,U+2325,U+232B,U+238B,U+23CE,U+25A0-25FF,U+2713-2717,U+FEFF,U+FFFD" \
    --text="가재코드앱" \
    --layout-features="kern,mark,mkmk,ccmp,locl,calt,clig,rlig,liga,case,tnum,pnum,zero,frac,numr,dnom,sups,subs,ordn,cpsp,ss01,ss03,ss06,ss07,cv01,cv05,cv08,cv11,cv12,cv13" \
    --name-IDs='*' --name-languages=0x0409
  # then rename name IDs 1/3/4/6/16/25 and the instance PostScript names
  # "Pretendard Variable" -> "Gajae Web Sans", and add name ID 10 (provenance)
  ```

## Mono: Geist Mono

- **Source:** `@fontsource-variable/geist-mono` 5.3.0, file
  `files/geist-mono-latin-wght-normal.woff2`, copied byte for byte. © 2024 The Geist Project
  Authors, https://github.com/vercel/geist-font. No Reserved Font Name.
- **Coverage:** Basic Latin, Latin-1 (including ·), – — ‘ ’ “ ” … • € ™ − ↑ ↓. It has **no** →,
  ✓ or ⌘. Put the sans after it in the stack so those glyphs come from `Gajae Web Sans`,
  not from a system font.

## Use

```css
@font-face {
  font-family: "Gajae Web Sans";
  src: url("/fonts/GajaeWebSans-Variable-latin.woff2") format("woff2");
  font-weight: 45 930;
  font-style: normal;
  font-display: swap;
}
@font-face {
  font-family: "Geist Mono";
  src: url("/fonts/GeistMono-Variable-latin.woff2") format("woff2");
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
}
:root {
  --sans: "Gajae Web Sans", "Pretendard Variable", Pretendard, -apple-system,
    BlinkMacSystemFont, "Apple SD Gothic Neo", "Segoe UI", sans-serif;
  --mono: "Geist Mono", "Gajae Web Sans", ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

```html
<link rel="preload" href="/fonts/GajaeWebSans-Variable-latin.woff2" as="font" type="font/woff2" crossorigin />
<link rel="preload" href="/fonts/GeistMono-Variable-latin.woff2" as="font" type="font/woff2" crossorigin />
```

Paths: the site builds with `base: './'`. Vite rewrites root-absolute public URLs to
relative ones, both in CSS (`url(/fonts/…)` becomes `url(../fonts/…)`) and in `index.html`
(`href="/fonts/…"` becomes `href="./fonts/…"`). This was checked with a Vite 7 build.
Writing `./fonts/…` directly in `index.html` also works. Font preloads always need
`crossorigin`.

Both files were loaded in headless Chromium, which reported the `wght` axis ranges above as
`loaded`. They were rendered at weights 300–900.
