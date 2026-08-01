/* ============================================================
   Real Estate Investor Toolkit — app shell
   Suite header, tool switcher, and Google sign-in shared by
   every tool page. Include after the page's #shellHeader div:
     <div id="shellHeader"></div>
     <script src="shell.js"></script>
     <script> Shell.mount('rental'); </script>
   ============================================================ */
(function(){
'use strict';

/* ---- Google sign-in (single sign-on) ----
   To activate: create an OAuth Client ID (type "Web application") at
   console.cloud.google.com → APIs & Services → Credentials, add your site's URL
   (e.g. your production URL and http://localhost:8000) to
   "Authorized JavaScript origins", then paste the client ID below.
   Sign-in is disabled on file:// pages — serve the folder over http(s) to test. */
const GOOGLE_CLIENT_ID = '';

const TOOLS = [
  { id:'rental',   name:'Rental Property Analyzer', href:'rental.html',
    desc:'Cash flow, cash-on-cash, DSCR & 5-year pro-forma' },
  { id:'mortgage', name:'Mortgage Calculator', href:'mortgage.html',
    desc:'Payment breakdown, amortization & extra-payment savings' },
  { id:'portfolio', name:'Portfolio ROE Dashboard', href:'portfolio.html',
    desc:'Equity, cash flow & return on equity across your rentals' },
];

let user = null;
try {
  user = JSON.parse(localStorage.getItem('suiteUser'))
      || JSON.parse(localStorage.getItem('rentalUser'));   /* migrate older key */
} catch {}

let currentTool = null;

function esc(s){ const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

function mount(toolId){
  currentTool = TOOLS.find(t => t.id === toolId) || null;
  const host = document.getElementById('shellHeader');
  if (!host) return;
  host.innerHTML = `
    <header class="shell-bar">
      <a class="shell-brand" href="index.html"><span class="dot"></span>Real Estate Investor <em>Toolkit</em></a>
      <div class="shell-right">
        <div class="shell-switch-wrap">
          <button class="shell-switch" id="shellSwitch">${esc(currentTool ? currentTool.name : 'All tools')} ▾</button>
          <div class="shell-menu" id="shellMenu">
            ${TOOLS.map(t => `
              <a href="${t.href}" class="${currentTool && t.id === currentTool.id ? 'cur' : ''}">
                <div class="sm-n">${esc(t.name)}</div>
                <div class="sm-d">${esc(t.desc)}</div>
              </a>`).join('')}
          </div>
        </div>
        <div class="shell-account" id="shellAccount"></div>
      </div>
    </header>`;

  const sw = document.getElementById('shellSwitch');
  const menu = document.getElementById('shellMenu');
  sw.addEventListener('click', ev => { ev.stopPropagation(); menu.classList.toggle('open'); });
  document.addEventListener('click', ev => {
    if (!document.contains(ev.target)) return;
    if (!ev.target.closest('.shell-switch-wrap')) menu.classList.remove('open');
  });

  renderAccount();
  initGoogle();
}

/* ---------------- auth ---------------- */
function jwtPayload(t){
  const b = t.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
  return JSON.parse(decodeURIComponent(escape(atob(b))));
}
function setUser(u){
  user = u;
  if (u) localStorage.setItem('suiteUser', JSON.stringify(u));
  else localStorage.removeItem('suiteUser');
  localStorage.removeItem('rentalUser');   /* clear legacy key */
  renderAccount();
  window.dispatchEvent(new CustomEvent('shell:user', { detail: user }));
}
function renderAccount(){
  const area = document.getElementById('shellAccount');
  if (!area) return;
  area.innerHTML = '';
  if (user){
    if (user.picture){
      const img = document.createElement('img');
      img.src = user.picture; img.alt = ''; img.referrerPolicy = 'no-referrer';
      area.appendChild(img);
    }
    const name = document.createElement('span');
    name.className = 'an';
    name.textContent = user.name || user.email || 'Signed in';
    const out = document.createElement('button');
    out.className = 'btn ghost';
    out.textContent = 'Sign out';
    out.addEventListener('click', () => {
      try { google.accounts.id.disableAutoSelect(); } catch {}
      setUser(null);
      shellToast('Signed out');
    });
    area.appendChild(name);
    area.appendChild(out);
    return;
  }
  if (GOOGLE_CLIENT_ID && window.google?.accounts?.id && location.protocol !== 'file:'){
    const slot = document.createElement('div');
    area.appendChild(slot);
    google.accounts.id.renderButton(slot, {theme:'outline', size:'medium', shape:'pill', text:'signin_with'});
  } else {
    const b = document.createElement('button');
    b.className = 'btn ghost';
    b.textContent = 'Sign in';
    b.addEventListener('click', () => {
      shellToast(location.protocol === 'file:'
        ? 'Google sign-in needs the app served over http(s) — it will activate once hosted'
        : 'Add your Google OAuth client ID to GOOGLE_CLIENT_ID in shell.js to enable sign-in');
    });
    area.appendChild(b);
  }
}
function initGoogle(tries = 0){
  if (!GOOGLE_CLIENT_ID || location.protocol === 'file:') return;
  if (!window.google?.accounts?.id){
    if (tries < 20) setTimeout(() => initGoogle(tries+1), 300);
    return;
  }
  google.accounts.id.initialize({
    client_id: GOOGLE_CLIENT_ID,
    auto_select: true,
    callback: resp => {
      try {
        const p = jwtPayload(resp.credential);
        setUser({ sub:p.sub, name:p.name, email:p.email, picture:p.picture });
        shellToast(`Signed in as ${p.name || p.email}`);
      } catch { shellToast('Sign-in failed — try again'); }
    },
  });
  if (!user) renderAccount();
}

/* ---------------- toast (works even before a page defines one) ---------------- */
let toastTimer;
function shellToast(msg){
  let t = document.getElementById('toast');
  if (!t){
    t = document.createElement('div');
    t.id = 'toast'; t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}

window.Shell = {
  mount,
  getUser: () => user,
  TOOLS,
  toast: shellToast,
};
})();
