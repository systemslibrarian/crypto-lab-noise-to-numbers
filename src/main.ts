/**
 * Noise to Numbers — entry point.
 *
 * Mounts six acts into the tabpanels declared in `index.html`, wires the
 * tablist, and renders the honesty panel.
 *
 * TWO THINGS HAPPEN BEFORE ANY FIGURE IS SHOWN.
 *
 *  1. The generated fixture manifest is VALIDATED (`validateManifest`). It is
 *     the only thing between this page and a displayed min-entropy number, so
 *     if any of its internal consistency checks fail — a figure attributed to
 *     a file whose hash does not match, an assessed value that is not the
 *     combination of its own estimators, a full run recorded against a
 *     below-minimum file — the page renders the failure instead of the lab.
 *     Fail-closed, loudly.
 *
 *  2. Panels render LAZILY, on first activation of their tab, so a panel that
 *     is hidden is also absent from the DOM. That keeps the a11y gate honest:
 *     a scan can only see states a reader can actually reach.
 *
 * There is no theme logic here. Dark is pinned in the document head and there
 * is no toggle (§3.2).
 */
import './style.css';
import { ManifestError, validateManifest } from './entropy/manifest.ts';
import { renderSourcePanel } from './ui/sourcePanel.ts';
import { renderInspectPanel } from './ui/inspectPanel.ts';
import { renderAssessPanel } from './ui/assessPanel.ts';
import { renderBreakPanel } from './ui/breakPanel.ts';
import { renderConditionPanel } from './ui/conditionPanel.ts';
import { renderPadPanel } from './ui/padPanel.ts';
import { renderHonesty } from './ui/honesty.ts';
import { el } from './ui/dom.ts';
import type { Manifest } from './entropy/types.ts';
import manifestJson from '../fixtures/manifest.json';

type PanelName = 'source' | 'inspect' | 'assess' | 'break' | 'condition' | 'pad';

function mount(manifest: Manifest): void {
  const rendered = new Set<PanelName>();

  const render = (name: PanelName): void => {
    if (rendered.has(name)) return;
    const root = document.getElementById(`panel-${name}`);
    if (!root) return;
    switch (name) {
      case 'source':
        renderSourcePanel(root, manifest);
        break;
      case 'inspect':
        renderInspectPanel(root, manifest);
        break;
      case 'assess':
        renderAssessPanel(root, manifest);
        break;
      case 'break':
        renderBreakPanel(root, manifest);
        break;
      case 'condition':
        renderConditionPanel(root, manifest);
        break;
      case 'pad':
        renderPadPanel(root);
        break;
    }
    rendered.add(name);
  };

  const tabs = Array.from(document.querySelectorAll<HTMLButtonElement>('.tab-btn'));

  const activate = (name: PanelName, focus: boolean): void => {
    // Act 3 reads what Act 2 loaded, so Act 2 is rendered whenever Act 3 is.
    // Without this, opening Assess first would describe nothing at all.
    if (name === 'assess') render('inspect');
    render(name);
    for (const t of tabs) {
      const isActive = t.dataset.panel === name;
      t.setAttribute('aria-selected', String(isActive));
      t.tabIndex = isActive ? 0 : -1;
      const panel = document.getElementById(`panel-${t.dataset.panel}`);
      if (panel) panel.hidden = !isActive;
      if (isActive && focus) t.focus();
    }
  };

  for (const [i, tab] of tabs.entries()) {
    tab.addEventListener('click', () => activate(tab.dataset.panel as PanelName, false));
    // Arrow-key navigation, which is what a tablist is expected to support.
    tab.addEventListener('keydown', (ev) => {
      const delta = ev.key === 'ArrowRight' ? 1 : ev.key === 'ArrowLeft' ? -1 : 0;
      if (delta === 0) return;
      ev.preventDefault();
      const next = tabs[(i + delta + tabs.length) % tabs.length];
      activate(next.dataset.panel as PanelName, true);
    });
  }

  activate('source', false);

  const list = document.getElementById('honesty-list');
  if (list) renderHonesty(list);
}

function renderManifestFailure(problems: string[]): void {
  const main = document.querySelector('main');
  if (!main) return;
  main.replaceChildren(
    el(
      'div',
      { class: 'card' },
      el(
        'div',
        { class: 'verdict verdict-bad', 'data-verdict': 'manifest-invalid' },
        el('span', { 'aria-hidden': 'true' }, '✕'),
        el(
          'span',
          { class: 'verdict-text' },
          el('strong', {}, 'The fixture manifest did not validate, so this lab is showing no figures. '),
          'Every min-entropy number here is supposed to come from a pinned run of the assessment ' +
            'tool on one exact file. If that record is not internally consistent, the honest ' +
            'thing is to show nothing rather than something.'
        )
      ),
      el('h3', {}, 'What failed'),
      el(
        'ul',
        { role: 'list' },
        ...problems.map((p) => el('li', { role: 'listitem' }, p))
      ),
      el(
        'p',
        { class: 'note' },
        'Regenerate it with: npm run fixtures:assess'
      )
    )
  );
  for (const t of document.querySelectorAll<HTMLButtonElement>('.tab-btn')) t.disabled = true;
  const list = document.getElementById('honesty-list');
  if (list) renderHonesty(list);
}

try {
  mount(validateManifest(manifestJson));
} catch (e) {
  if (e instanceof ManifestError) renderManifestFailure(e.problems);
  else throw e;
}
