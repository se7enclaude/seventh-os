/* Seventh OS — animation de lancement « la constellation », silencieuse, environ 2,4 s.
 * Les icônes de toutes les applis se7en tournent en orbite, se resserrent et tombent au centre ;
 * un éclair, l'icône de Seventh OS apparaît, puis le nom s'écrit lettre par lettre.
 * Un clic ou une touche la passe. Une fois par lancement (pas quand l'interface se recharge). */
(function () {
  'use strict';
  try {
    if (sessionStorage.getItem('boot-done') === '1') return;
    sessionStorage.setItem('boot-done', '1');
  } catch (e) { /* stockage indisponible : on joue l'animation */ }

  var ICONS = ['se7en-ia', 'se7en-download', 'se7en-clip', 'se7en-censored', 'se7en-iptv-player', 'se7en-voice', 'se7en-vision', 'se7en-dualsense', 'se7en-autoclick'];
  var HOLD = 2450;
  var root = document.createElement('div');
  root.className = 'boot';
  var apps = ICONS.map(function (id, i) {
    var a = Math.round(i * 360 / ICONS.length);
    return '<span class="boot-app" style="--i:' + i + ';--a:' + a + 'deg"><img src="icons/' + id + '.png" alt=""></span>';
  }).join('');
  var title = 'SEVENTH OS'.split('').map(function (c, i) {
    var cls = i >= 8 ? ' class="os"' : '';
    return '<span' + cls + ' style="--i:' + i + '">' + (c === ' ' ? '&nbsp;' : c) + '</span>';
  }).join('');
  root.innerHTML = '<div class="boot-orbit"><span class="boot-ring"></span><span class="boot-ring r2"></span>' + apps +
    '<span class="boot-flash"></span><span class="boot-core"><img src="icons/seventh-os.png" alt=""></span></div>' +
    '<div class="boot-title">' + title + '</div><div class="boot-sub">Toutes les applis se7en au même endroit.</div>';

  function leave() {
    if (root.classList.contains('out')) return;
    root.classList.add('out');
    setTimeout(function () { root.remove(); }, 520);
  }
  function mount() {
    document.body.appendChild(root);
    root.querySelectorAll('.boot-title .os').forEach(function (s) { s.style.color = '#E9A19A'; });
    root.querySelectorAll('.boot-app img').forEach(function (img) {
      img.addEventListener('error', function () { img.parentNode.remove(); }); // pas d'attribut onerror : la CSP l'interdit
    });
    root.addEventListener('click', leave);
    window.addEventListener('keydown', leave, { once: true });
    setTimeout(leave, HOLD);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);
})();
