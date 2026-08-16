import './styles.css';
import { renderLandingPage } from './page.js';

function el(html) {
  const template = document.createElement('template');
  template.innerHTML = html.trim();
  return template.content;
}

document.getElementById('app').replaceChildren(el(renderLandingPage()));
