// Tailwind's adapter is the complete stylesheet transform chain for this application.
const tailwindPostcssPlugin = '@tailwindcss/postcss'
const stylesheetPipeline = { [tailwindPostcssPlugin]: {} }

export default { plugins: stylesheetPipeline }
