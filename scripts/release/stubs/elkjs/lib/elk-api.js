// Same surface as the bundled entry; the real elk-api.js only differs in how it
// loads its worker, which the stub does not have.
export { default, ElkLayoutUnavailableError, ELK_NOT_BUNDLED_MESSAGE } from './elk.bundled.js';
