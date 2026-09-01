/**
 * One chunk per language.
 *
 * The four namespaces are imported together so choosing a language costs a
 * single request instead of four, and so the bundler can keep them out of the
 * main bundle entirely.
 */
import chat from './chat.json';
import common from './common.json';
import settings from './settings.json';
import sidebar from './sidebar.json';

export default { chat, common, settings, sidebar };
