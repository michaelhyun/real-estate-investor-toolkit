'use client';

/* Same fixed-position toast the original tools used — one element, reused. */
let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(msg: string) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(timer);
  timer = setTimeout(() => t!.classList.remove('show'), 2400);
}
