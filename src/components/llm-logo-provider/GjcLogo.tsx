type GjcLogoProps = {
  className?: string;
};

// gjc (Gajae Code) provider mark — the transparent vector (public/mark.svg,
// transparent). Used as the session/provider icon everywhere SessionProviderLogo
// dispatches gjc (sidebar list, chat avatar, headers) so gjc sessions are instantly
// recognizable and on-brand instead of reusing the Claude logo.
const GjcLogo = ({ className = 'w-6 h-6' }: GjcLogoProps) => (
  <img src="/mark.svg" alt="gjc" className={`${className} object-contain`} />
);

export default GjcLogo;
