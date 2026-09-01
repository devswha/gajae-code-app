// Keep release notes predictable by accepting the Conventional Commits vocabulary.
const conventionalPolicy = '@commitlint/config-conventional'
const commitlintConfiguration = { extends: [conventionalPolicy] }

export default commitlintConfiguration
