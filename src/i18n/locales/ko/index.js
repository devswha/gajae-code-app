/**
 * One chunk per language.
 *
 * The five namespaces are imported together so choosing a language costs a
 * single request instead of five, and so the bundler can keep them out of the
 * main bundle entirely.
 */
import chat from './chat.json';
import codeEditor from './codeEditor.json';
import common from './common.json';
import settings from './settings.json';
import sidebar from './sidebar.json';

export default { chat, codeEditor, common, settings, sidebar };
