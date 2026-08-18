type GjcLogoProps = {
  className?: string;
};

// gjc (Gajae Code) provider mark — rendered from the one brand artwork (public/logo.png,
// transparent). Used as the session/provider icon everywhere SessionProviderLogo
// dispatches gjc (sidebar list, chat avatar, headers) so gjc sessions are instantly
// recognizable and on-brand instead of reusing the Claude logo.
const GjcLogo = ({ className = 'w-5 h-5' }: GjcLogoProps) => (
  <img src="/logo.png" alt="gjc" className={`${className} object-contain`} />
);

export default GjcLogo;
