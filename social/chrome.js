// @ts-check
// Shared page chrome for every page except the landing page. It has three pieces, all built from one
// list of destinations so they can't drift apart:
//  - a top bar on every page: an optional back arrow, the page title, and a "How to play" button,
//  - a bottom tab bar on phones with the four main destinations (phone guidance favours a fixed tab bar),
//  - a collapsible sidebar on desktop with the same destinations.
// Phones never show the sidebar and desktops never show the tab bar, so each screen has one set of links.
// During a match the tab bar and sidebar are hidden (body.in-game) so the game has the whole screen.

const STORAGE_KEY = 'sidebarOpen';

// Plain stroke icons on a 24px grid, matching the back arrows used across the pages.
const ICON = {
  back: '<path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  close: '<path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>',
  help: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M9.5 9.5a2.5 2.5 0 115 0c0 1.7-2.5 2-2.5 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.2" r="1.2" fill="currentColor"/>',
  play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
  profile: '<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  friends: '<circle cx="9" cy="8" r="3.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M2.5 20c1-3.5 3.5-5 6.5-5s5.5 1.5 6.5 5M16 4.5a3.5 3.5 0 010 7M21.5 20c-.6-2.3-2-3.8-4-4.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  leaderboard: '<path d="M4 20V11h5v9M9.5 20V5h5v15M15 20v-7h5v7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>'
};

/** @param {keyof typeof ICON} name @param {number} [size] */
function svg(name, size = 20){
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${ICON[name]}</svg>`;
}

/** @typedef {'play'|'profile'|'friends'|'leaderboard'} Section */

/**
 * Mounts the top bar, tab bar, sidebar, and help dialog into the page.
 * @param {{active: Section|null, title: string, back?: string|null, tabs?: boolean, sidebar?: boolean}} opts
 *   `active` marks the current section. `back` is the URL for the top-bar back arrow, or null for none.
 */
export async function mountChrome(opts){
  const { active, title, back = null, tabs = true, sidebar = true } = opts;

  // The Profile destination needs the signed-in username. If the lookup fails, the link is left out
  // and everything else still works (the signed-out pages use this too).
  let username = null;
  try{
    const res = await fetch('/api/me');
    if(res.ok) username = /** @type {{username:string}} */ (await res.json()).username;
  } catch {
    username = null;
  }

  /** @type {Array<{key: Section, label: string, href: string}>} */
  const destinations = [
    { key: 'play', label: 'Play', href: '/' },
    ...(username ? [{ key: /** @type {Section} */ ('profile'), label: 'Profile', href: `/social/social.html?user=${encodeURIComponent(username)}` }] : []),
    { key: 'friends', label: 'Friends', href: '/social/social.html?view=friends' },
    { key: 'leaderboard', label: 'Leaderboard', href: '/social/social.html?view=leaderboard' }
  ];
  const iconFor = /** @type {Record<Section, keyof typeof ICON>} */ ({ play: 'play', profile: 'profile', friends: 'friends', leaderboard: 'leaderboard' });

  // Top bar: back arrow (optional), title, help. It's inserted first so it sits above everything.
  const top = document.createElement('header');
  top.className = 'topbar';
  top.innerHTML = `
    <div class="top-side">${back ? `<a class="top-btn" href="${back}" aria-label="Back">${svg('back', 18)}</a>` : ''}</div>
    <h1 class="top-title">${title}</h1>
    <div class="top-side right"><button type="button" class="top-btn" id="helpBtn" aria-label="How to play">${svg('help', 22)}</button></div>`;
  document.body.prepend(top);

  // How to play, in a native dialog so it traps focus and closes on Escape.
  const dialog = document.createElement('dialog');
  dialog.className = 'help-dialog';
  dialog.innerHTML = `
    <div class="help-card">
      <h2 class="help-title">How to play</h2>
      <ol class="help-steps">
        <li>Five rounds, each with one numeric trivia question.</li>
        <li>Type your best number, then pick a unit from hundred up to quadrillion.</li>
        <li>The guess closest to the answer wins the round. Ties all win.</li>
        <li>Each round, the closest guess earns 10 points, the next 6, then 3, then 1. Ties share the places they cover.</li>
        <li>The match goes to the most round wins, then the most points.</li>
      </ol>
      <button type="button" class="btn primary" id="helpClose">Got it</button>
    </div>`;
  document.body.appendChild(dialog);
  top.querySelector('#helpBtn')?.addEventListener('click', () => dialog.showModal());
  dialog.querySelector('#helpClose')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', e => { if(e.target === dialog) dialog.close(); });

  if(tabs){
    const bar = document.createElement('nav');
    bar.className = 'tabbar';
    bar.setAttribute('aria-label', 'Main');
    bar.innerHTML = destinations.map(d => {
      const current = d.key === active;
      return `<a class="tab${current ? ' current' : ''}" href="${d.href}"${current ? ' aria-current="page"' : ''}>${svg(iconFor[d.key], 22)}<span>${d.label}</span></a>`;
    }).join('');
    document.body.appendChild(bar);
    document.body.classList.add('has-tabs');
  }

  if(sidebar){
    mountSidebar(destinations, iconFor, active);
  }
}

/**
 * Desktop sidebar. Open by default on wide screens and pushes the page over. Its open state is
 * remembered once the player toggles it. On phones the CSS hides it entirely.
 * @param {Array<{key: Section, label: string, href: string}>} destinations
 * @param {Record<Section, keyof typeof ICON>} iconFor
 * @param {Section|null} active
 */
function mountSidebar(destinations, iconFor, active){
  // Desktop starts open, phones start collapsed. A saved choice from the toggle wins over both.
  let open = window.matchMedia('(min-width: 768px)').matches;
  try{
    const saved = localStorage.getItem(STORAGE_KEY);
    if(saved !== null) open = saved === '1';
  } catch {
    // Private windows can refuse storage. The default above still applies.
  }

  const aside = document.createElement('aside');
  aside.className = 'side';
  aside.setAttribute('aria-label', 'Site navigation');
  aside.innerHTML = `
    <button type="button" class="side-toggle" id="sideToggle" aria-controls="sideNav">${svg('menu')}</button>
    <nav class="side-nav" id="sideNav">
      ${destinations.map(d => {
        const current = d.key === active;
        return `<a class="side-link${current ? ' current' : ''}" href="${d.href}" title="${d.label}"${current ? ' aria-current="page"' : ''}>${svg(iconFor[d.key])}<span class="side-label">${d.label}</span></a>`;
      }).join('')}
    </nav>`;
  document.body.prepend(aside);
  document.body.classList.add('side-layout');

  const toggle = /** @type {HTMLButtonElement} */ (aside.querySelector('#sideToggle'));

  /** @param {boolean} next */
  function apply(next){
    open = next;
    aside.classList.toggle('open', open);
    document.body.classList.toggle('side-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Collapse sidebar' : 'Expand sidebar');
    toggle.innerHTML = svg(open ? 'close' : 'menu');
  }

  // Only the player's own click is remembered. Saving the default would freeze the phone-sized
  // default into storage and override the desktop default on the next visit.
  toggle.addEventListener('click', () => {
    apply(!open);
    try{
      localStorage.setItem(STORAGE_KEY, open ? '1' : '0');
    } catch {
      // Not being able to remember the choice is fine. It resets on reload.
    }
  });
  apply(open);
}
