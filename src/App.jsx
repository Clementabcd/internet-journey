import React, { useEffect, useMemo, useRef, useState, useCallback } from 'react';

/**
 * Le voyage d'un clic — comment fonctionne Internet
 * Composant React autonome (un seul fichier), version « leçon guidée » :
 * un écran à la fois (prédiction → explication → essai → vérification),
 * avec un schéma animé synchronisé.
 *
 * Utilisation :
 *   import InternetJourney from './InternetJourney.jsx';
 *   <InternetJourney />
 *
 * Aucune dépendance externe à part react. Les polices (Fraunces, DM Sans,
 * JetBrains Mono) sont chargées depuis Google Fonts dans le <style> du
 * composant — retire ces lignes @import si ton projet les charge déjà.
 */

/* ----------------------------- constantes ----------------------------- */

const RTT_EDGE = 12;
const TAGS = ['URL', 'DNS', 'TCP', 'TLS', 'HTTP', 'PAGE'];
const STEPS = [
  { name: 'Adresse', icon: 'link' },
  { name: 'DNS', icon: 'book' },
  { name: 'TCP', icon: 'plug' },
  { name: 'HTTPS', icon: 'lock' },
  { name: 'CDN', icon: 'cloud' },
  { name: 'Page', icon: 'window' },
];
const NODEDEF = {
  you: { icon: 'laptop', color: 'var(--blue)', info: () => `Ton navigateur prépare la requête et garde en mémoire ce qu'il a déjà appris.` },
  resolver: { icon: 'search', color: 'var(--cyan-ink)', info: () => `Le résolveur DNS, fourni par ton opérateur, fait les recherches à ta place et retient les réponses.` },
  root: { icon: 'globe', color: 'var(--cyan-ink)', info: () => `Les serveurs racine ne connaissent aucun site. Ils savent qui gère chaque extension (.fr, .com…).` },
  tld: { icon: 'tag', color: 'var(--cyan-ink)', info: (tl) => `Le serveur de l'extension .${tl} sait qui gère chaque nom de domaine en .${tl}.` },
  auth: { icon: 'shield', color: 'var(--cyan-ink)', info: (_tl, d) => `Le serveur du domaine ${d} détient la vraie réponse : l'adresse IP à contacter.` },
  edge: { icon: 'cloud', color: 'var(--violet-ink)', info: (_tl, _d, cdn) => (cdn ? `Un point de présence du CDN, proche de toi, qui garde des copies des pages populaires.` : `Le CDN est désactivé : personne ne garde de copie près de toi.`) },
  origin: { icon: 'server', color: 'var(--mint-ink)', info: () => `Le serveur d'origine : là où le site est vraiment fabriqué. Il peut être très loin de toi.` },
  spy: { icon: 'eye', color: 'var(--coral-ink)', info: () => `Quelqu'un branché sur le même Wi-Fi public, qui regarde passer les paquets.` },
};
const LINKDEF = [['you', 'resolver'], ['resolver', 'root'], ['resolver', 'tld'], ['resolver', 'auth'], ['you', 'edge'], ['edge', 'origin'], ['you', 'origin']];
const LAYOUTS = {
  wide: {
    vb: '0 0 900 470', r: 36,
    nodes: { you: [90, 255], resolver: [270, 120], root: [470, 72], tld: [650, 120], auth: [820, 205], edge: [440, 305], origin: [810, 385], spy: [250, 395] },
    paths: ['M90,255 Q150,150 270,120', 'M270,120 Q360,62 470,72', 'M270,120 Q460,185 650,120', 'M270,120 Q560,250 820,205', 'M90,255 Q250,340 440,305', 'M440,305 Q620,410 810,385', 'M90,255 Q430,470 810,385'],
  },
  tall: {
    vb: '0 0 420 680', r: 30,
    nodes: { you: [90, 330], resolver: [90, 130], root: [330, 60], tld: [330, 190], auth: [330, 310], edge: [210, 470], origin: [330, 610], spy: [60, 480] },
    paths: ['M90,330 Q40,230 90,130', 'M90,130 Q200,40 330,60', 'M90,130 Q220,190 330,190', 'M90,130 Q260,290 330,310', 'M90,330 Q110,440 210,470', 'M210,470 Q300,560 330,610', 'M90,330 Q200,650 330,610'],
  },
};
const CAM_TALL = [[0, 110, 420, 380], [0, 20, 420, 380], [0, 250, 420, 320], [0, 250, 420, 320], [0, 270, 420, 410], [0, 270, 420, 410]];

/* ------------------------------- helpers ------------------------------- */

const fmt = (n) => Math.round(n).toLocaleString('fr-FR');
const short = (s, n = 22) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const ease = (p) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);
const hash = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; };
const nm = (id, tl) => ({ you: 'Navigateur', resolver: 'Résolveur', root: 'Serveur racine', tld: 'Serveur .' + tl, auth: 'Serveur du domaine', edge: 'CDN', origin: "Serveur d'origine", spy: 'Curieux' }[id]);

function phases(o) {
  const r = o.cdn ? RTT_EDGE : o.origin;
  const dns = o.dnsCached ? 1 : 78;
  const tcp = r + (o.loss ? 1000 : 0);
  const tls = r;
  const http = o.cdn ? (o.hit ? RTT_EDGE + 3 : RTT_EDGE + o.origin + 42) : o.origin + 40;
  return { dns, tcp, tls, http, total: dns + tcp + tls + http };
}

const B = {
  send: (from, to, kind, say, log, ms, x) => ({ type: 'send', from, to, kind, say, log, ms, ...x }),
  self: (node, say, log, ms, x) => ({ type: 'self', node, say, log, ms, ...x }),
  lost: (from, to, say, log, x) => ({ type: 'lost', from, to, kind: 'lost', say, log, ms: 0, ...x }),
  wait: (node, say, log, ms, x) => ({ type: 'wait', node, say, log, ms, ...x }),
};

const ICONS = {
  laptop: 'M4 5h16v11H4zM2 19h20',
  server: 'M3 4h18v7H3zM3 13h18v7H3zM7 7.5h.01M7 16.5h.01',
  globe: 'M12 3a9 9 0 100 18 9 9 0 000-18zM3 12h18M12 3c3.2 3.2 3.2 14.8 0 18M12 3c-3.2 3.2-3.2 14.8 0 18',
  book: 'M5 4h11a3 3 0 013 3v13H8a3 3 0 01-3-3V4zM5 17a3 3 0 013-3h11',
  search: 'M11 5a6 6 0 100 12 6 6 0 000-12zM20 20l-4.5-4.5',
  tag: 'M3 12V4h8l10 10-8 8L3 12zM7.5 8.5a1 1 0 100 .01',
  shield: 'M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6l8-3zM9 12l2 2 4-4',
  cloud: 'M7 18a4 4 0 01-.5-7.97A6 6 0 0118 9a4.5 4.5 0 01.5 9H7z',
  eye: 'M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zM12 12a3 3 0 100-.01',
  lock: 'M5 11h14v9H5zM8 11V8a4 4 0 018 0v3',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  plug: 'M9 3v5M15 3v5M6 8h12v3a6 6 0 01-12 0V8zM12 17v4',
  window: 'M3 4h18v16H3zM3 9h18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  spark: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z',
  help: 'M12 3a9 9 0 100 18 9 9 0 000-18zM9.5 9a2.5 2.5 0 113.5 2.3c-.8.4-1 .8-1 1.7M12 17h.01',
  flag: 'M5 21V4h13l-3 4 3 4H5',
  arrowR: 'M5 12h14M13 6l6 6-6 6',
  arrowL: 'M19 12H5M11 18l-6-6 6-6',
  replay: 'M4 12a8 8 0 113 6.2M4 4v5h5',
};
const Icon = ({ name, className, style }) => (
  <svg className={className || 'ico'} viewBox="0 0 24 24" aria-hidden="true" style={style}>
    <path d={ICONS[name]} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/* ----------------------------- CSS (scoped) ----------------------------- */

const CSS = `
.ij{
  --bg1:#eef2f6;--bg2:#e6ecf3;--ink:#33415c;--ink2:#5c6b87;--ink3:#8493ad;
  --card:#ffffff;--card2:#f6f8fb;--brd:#dfe6ee;--brd2:#e8edf3;
  --shadow:0 16px 36px -22px rgba(51,65,92,.22),0 2px 8px rgba(51,65,92,.05);
  --blue:#5b7fa6;--blue2:#8aa5c2;--cyan:#5c9aa8;--mint:#5fa085;--coral:#c67e6f;--violet:#8983ab;--sun:#c99f5e;
  --cyan-ink:#3f7c8a;--mint-ink:#3f8267;--coral-ink:#a85a4c;--violet-ink:#6a6491;
  --disk:#ffffff;--diskb:#c9d4e0;--halo:#eef2f6;--dot:#d6dfe9;--line:#aebdd0;--onblue:#ffffff;
  background:var(--bg1);color:var(--ink);
  font:400 16px/1.6 'DM Sans',system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  -webkit-font-smoothing:antialiased;min-height:100vh;
}
@media (prefers-color-scheme:dark){
  .ij:not([data-theme="light"]){
    --bg1:#161c26;--bg2:#1c2330;--ink:#dbe2ec;--ink2:#a3aec2;--ink3:#77839c;
    --card:#212836;--card2:#262e3d;--brd:#333e51;--brd2:#2c3444;
    --shadow:0 16px 36px -22px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.2);
    --blue:#7c9bc0;--blue2:#5d7ea3;--cyan:#6fabb8;--mint:#71b498;--coral:#cf9384;--violet:#a29cc4;--sun:#d3b077;
    --cyan-ink:#7fc0cd;--mint-ink:#7fc7a8;--coral-ink:#e2a294;--violet-ink:#b3adcf;
    --disk:#262e3d;--diskb:#3d4a60;--halo:#161c26;--dot:#2c3444;--line:#4a5871;--onblue:#12161e;
  }
}
.ij[data-theme="dark"]{
  --bg1:#161c26;--bg2:#1c2330;--ink:#dbe2ec;--ink2:#a3aec2;--ink3:#77839c;
  --card:#212836;--card2:#262e3d;--brd:#333e51;--brd2:#2c3444;
  --shadow:0 16px 36px -22px rgba(0,0,0,.55),0 2px 8px rgba(0,0,0,.2);
  --blue:#7c9bc0;--blue2:#5d7ea3;--cyan:#6fabb8;--mint:#71b498;--coral:#cf9384;--violet:#a29cc4;--sun:#d3b077;
  --cyan-ink:#7fc0cd;--mint-ink:#7fc7a8;--coral-ink:#e2a294;--violet-ink:#b3adcf;
  --disk:#262e3d;--diskb:#3d4a60;--halo:#161c26;--dot:#2c3444;--line:#4a5871;--onblue:#12161e;
}
.ij *,.ij *::before,.ij *::after{box-sizing:border-box}
.ij button{font:inherit;color:inherit}
.ij :focus-visible{outline:3px solid var(--blue2);outline-offset:2px;border-radius:10px}
.ij .ico{width:18px;height:18px;flex:none}
.ij .card{background:var(--card);border:1px solid var(--brd);box-shadow:var(--shadow);border-radius:22px}
.ij .app{max-width:1180px;margin:0 auto;padding:20px clamp(14px,3vw,28px) 40px}
.ij .top{display:flex;gap:16px;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;margin-bottom:14px}
.ij h1{font:600 clamp(26px,4vw,40px)/1.08 'Fraunces',Georgia,serif;margin:0 0 6px;letter-spacing:-.01em}
.ij .brand p{margin:0;color:var(--ink2);max-width:50ch}
.ij .score{padding:7px 13px;border-radius:999px;font-weight:600;font-size:13.5px;background:var(--card2);border:1px solid var(--brd);display:inline-flex;gap:6px;align-items:center}
.ij .score.bump{animation:ijbump .5s ease}
@keyframes ijbump{40%{transform:scale(1.16)}}
.ij .prog{margin-bottom:14px}
.ij .prog-top{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:6px;font-size:12.5px;color:var(--ink3);font-weight:600}
.ij .prog-bar{height:5px;border-radius:3px;background:var(--brd2);overflow:hidden;margin-bottom:10px}
.ij .prog-bar i{display:block;height:100%;border-radius:3px;background:var(--blue);transition:width .4s ease}
.ij .rail{display:grid;grid-template-columns:repeat(6,1fr);gap:6px;padding:7px;border-radius:18px;background:var(--card);border:1px solid var(--brd);box-shadow:var(--shadow)}
.ij .pill{appearance:none;cursor:pointer;border:1px solid transparent;background:transparent;border-radius:13px;padding:8px 10px;display:flex;align-items:center;gap:7px;font-weight:600;font-size:13.5px;color:var(--ink3);position:relative;transition:background .2s,color .2s,border-color .2s}
.ij .pill:hover{background:var(--card2);color:var(--ink2)}
.ij .pill .ck{display:none;margin-left:auto;width:16px;height:16px;border-radius:50%;background:var(--mint);color:var(--onblue);align-items:center;justify-content:center}
.ij .pill .ck .ico{width:11px;height:11px}
.ij .pill.done{color:var(--ink2)}
.ij .pill.done .ck{display:inline-flex}
.ij .pill.cur{background:var(--card2);color:var(--ink);border-color:var(--blue2)}
.ij .pill.cur svg{color:var(--blue)}
.ij .pill:disabled{opacity:.5;cursor:default}
.ij .grid{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:22px;align-items:start}
.ij .left{position:sticky;top:12px;display:grid;gap:10px}
.ij .stage{overflow:hidden}
.ij .map{position:relative;background:var(--card2);background-image:radial-gradient(var(--dot) 1.1px,transparent 1.4px);background-size:22px 22px}
.ij .map svg.scene{display:block;width:100%;height:auto;aspect-ratio:900/470;min-height:260px}
.ij .clock{position:absolute;left:12px;top:11px;padding:6px 11px;border-radius:12px;background:var(--card);border:1px solid var(--brd)}
.ij .clock b{display:block;font:500 18px/1.1 'JetBrains Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.ij .clock small{color:var(--ink3);font-size:11px}
.ij .replay{position:absolute;right:10px;top:10px;width:34px;height:34px;border-radius:11px;border:1px solid var(--brd);background:var(--card);cursor:pointer;display:flex;align-items:center;justify-content:center;color:var(--ink2)}
.ij .replay:hover{color:var(--blue)}
.ij .replay:disabled{opacity:.4;cursor:default}
.ij .caption{min-height:70px;padding:12px 16px;border-top:1px solid var(--brd2);background:var(--card);display:flex;flex-direction:column;gap:1px;justify-content:center}
.ij .caption .who{font-size:12.5px;color:var(--ink3);font-weight:600}
.ij .caption .who .arr{margin:0 6px;color:var(--blue)}
.ij .caption .say{font:italic 500 15.5px/1.35 'Fraunces',Georgia,serif;color:var(--ink)}
.ij .legend{display:flex;gap:12px;flex-wrap:wrap;font-size:12px;color:var(--ink3);padding:0 4px}
.ij .legend span{display:inline-flex;align-items:center;gap:5px}
.ij .legend i{width:10px;height:8px;border-radius:3px;display:inline-block}
.ij .link{fill:none;stroke:var(--line);stroke-width:2.2;stroke-linecap:round;stroke-opacity:.35;transition:stroke-opacity .4s}
.ij .link.on{stroke-opacity:.6}
.ij .link.live{stroke-opacity:1;stroke:var(--blue);stroke-dasharray:6 8;animation:ijdash .8s linear infinite}
@keyframes ijdash{to{stroke-dashoffset:-14}}
.ij .spyline{stroke:var(--coral);stroke-width:1.8;stroke-dasharray:2 6;stroke-linecap:round;opacity:.8}
.ij .node{cursor:pointer;transition:opacity .4s}
.ij .node.dim{opacity:.25}
.ij .node .disk{fill:var(--disk);stroke:var(--diskb);stroke-width:1.8;transition:stroke .3s,stroke-width .3s}
.ij .node .nic{stroke:var(--ic,var(--blue));fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.ij .node.hot .disk{stroke:var(--blue);stroke-width:3}
.ij .node.bad .disk{stroke:var(--coral);stroke-width:3}
.ij .lbl{font:600 15px 'DM Sans',sans-serif;fill:var(--ink);paint-order:stroke;stroke:var(--halo);stroke-width:5px;stroke-linejoin:round}
.ij .sub{font:400 12.5px 'DM Sans',sans-serif;fill:var(--ink3);paint-order:stroke;stroke:var(--halo);stroke-width:4px;stroke-linejoin:round}
.ij .ring{fill:none;stroke-width:2.6;transform-box:fill-box;transform-origin:center;pointer-events:none}
.ij .timer{fill:none;stroke:var(--sun);stroke-width:3.5;stroke-linecap:round}
.ij .pkt .halo{fill:var(--pk);opacity:.2}
.ij .pkt rect{fill:var(--pk)}
.ij .pkt path{stroke:var(--onblue);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.ij .badge text{font:600 11.5px 'DM Sans',sans-serif}
.ij .badge.ok rect{fill:var(--mint)}.ij .badge.ok text{fill:var(--onblue)}
.ij .badge.warn rect{fill:var(--sun)}.ij .badge.warn text{fill:var(--onblue)}
.ij .badge.bad rect{fill:var(--coral)}.ij .badge.bad text{fill:var(--onblue)}
.ij .tag rect{fill:var(--card);stroke:var(--brd2)}
.ij .tag text{font:500 10.5px 'JetBrains Mono',ui-monospace,monospace;fill:var(--ink3)}
.ij .lostx{font:700 20px 'DM Sans',sans-serif;fill:var(--coral)}
.ij .screen{width:100%;padding:clamp(20px,2.6vw,30px);display:grid;gap:2px;min-width:0}
.ij .kicker{display:flex;align-items:center;gap:9px;margin-bottom:6px;color:var(--ink3);font-size:12.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em}
.ij .kicker .chnum{width:30px;height:30px;border-radius:10px;background:var(--card2);border:1px solid var(--brd);color:var(--blue);display:flex;align-items:center;justify-content:center;text-transform:none}
.ij .screen h2{font:600 clamp(22px,2.5vw,28px)/1.14 'Fraunces',Georgia,serif;margin:0 0 12px;letter-spacing:-.005em}
.ij .screen p{margin:0 0 12px;color:var(--ink2)}
.ij .screen p b{color:var(--ink);font-weight:600}
.ij .screen .lead{font-size:16px}
.ij .note{font-size:14px;border-left:2px solid var(--blue2);padding:1px 0 1px 12px;color:var(--ink2)}
.ij .analogy{display:flex;gap:9px;align-items:flex-start;background:var(--card2);border:1px solid var(--brd2);border-radius:14px;padding:11px 13px;margin:2px 0 14px}
.ij .analogy .ico{color:var(--sun);margin-top:2px;flex:none}
.ij .analogy p{margin:0;font-size:14px}
.ij .gist{font:600 15.5px/1.4 'DM Sans',sans-serif;color:var(--ink);background:var(--card2);border:1px solid var(--brd2);border-left:3px solid var(--blue);border-radius:10px;padding:9px 13px;margin:0 0 14px}
.ij .help{font-size:13px!important;color:var(--ink3)!important;margin:0!important}
.ij .box{border-radius:16px;background:var(--card2);border:1px solid var(--brd2);padding:13px;display:grid;gap:11px;margin:14px 0}
.ij .ctl{display:grid;gap:6px}
.ij .lab{font-size:13px;font-weight:600;color:var(--ink2)}
.ij .result{margin:0!important;font-size:13.5px;padding:7px 11px;border-radius:11px;background:var(--card);border:1px dashed var(--blue2);color:var(--ink2)}
.ij .result b{font-family:'JetBrains Mono',monospace;font-weight:500;color:var(--ink)}
.ij .seg{display:inline-flex;background:var(--card);border:1px solid var(--brd);border-radius:12px;padding:3px;gap:2px;flex-wrap:wrap}
.ij .seg button{appearance:none;border:0;background:transparent;padding:7px 11px;border-radius:9px;cursor:pointer;font-weight:600;font-size:13px;color:var(--ink3)}
.ij .seg button.on{background:var(--blue);color:var(--onblue)}
.ij .seg.off{opacity:.4;pointer-events:none}
.ij .chip{appearance:none;cursor:pointer;border:1px solid var(--brd);background:var(--card);color:var(--ink3);border-radius:999px;padding:5px 11px;font-size:12.5px;font-weight:600}
.ij .chip:hover{color:var(--ink);border-color:var(--blue2)}
.ij .btn{appearance:none;border:1px solid var(--brd);background:var(--card);color:var(--ink);border-radius:12px;padding:9px 14px;font-weight:600;font-size:13.5px;cursor:pointer;display:inline-flex;align-items:center;gap:7px}
.ij .btn:hover{border-color:var(--blue2)}
.ij .btn.small{padding:7px 11px;font-size:13px}
.ij .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:6px}
.ij .addr-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.ij .addr-in{flex:1 1 180px;display:flex;align-items:center;background:var(--card);border:1px solid var(--brd);border-radius:11px;padding:0 11px;min-width:0}
.ij .addr-in span{color:var(--ink3);font:400 13.5px 'JetBrains Mono',monospace;white-space:nowrap}
.ij .addr-in input{flex:1;min-width:0;border:0;background:transparent;color:var(--ink);font:500 14.5px 'JetBrains Mono',monospace;padding:9px 4px;outline:none}
.ij .presets{display:flex;gap:6px;flex-wrap:wrap}
.ij .anat{display:flex;flex-wrap:wrap;gap:3px;font:500 clamp(14px,2vw,17px) 'JetBrains Mono',ui-monospace,monospace}
.ij .seg-part{appearance:none;border:0;cursor:pointer;background:transparent;padding:4px 6px;border-radius:8px;font:inherit;color:var(--ink2)}
.ij .seg-part.on{background:var(--card);box-shadow:inset 0 0 0 1.5px var(--blue2);color:var(--ink)}
.ij .anat-note{margin:0!important;font-size:13.5px;min-height:40px}
.ij .hint-err{color:var(--coral-ink);font-size:13px;margin:0}
.ij pre.capture{margin:0;padding:11px 13px;border-radius:12px;background:var(--card);color:var(--ink2);border:1px solid var(--brd2);font:400 12px/1.6 'JetBrains Mono',monospace;overflow-x:auto;white-space:pre;max-width:100%}
.ij pre.capture mark{background:rgba(198,126,111,.28);color:var(--coral-ink);border-radius:4px;padding:0 3px}
.ij .sees{display:grid;grid-template-columns:1fr 1fr;gap:9px;font-size:13px}
.ij .sees ul{list-style:none;margin:0;padding:0;display:grid;gap:3px;color:var(--ink2)}
.ij .sees strong{display:block;margin-bottom:3px;color:var(--ink)}
.ij .y::before{content:"✓ ";color:var(--mint-ink);font-weight:700}
.ij .n::before{content:"✕ ";color:var(--coral-ink);font-weight:700}
.ij .quiz{display:grid;gap:8px}
.ij .quiz .q{font:600 15.5px/1.35 'Fraunces',Georgia,serif;color:var(--ink)!important;margin:0!important}
.ij .quiz .tagline{font-size:12.5px;font-weight:700;text-transform:uppercase;letter-spacing:.03em;color:var(--blue);margin:0!important}
.ij .opt{appearance:none;text-align:left;cursor:pointer;border:1px solid var(--brd);background:var(--card);border-radius:12px;padding:10px 13px;font-size:14px;color:var(--ink)}
.ij .opt:hover:not(:disabled){border-color:var(--blue2)}
.ij .opt.right{background:rgba(95,160,133,.16);border-color:var(--mint)}
.ij .opt.wrong{background:rgba(198,126,111,.14);border-color:var(--coral);opacity:.75}
.ij .why{margin:0!important;font-size:13.5px}
.ij .why.ok b{color:var(--mint-ink)}
.ij .why.bad b{color:var(--coral-ink)}
.ij .why.neutral b{color:var(--blue)}
.ij .browser{border-radius:14px;overflow:hidden;border:1px solid var(--brd2);background:var(--card)}
.ij .browser .bar{display:flex;align-items:center;gap:6px;padding:7px 11px;background:var(--card2);font:400 12px 'JetBrains Mono',monospace;color:var(--ink3)}
.ij .browser .bar i{width:8px;height:8px;border-radius:50%;background:var(--brd)}
.ij .browser .bar span{margin-left:7px;display:inline-flex;gap:6px;align-items:center;background:var(--card);border-radius:8px;padding:2px 9px;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ij .browser .bar .ico{width:12px;height:12px;color:var(--mint-ink)}
.ij .pg{padding:13px;display:grid;gap:7px}
.ij .sk{height:11px;border-radius:6px;background:var(--brd2)}
.ij .sk.h{height:19px;width:60%}
.ij .sk.s{width:80%}
.ij .sk.img{height:60px;border-radius:10px;background:var(--brd)}
.ij .wf{display:grid;gap:7px}
.ij .wf-row{display:grid;grid-template-columns:minmax(90px,140px) 1fr 64px;gap:9px;align-items:center;font-size:13px}
.ij .wf-l{color:var(--ink2)}
.ij .wf-track{position:relative;height:14px;border-radius:7px;background:var(--brd2);overflow:hidden}
.ij .wf-bar{position:absolute;top:0;bottom:0;border-radius:7px}
.ij .wf-v{font:500 12px 'JetBrains Mono',monospace;text-align:right;color:var(--ink)}
.ij .b-dns{background:var(--cyan)}
.ij .b-tcp{background:var(--blue)}
.ij .b-tls{background:var(--violet)}
.ij .b-http{background:var(--mint)}
.ij .cmp{display:grid;gap:7px}
.ij .cmp-row{display:grid;gap:4px;padding:7px 9px;border-radius:12px;border:1px solid transparent}
.ij .cmp-row.on{background:var(--card);border-color:var(--blue2)}
.ij .cmp-h{display:flex;justify-content:space-between;font-size:13px;color:var(--ink2);gap:8px}
.ij .cmp-h b{font:500 12px 'JetBrains Mono',monospace;color:var(--ink);white-space:nowrap}
.ij .cmp-bar{display:flex;height:12px;border-radius:6px;overflow:hidden}
.ij .cmp-bar i{display:block;min-width:2px}
.ij .keys{display:flex;gap:11px;flex-wrap:wrap;font-size:12px;color:var(--ink3)}
.ij .keys span{display:inline-flex;align-items:center;gap:5px}
.ij .keys i{width:9px;height:9px;border-radius:3px;display:inline-block}
.ij .welcome-list{display:grid;gap:10px;margin:0 0 16px;padding:0}
.ij .welcome-list li{display:flex;gap:11px;align-items:flex-start;list-style:none;font-size:14.5px;color:var(--ink2)}
.ij .welcome-list .num{flex:none;width:26px;height:26px;border-radius:9px;background:var(--card2);border:1px solid var(--brd);color:var(--blue);font:600 13px 'DM Sans',sans-serif;display:flex;align-items:center;justify-content:center}
.ij .navrow{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:16px;padding-top:14px;border-top:1px solid var(--brd2)}
.ij .navrow .spacer{flex:1}
.ij .btn.primary{background:var(--blue);color:var(--onblue);border-color:transparent;padding:11px 20px;font-size:14.5px}
.ij .btn.ghost{background:transparent;border-color:transparent;color:var(--ink3)}
.ij .btn.ghost:hover{color:var(--ink2);border-color:var(--brd)}
.ij .btn:disabled{opacity:.4;cursor:default;pointer-events:none}
.ij .screenEnter{animation:ijenter .32s ease}
@keyframes ijenter{from{opacity:0;transform:translateY(8px)}}
@media (max-width:980px){
  .ij .grid{grid-template-columns:1fr;gap:14px}
  .ij .left{position:static}
  .ij .map{height:clamp(200px,32vh,320px)}
  .ij .map svg.scene{height:100%}
  .ij .caption{min-height:58px;padding:9px 14px}
  .ij .caption .say{font-size:14.5px}
  .ij .stage{border-radius:18px}
}
@media (max-width:640px){
  .ij .rail{grid-template-columns:repeat(6,minmax(0,1fr));gap:4px;padding:5px;border-radius:14px}
  .ij .pill{padding:8px 0;justify-content:center}
  .ij .pill span:not(.ck),.ij .pill .ck{display:none!important}
  .ij .pill.done::after{content:"";position:absolute;right:7px;top:6px;width:6px;height:6px;border-radius:50%;background:var(--mint)}
  .ij .sees{grid-template-columns:1fr}
  .ij .wf-row{grid-template-columns:82px 1fr 58px}
  .ij .clock{padding:5px 8px}
  .ij .clock b{font-size:15px}
  .ij .clock small{display:none}
  .ij .navrow{flex-wrap:wrap}
}
@media (prefers-reduced-motion:reduce){
  .ij .link.live{animation:none}
  .ij .screenEnter{animation:none;opacity:1;transform:none}
}
`;

/* ---------------------------- sous-composants ---------------------------- */

function Segmented({ name, opts, cur, off, onChange }) {
  return (
    <div className={'seg' + (off ? ' off' : '')} role="group">
      {opts.map(([v, l]) => (
        <button key={v} type="button" className={String(cur) === String(v) ? 'on' : ''} aria-pressed={String(cur) === String(v)} onClick={() => onChange(v)}>
          {l}
        </button>
      ))}
    </div>
  );
}

function scrambleText() {
  const ch = '0123456789abcdef';
  let out = '';
  for (let l = 0; l < 4; l++) {
    let line = '';
    for (let i = 0; i < 16; i++) line += ch[Math.floor(Math.random() * 16)] + ch[Math.floor(Math.random() * 16)] + ' ';
    out += line.trim() + '\n';
  }
  return out.trimEnd();
}
function SpyCapture({ http, host }) {
  const [scr, setScr] = useState(scrambleText());
  useEffect(() => {
    if (http) return;
    const t = setInterval(() => setScr(scrambleText()), 140);
    return () => clearInterval(t);
  }, [http]);
  return (
    <>
      <pre className="capture" aria-label="Ce que capture le curieux">
        {http
          ? <>{`POST /connexion HTTP/1.1\nHost: ${host}\nCookie: session=8f2a91c4\n\nidentifiant=camille&`}<mark>motdepasse=azerty123</mark></>
          : scr}
      </pre>
      <div className="sees">
        {http ? (
          <>
            <div><strong>Il voit</strong><ul><li className="y">le site visité</li><li className="y">la page demandée</li><li className="y">tes cookies</li><li className="y">ton mot de passe</li></ul></div>
            <div><strong>Il ne voit pas</strong><ul><li className="n">rien : tout est lisible</li></ul></div>
          </>
        ) : (
          <>
            <div><strong>Il voit</strong><ul><li className="y">le site visité</li><li className="y">quand et combien de données passent</li></ul></div>
            <div><strong>Il ne voit pas</strong><ul><li className="n">la page demandée</li><li className="n">tes cookies et mots de passe</li><li className="n">le contenu de la réponse</li></ul></div>
          </>
        )}
      </div>
    </>
  );
}

/* ------------------------------ le composant ------------------------------ */

export default function InternetJourney() {
  const [S, setS] = useState({ domain: 'exemple.fr', dnsCached: false, loss: false, cert: 'ok', cdn: true, hit: false, origin: 90, anat: -1, spyView: 'http' });
  const [pos, setPos] = useState({ ch: 0, sub: 0 }); // écran courant
  const [predict, setPredict] = useState({});        // { [ch]: {wrong:[],solved,first} } — prédictions, non notées
  const [quiz, setQuiz] = useState({});               // { [ch]: {...} } — vérifications, notées
  const [explainLocked, setExplainLocked] = useState(false); // Continuer désactivé pendant l'animation d'explication
  const [clockMs, setClockMs] = useState(0);
  const [caption, setCaption] = useState(null);
  const [nodeState, setNodeState] = useState({});
  const [linkState, setLinkState] = useState({});
  const [badges, setBadges] = useState({});
  const [packet, setPacket] = useState(null);
  const [lostMark, setLostMark] = useState(null);
  const [ring, setRing] = useState(null);
  const [timerRing, setTimerRing] = useState(null);
  const [layoutName, setLayoutName] = useState('wide');
  const [camBox, setCamBox] = useState(LAYOUTS.wide.vb);
  const [captionKey, setCaptionKey] = useState(0);
  const [scoreBump, setScoreBump] = useState(0);
  const [domErr, setDomErr] = useState(false);

  const reducedRef = useRef(false);
  const stageRef = useRef(null);
  const svgRef = useRef(null);
  const domInputRef = useRef(null);
  const tokenRef = useRef(0);
  const camAnimStepRef = useRef(-1);

  useEffect(() => { reducedRef.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches; }, []);

  const D = useCallback((ms) => (reducedRef.current ? ms * 0.35 : ms), []);
  const tld = S.domain.split('.').pop();
  const host = 'www.' + S.domain;
  const L = LAYOUTS[layoutName];
  const P = (id) => L.nodes[id];
  const rad = (id) => (id === 'spy' ? L.r * 0.78 : L.r);
  const edgeIp = () => '203.0.113.' + (2 + (hash(S.domain) % 250));
  const originIp = () => '198.51.100.' + (2 + (hash(S.domain + 'o') % 250));
  const answerIp = () => (S.cdn ? edgeIp() : originIp());
  const endpoint = () => (S.cdn ? 'edge' : 'origin');
  const rttOfEndpoint = (id) => (id === 'edge' ? RTT_EDGE : S.origin);

  /* ------------------------- construction des chapitres ------------------------- */

  const chapters = useMemo(() => {
    function chap0() {
      return {
        title: `Une adresse, quatre questions`,
        gist: `Une adresse web cache quatre questions que ton navigateur doit résoudre avant d'afficher quoi que ce soit.`,
        lead: `Tu tapes « ${S.domain} » et tu appuies sur Entrée. Avant que la page n'apparaisse, ton navigateur doit répondre à quatre questions : où est ce site ? comment ouvrir une ligne avec lui ? comment la rendre secrète ? et quel serveur répondra le plus vite ? Chaque question fait l'objet d'une étape de ce voyage.`,
        analogy: `Écrire à quelqu'un dont tu ne connais que le nom : il faut trouver son adresse, vérifier qu'il est là, s'assurer que c'est bien lui, puis glisser la lettre sous enveloppe scellée.`,
        beats: [B.self('you', `Tu appuies sur Entrée. Le navigateur découpe l'adresse en morceaux : https://${host}/`, `Adresse lue : https://${host}/`, 0, { badges: [['you', 'adresse lue', 'ok']] })],
        note: `Une adresse se lit comme une adresse postale, du plus général au plus précis. Touche un morceau ci-dessous pour voir son rôle.`,
        widget: 'anat',
        predict: { q: `Avant d'aller plus loin : à ton avis, que se passe-t-il quand tu appuies sur Entrée ?`, opts: [`Le navigateur affiche la page tout de suite, il l'a déjà en mémoire`, `Il doit d'abord retrouver ce site sur le réseau, un peu comme chercher un numéro de téléphone`, `Il envoie un message au propriétaire du site pour demander la permission`], a: 1, why: `Ton navigateur doit d'abord retrouver ce site avant de pouvoir lui parler. C'est tout l'objet des étapes qui suivent.` },
        screens: ['welcome', 'predict', 'explain', 'try'],
      };
    }
    function chap1() {
      const d = S.domain, ip = answerIp();
      let beats, text, note;
      if (S.dnsCached) {
        beats = [B.self('you', `J'ai retenu cette adresse récemment. Pas besoin de demander.`, `Cache DNS : ${host} → ${ip}`, 1, { badges: [['you', 'cache ✓', 'ok']] })];
        text = `Les ordinateurs se joignent par des numéros, les adresses IP, pas par des noms : le DNS est l'annuaire qui traduit l'un en l'autre. Bonne nouvelle ici : ce nom a déjà été résolu il y a peu, la réponse est restée en mémoire. Coût : environ 1 ms au lieu d'une centaine.`;
        note = `Chaque réponse DNS a une durée de vie, le TTL. Tant qu'elle n'est pas écoulée, on la réutilise sans redemander.`;
      } else {
        beats = [
          B.self('you', `Rien en mémoire pour « ${host} ». Je dois demander.`, `Cache navigateur : aucune trace de ${host}`, 0, { badges: [['you', 'cache vide', 'warn']] }),
          B.send('you', 'resolver', 'req', `Quelle est l'adresse de ${host} ?`, `Navigateur → Résolveur`, 4),
          B.send('resolver', 'root', 'req', `Qui s'occupe des .${tld} ?`, `Résolveur → Racine`, 10),
          B.send('root', 'resolver', 'res', `Demande au serveur .${tld}.`, `Racine → Résolveur`, 10),
          B.send('resolver', 'tld', 'req', `Qui gère ${d} ?`, `Résolveur → .${tld}`, 10),
          B.send('tld', 'resolver', 'res', `Demande au serveur de ${d}.`, `.${tld} → Résolveur`, 10),
          B.send('resolver', 'auth', 'req', `Quelle est l'adresse de ${host} ?`, `Résolveur → Serveur du domaine`, 15),
          B.send('auth', 'resolver', 'res', `${host} est à l'adresse ${ip}.`, `Serveur du domaine → Résolveur : ${ip}`, 15, { badges: [['auth', 'réponse !', 'ok']] }),
          B.send('resolver', 'you', 'res', `Voici l'adresse : ${ip}.`, `Résolveur → Navigateur : ${ip}`, 4, { badges: [['you', ip, 'ok']] }),
        ];
        text = `Les ordinateurs se joignent par des numéros, les adresses IP, pas par des noms : le DNS est l'annuaire qui traduit l'un en l'autre. Personne ne le connaît en entier : le résolveur interroge trois niveaux, du plus général au plus précis — les serveurs racine, le serveur de .${tld}, puis le serveur du domaine, qui détient la vraie réponse. Coût total ici : environ 78 ms.`;
        note = `Dans la vraie vie, c'est souvent bien moins : le résolveur a déjà en mémoire les réponses de la racine et des extensions courantes.`;
      }
      return {
        title: `Trouver l'adresse : le DNS`,
        gist: S.dnsCached ? `Le nom est déjà connu : aucune recherche à faire.` : `Un annuaire à trois niveaux traduit le nom du site en numéro (adresse IP).`,
        lead: text,
        analogy: `Un annuaire à étages : « pour les .${tld}, va voir ce service », puis « voici le responsable de ${d} », puis enfin la réponse.`,
        widget: 'dns', beats, note,
        predict: { q: `À ton avis, pourquoi le DNS utilise-t-il plusieurs serveurs plutôt qu'un seul grand annuaire central ?`, opts: [`Parce qu'un seul serveur ne pourrait pas connaître tous les sites du monde`, `Pour rendre les choses plus compliquées`, `Parce que chaque pays a son propre Internet séparé`], a: 0, why: `Il existe des centaines de millions de noms de domaine : aucun serveur unique ne pourrait tous les connaître ni répondre à tout le monde en même temps.` },
        quiz: { q: `Quel serveur connaît l'adresse IP exacte de ${host} ?`, opts: ['Le serveur racine', `Le serveur de l'extension .${tld}`, 'Le serveur du domaine'], a: 2, why: `La racine ne connaît que les extensions, et le serveur .${tld} que les domaines. Seul le serveur du domaine détient la vraie réponse.` },
        screens: ['predict', 'explain', 'try', 'check'],
      };
    }
    function chap2() {
      const ip = answerIp(), E = endpoint(), who = nm(E, tld), whoTxt = E === 'edge' ? 'le CDN' : "le serveur d'origine", r = rttOfEndpoint(E), h2 = r / 2;
      let beats, note;
      if (!S.loss) {
        beats = [
          B.send('you', E, 'req', `SYN : « Salut ${who}, tu m'entends ? »`, `SYN Navigateur → ${who}`, h2),
          B.send(E, 'you', 'res', `SYN-ACK : « Je t'entends. Et toi ? »`, `SYN-ACK ${who} → Navigateur`, h2),
          B.send('you', E, 'req', `ACK : « Moi aussi. C'est parti ! »`, `ACK : connexion ouverte`, 0, { badges: [['you', 'connecté', 'ok'], [E, 'connecté', 'ok']] }),
        ];
        note = `Ce temps dépend surtout de la distance : dans la fibre, la lumière parcourt environ 200 000 km/s, donc 10 000 km coûtent déjà 50 ms à l'aller.`;
      } else {
        beats = [
          B.send('you', E, 'req', `SYN : « Salut ${who}, tu m'entends ? »`, `SYN Navigateur → ${who}`, 0),
          B.lost(E, 'you', `Oups : le SYN-ACK se perd en chemin.`, `SYN-ACK perdu en route`, { badges: [['you', 'aucune réponse', 'bad']] }),
          B.wait('you', `Toujours rien… nouvelle tentative dans 1 seconde.`, `Délai dépassé : nouvelle tentative dans 1 s`, 1000),
          B.send('you', E, 'req', `SYN (2e tentative) : « Tu m'entends, cette fois ? »`, `SYN Navigateur → ${who} (2e tentative)`, h2),
          B.send(E, 'you', 'res', `SYN-ACK : « Oui, cette fois ! »`, `SYN-ACK ${who} → Navigateur`, h2),
          B.send('you', E, 'req', `ACK : « Moi aussi. C'est parti ! »`, `ACK : connexion ouverte`, 0, { badges: [['you', 'connecté', 'ok'], [E, 'connecté', 'ok']] }),
        ];
        note = `Ce délai double à chaque nouvel échec (1 s, 2 s, 4 s…) pour ne pas aggraver la congestion du réseau.`;
      }
      return {
        title: `Ouvrir la ligne : TCP`,
        gist: S.loss ? `Un paquet se perd : la connexion réessaie automatiquement, avec un peu de retard.` : `Trois messages suffisent pour vérifier que la ligne fonctionne dans les deux sens.`,
        lead: `Le navigateur sait où aller : ${ip}. Mais Internet ne garantit rien — un paquet peut se perdre ou arriver dans le désordre. TCP vérifie d'abord que ${whoTxt} est bien là, avec un échange en trois messages : SYN, SYN-ACK, ACK. ${S.loss ? `Ici, le réseau est instable : un paquet se perd, et il faut réessayer.` : `Tout se passe bien : la poignée de main coûte un aller-retour, soit ${fmt(r)} ms.`}`,
        analogy: `Un appel téléphonique. « Allô ? » — « Oui, je t'entends, et toi ? » — « Moi aussi. » Ensuite seulement, vous parlez.`,
        widget: 'net', beats, note,
        predict: { q: `Si un message se perd en chemin, à ton avis que se passe-t-il ?`, opts: [`La connexion échoue, il faut tout recommencer depuis le début`, `L'ordinateur attend un peu puis renvoie automatiquement le message`, `Le message perdu est simplement oublié pour toujours`], a: 1, why: `TCP est conçu pour survivre aux pertes : il attend une confirmation, et sans réponse, il renvoie le message tout seul.` },
        quiz: { q: `Pourquoi TCP échange-t-il trois messages et pas deux ?`, opts: [`Pour que chacun vérifie qu'il peut à la fois envoyer et recevoir`, `Pour chiffrer la conversation`, `Pour retrouver l'adresse IP du serveur`], a: 0, why: `Avec deux messages, le serveur ne saurait pas si sa réponse est arrivée. Le troisième confirme que la ligne marche dans les deux sens.` },
        screens: ['predict', 'explain', 'try', 'check'],
      };
    }
    function chap3() {
      const E = endpoint(), who = nm(E, tld), r = rttOfEndpoint(E), bad = S.cert === 'bad';
      let beats, note, lead;
      if (bad) {
        beats = [
          B.send('you', E, 'req', `ClientHello : « Je parle TLS 1.3. »`, `ClientHello Navigateur → ${who}`, r / 2, { badges: [['spy', 'voit le nom du site', 'warn']] }),
          B.send(E, 'you', 'res', `ServerHello : « Voici mon certificat. »`, `ServerHello + certificat ${who} → Navigateur`, r / 2, { badges: [[E, 'certificat douteux', 'bad']] }),
          B.self('you', `Ce certificat ne prouve pas que tu parles à ${host}. Je coupe la connexion.`, `Certificat refusé`, 0, { badges: [['you', 'connexion refusée', 'bad']] }),
        ];
        lead = `Le canal n'est pas encore sûr. Le serveur présente un certificat qui ne correspond pas à ${host} — nom différent, signature inconnue ou date dépassée. Le navigateur affiche « Votre connexion n'est pas privée » et s'arrête là.`;
        note = `C'est ce qui protège contre l'attaque de l'« homme du milieu » : sans certificat valide pour ce nom, un intermédiaire ne peut pas se faire passer pour le site.`;
      } else {
        beats = [
          B.send('you', E, 'req', `ClientHello : « Je parle TLS 1.3. »`, `ClientHello Navigateur → ${who}`, r / 2, { badges: [['spy', 'voit le nom du site', 'warn']] }),
          B.send(E, 'you', 'res', `ServerHello : « Voici mon certificat. »`, `ServerHello + certificat ${who} → Navigateur`, r / 2),
          B.self('you', `Certificat vérifié : bon nom, autorité de confiance, pas expiré.`, `Certificat vérifié pour ${host}`, 0, { badges: [['you', 'certificat ✓', 'ok']] }),
          B.self('you', `Chacun calcule la même clé de session, sans jamais l'envoyer.`, `Clé de session calculée des deux côtés`, 0, { badges: [['you', 'clé secrète', 'ok'], [E, 'clé secrète', 'ok']], also: E }),
          B.send('you', E, 'enc', `Finished : « Tout est prêt, désormais chiffré. »`, `Finished (chiffré) Navigateur → ${who}`, 0, { badges: [['spy', 'ne voit que du bruit', 'ok']] }),
        ];
        lead = `La ligne est ouverte, mais tout ce qui la traverse passe par des dizaines de machines. TLS répond à deux questions : à qui parle-t-on ? et comment garder ça secret ? Le serveur prouve son identité avec un certificat, puis les deux côtés fabriquent une clé secrète commune sans jamais l'envoyer sur le réseau. Coût : un seul aller-retour, ${fmt(r)} ms.`;
        note = `Le nom du site part en clair au tout début : c'est pour cela qu'un curieux voit quel site tu visites, mais jamais ce que tu y fais.`;
      }
      return {
        title: `Chiffrer la conversation : HTTPS`,
        gist: bad ? `Le certificat ne correspond pas au site : le navigateur refuse de continuer.` : `Le serveur prouve son identité, puis les deux côtés fabriquent en secret une clé commune.`,
        lead,
        analogy: `Vérifier la carte d'identité du facteur, puis convenir d'un code que vous seuls connaissez avant de vous écrire.`,
        widget: 'tls', beats, note,
        predict: { q: `Sur un Wi-Fi public, penses-tu qu'un inconnu peut lire ton mot de passe si le site utilise HTTPS ?`, opts: [`Oui, tout le monde sur ce Wi-Fi peut le lire`, `Non, la connexion est chiffrée avant l'envoi de données sensibles`, `Seulement si le mot de passe est très simple`], a: 1, why: `Grâce à TLS, tout ce qui suit la poignée de main est chiffré : un inconnu ne voit que des données brouillées.` },
        quiz: { q: `Sur un Wi-Fi public, que voit un curieux quand tu utilises HTTPS ?`, opts: [`Tes mots de passe, mais brouillés`, `Rien du tout, pas même le site visité`, `Avec qui tu communiques, mais pas le contenu`], a: 2, why: `Il voit à quel site tu te connectes et combien de données passent. Le contenu — pages, cookies, mots de passe — est illisible sans la clé.` },
        screens: ['predict', 'explain', 'try', 'check'],
      };
    }
    function chap4() {
      const rO = S.origin, rE = RTT_EDGE;
      let beats, lead, note;
      if (S.cdn) {
        if (S.hit) {
          beats = [
            B.send('you', 'edge', 'enc', `GET / : « Donne-moi la page d'accueil. »`, `GET / Navigateur → CDN (chiffré)`, rE / 2),
            B.self('edge', `J'ai une copie fraîche : je te la donne sans déranger l'origine.`, `Cache CDN : HIT`, 3, { badges: [['edge', 'HIT', 'ok']] }),
            B.send('edge', 'you', 'enc', `200 OK : voici la page, depuis le cache.`, `200 OK CDN → Navigateur`, rE / 2),
          ];
          lead = `Le canal est sûr : le navigateur demande la page avec « GET / ». Un CDN répond ici : la copie existe déjà dans la région, c'est un HIT. Coût : environ ${fmt(rE + 3)} ms, sans déranger le serveur d'origine.`;
          note = `Sur un site très visité, le taux de « cache hit » dépasse souvent 90 %.`;
        } else {
          beats = [
            B.send('you', 'edge', 'enc', `GET / : « Donne-moi la page d'accueil. »`, `GET / Navigateur → CDN (chiffré)`, rE / 2),
            B.self('edge', `Personne n'a demandé cette page ici récemment : direction l'origine.`, `Cache CDN : MISS`, 1, { badges: [['edge', 'MISS', 'warn']] }),
            B.send('edge', 'origin', 'req', `GET / : « La page d'accueil, stp. »`, `GET / CDN → Origine`, rO / 2),
            B.self('origin', `Je fabrique la page : base de données, calculs, mise en forme…`, `Origine : page générée (≈40 ms)`, 40, { badges: [['origin', 'calcul…', 'warn']] }),
            B.send('origin', 'edge', 'res', `200 OK : voici la page.`, `200 OK Origine → CDN`, rO / 2),
            B.self('edge', `Je garde une copie pour les prochains visiteurs.`, `CDN : copie mise en cache`, 1, { badges: [['edge', 'copie gardée', 'ok']] }),
            B.send('edge', 'you', 'enc', `200 OK : voici la page.`, `200 OK CDN → Navigateur`, rE / 2),
          ];
          lead = `Le canal est sûr : le navigateur demande la page avec « GET / ». Le CDN n'a pas encore de copie ici — MISS — et va la chercher à l'origine, à ${fmt(rO)} ms d'aller-retour, avant de la garder en mémoire. Coût total : environ ${fmt(rE + rO + 42)} ms.`;
          note = `Le prochain visiteur de cette région obtiendra la page sans solliciter l'origine.`;
        }
      } else {
        beats = [
          B.send('you', 'origin', 'enc', `GET / : « Donne-moi la page d'accueil. »`, `GET / Navigateur → Origine (chiffré)`, rO / 2),
          B.self('origin', `Je fabrique la page : base de données, calculs, mise en forme…`, `Origine : page générée (≈40 ms)`, 40, { badges: [['origin', 'calcul…', 'warn']] }),
          B.send('origin', 'you', 'enc', `200 OK : voici la page, après tout le trajet.`, `200 OK Origine → Navigateur`, rO / 2),
        ];
        lead = `Le canal est sûr : le navigateur demande la page avec « GET / ». Sans CDN, aucune copie n'existe près de toi : la requête traverse tout le chemin jusqu'au serveur d'origine, à ${fmt(rO)} ms d'aller-retour, puis en refait autant au retour. Coût total : environ ${fmt(rO + 40)} ms.`;
        note = `Plus le serveur est loin, plus chaque aller-retour pèse : c'est exactement ce qu'un CDN corrige.`;
      }
      return {
        title: `Récupérer la page : CDN`,
        gist: !S.cdn ? `Sans copie proche, chaque requête fait l'aller-retour jusqu'au serveur d'origine.` : (S.hit ? `Une copie proche de toi répond directement : l'origine n'est pas dérangée.` : `Aucune copie ici : le CDN va la chercher une fois, puis la garde pour la suite.`),
        lead,
        analogy: `Une grande bibliothèque centrale et des antennes de quartier qui gardent les livres les plus demandés.`,
        widget: 'cdn', beats, note,
        predict: { q: `Deux personnes, l'une à Paris et l'autre à Tokyo, visitent le même site avec un CDN. À ton avis, contactent-elles le même serveur ?`, opts: [`Oui, toujours exactement le même`, `Pas forcément : chacune est dirigée vers le point le plus proche d'elle`, `Non, chaque pays a une version différente du site`], a: 1, why: `Un CDN place des copies un peu partout dans le monde : chaque visiteur est généralement dirigé vers celle qui est la plus proche de lui.` },
        quiz: { q: `Pourquoi un CDN accélère-t-il un site ?`, opts: [`Il utilise des câbles plus rapides que le reste d'Internet`, `Il garde des copies des pages près de toi : la réponse fait moins de chemin`, `Il fabrique les pages plus vite que le serveur d'origine`], a: 1, why: `Le gain vient surtout de la distance : une copie proche répond en quelques millisecondes, sans aller jusqu'à l'origine.` },
        screens: ['predict', 'explain', 'try', 'check'],
      };
    }
    function chap5() {
      const tot = phases(S).total;
      return {
        title: `La page s'affiche`,
        gist: `Le premier échange est le plus long : tout le reste réutilise la même ligne, déjà ouverte et sécurisée.`,
        lead: `Le trajet complet a pris ${fmt(tot)} ms : trouver l'adresse, ouvrir la ligne, la chiffrer, demander la page. Le HTML arrive en premier ; en le lisant, le navigateur découvre images, styles et scripts, et les demande à leur tour sur la même connexion — plus de DNS, TCP ni TLS à refaire.`,
        analogy: `Le voyage que tu viens de suivre, c'est le premier coup de fil : une fois la ligne ouverte, on pose toutes les questions qu'on veut sans recomposer le numéro.`,
        beats: [B.self('you', `Le navigateur assemble la page : HTML, images, styles, scripts…`, `Page reçue et affichée`, 0, { badges: [['you', 'page affichée', 'ok']] })],
        widget: 'recap',
        screens: ['explain', 'recap', 'wrap'],
      };
    }
    const raw = [chap0(), chap1(), chap2(), chap3(), chap4(), chap5()];
    let t = 0;
    raw.forEach((c, i) => {
      c.step = i;
      c.beats.forEach((b) => { b.t0 = t; t += b.ms; b.t = t; b.tag = TAGS[i]; });
      c.start = c.beats[0].t0;
      c.end = t;
    });
    return raw;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S]);

  const totalScreens = chapters.reduce((n, c) => n + c.screens.length, 0);
  const flatIndex = (() => { let n = 0; for (let i = 0; i < pos.ch; i++) n += chapters[i].screens.length; return n + pos.sub; })();
  const screenKind = chapters[pos.ch].screens[pos.sub];
  const isFirst = pos.ch === 0 && pos.sub === 0;
  const isLast = pos.ch === 5 && pos.sub === chapters[5].screens.length - 1;

  /* ------------------------------- score ------------------------------- */

  const score = Object.values(quiz).filter((q) => q && q.first === true).length;
  useEffect(() => { setScoreBump((n) => n + 1); }, [score]);

  /* --------------------------- moteur d'animation --------------------------- */

  const svgNS = 'http://www.w3.org/2000/svg';

  const activeSet = useCallback((ch) => {
    const E = endpoint();
    switch (ch) {
      case 0: return new Set(['you']);
      case 1: return new Set(['you', 'resolver', 'root', 'tld', 'auth']);
      case 2: return new Set(['you', E]);
      case 3: return new Set(['you', E, 'spy']);
      default: return new Set(S.cdn ? ['you', 'edge', 'origin'] : ['you', 'origin']);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S.cdn]);

  const linkValid = (key) => {
    if (key === 'you|origin') return !S.cdn;
    if (key === 'you|edge' || key === 'edge|origin') return S.cdn;
    return true;
  };
  const rttOf = (key) => ({ 'you|resolver': 8, 'resolver|root': 20, 'resolver|tld': 20, 'resolver|auth': 30, 'you|edge': RTT_EDGE, 'edge|origin': S.origin, 'you|origin': S.origin }[key]);

  const labelsFor = useCallback((id, ch) => {
    const fake = ch === 3 && S.cert === 'bad' && id === endpoint();
    switch (id) {
      case 'you': return ['Ton navigateur', 'demande la page'];
      case 'resolver': return ['Résolveur DNS', 'cherche à ta place'];
      case 'root': return ['Serveur racine', 'connaît les extensions'];
      case 'tld': return ['Serveur .' + short(tld, 10), 'connaît les domaines'];
      case 'auth': return ['Serveur du domaine', short(S.domain)];
      case 'edge': return fake ? ['Faux serveur ?', 'certificat douteux'] : (S.cdn ? ['CDN', 'copies près de toi'] : ['CDN désactivé', '']);
      case 'origin': return fake ? ['Faux serveur ?', 'certificat douteux'] : ["Serveur d'origine", 'fabrique la page'];
      case 'spy': return ['Curieux du Wi-Fi', 'écoute les paquets'];
      default: return ['', ''];
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [S.cert, S.cdn, S.domain, tld]);

  // recalcule l'état visuel (noeuds atténués, liens actifs, caméra) à chaque changement de chapitre / réglage
  useEffect(() => {
    const act = activeSet(pos.ch);
    const ns = {};
    Object.keys(NODEDEF).forEach((id) => {
      const [l, s] = labelsFor(id, pos.ch);
      ns[id] = { dim: !act.has(id), bad: pos.ch === 3 && S.cert === 'bad' && id === endpoint(), label: l, sub: s };
    });
    setNodeState((prev) => Object.fromEntries(Object.keys(ns).map((k) => [k, { ...prev[k], ...ns[k] }])));
    const ls = {};
    LINKDEF.forEach(([a, b]) => {
      const key = a + '|' + b;
      ls[key] = { on: act.has(a) && act.has(b) && linkValid(key), a, b };
    });
    setLinkState((prev) => Object.fromEntries(Object.keys(ls).map((k) => [k, { ...prev[k], ...ls[k] }])));
    if (camAnimStepRef.current !== pos.ch) {
      const target = layoutName === 'tall' ? CAM_TALL[pos.ch] : [0, 0, 900, 470];
      setCamBox(target.join(' '));
      camAnimStepRef.current = pos.ch;
    } else if (layoutName === 'tall') {
      setCamBox(CAM_TALL[pos.ch].join(' '));
    } else {
      setCamBox('0 0 900 470');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos.ch, S.cdn, S.cert, S.domain, layoutName]);

  const linkFor = (a, b) => (linkState[a + '|' + b] ? a + '|' + b : b + '|' + a);
  const getPathEl = (key) => svgRef.current && svgRef.current.querySelector(`[data-link="${key}"]`);

  const sleep = (ms, tk) => new Promise((r) => setTimeout(() => r(tk === tokenRef.current), ms));
  const rafAnim = (dur, fn, tk) => new Promise((res) => {
    const t0 = performance.now();
    const f = (now) => {
      if (tk !== tokenRef.current) { res(false); return; }
      const p = Math.min(1, (now - t0) / dur);
      fn(p);
      if (p < 1) requestAnimationFrame(f); else res(true);
    };
    requestAnimationFrame(f);
  });

  const setBadge = (id, text, tone) => setBadges((b) => ({ ...b, [id]: { text, tone } }));
  const applyBadges = (b) => (b.badges || []).forEach(([id, txt, tone]) => setBadge(id, txt, tone));

  async function sendPacket(b, tk, tick) {
    const key = linkFor(b.from, b.to);
    const el = getPathEl(key);
    if (!el) return true;
    const len = el.getTotalLength();
    const fwd = key.split('|')[0] === b.from;
    setLinkState((s) => ({ ...s, [key]: { ...s[key], live: true } }));
    setNodeState((s) => ({ ...s, [b.from]: { ...s[b.from], hot: true } }));
    const end = b.type === 'lost' ? 0.5 : 1;
    let last = { x: 0, y: 0 };
    const ok = await rafAnim(D(620 + len * 1.1), (p) => {
      const e = ease(p) * end;
      const pt = el.getPointAtLength(len * (fwd ? e : 1 - e));
      last = pt;
      setPacket({ x: pt.x, y: pt.y, kind: b.kind });
      tick(p);
    }, tk);
    setLinkState((s) => ({ ...s, [key]: { ...s[key], live: false } }));
    setNodeState((s) => ({ ...s, [b.from]: { ...s[b.from], hot: false } }));
    if (!ok) { setPacket(null); return false; }
    if (b.type === 'lost') {
      setLostMark({ x: last.x, y: last.y - 15 });
      const alive = await sleep(D(850), tk);
      setPacket(null); setLostMark(null);
      return alive;
    }
    setRing({ id: b.to, key: Math.random() });
    setPacket(null);
    setTimeout(() => setRing(null), D(900));
    return true;
  }
  async function waitBeat(b, tk, tick) {
    setTimerRing({ node: b.node });
    const ok = await rafAnim(D(1500), (p) => { setTimerRing({ node: b.node, p }); tick(p); }, tk);
    setTimerRing(null);
    return ok;
  }
  async function selfBeat(b, tk, tick) {
    setNodeState((s) => ({ ...s, [b.node]: { ...s[b.node], hot: true } }));
    setRing({ id: b.node, key: Math.random() });
    if (b.also) setTimeout(() => setRing({ id: b.also, key: Math.random(), color: 'var(--mint)' }), 10);
    const ok = await rafAnim(D(b.ms >= 30 ? 1100 : 800), tick, tk);
    setNodeState((s) => ({ ...s, [b.node]: { ...s[b.node], hot: false } }));
    setTimeout(() => setRing(null), D(900));
    return ok;
  }
  function showCaption(b) { setCaption(b); setCaptionKey((n) => n + 1); }
  async function runBeat(b, tk) {
    const tick = (p) => setClockMs(b.t0 + (b.t - b.t0) * ease(p));
    showCaption(b);
    if (b.type === 'self' || b.type === 'wait') applyBadges(b);
    let ok;
    if (b.type === 'send' || b.type === 'lost') ok = await sendPacket(b, tk, tick);
    else if (b.type === 'wait') ok = await waitBeat(b, tk, tick);
    else ok = await selfBeat(b, tk, tick);
    if (!ok || tk !== tokenRef.current) return false;
    if (b.type === 'send' || b.type === 'lost') applyBadges(b);
    setClockMs(b.t);
    return true;
  }
  async function playBeats(bs, tk) {
    for (const b of bs) {
      if (!(await runBeat(b, tk))) return;
      if (!(await sleep(D(220), tk))) return;
    }
  }

  const activate = useCallback(async () => {
    const tk = ++tokenRef.current;
    const c = chapters[pos.ch];
    const kind = c.screens[pos.sub];
    setBadges({}); setPacket(null); setLostMark(null); setRing(null); setTimerRing(null);
    if (kind === 'welcome') {
      setClockMs(0);
      showCaption({ type: 'self', node: 'you', say: `Clique sur « Commencer » quand tu veux te lancer.` });
      return;
    }
    if (kind === 'predict') {
      setClockMs(c.start);
      showCaption({ type: 'self', node: 'you', say: `Choisis une réponse, puis clique sur Continuer.` });
      return;
    }
    if (kind === 'explain') {
      setClockMs(c.start);
      setExplainLocked(true);
      await playBeats(c.beats, tk);
      if (tk === tokenRef.current) setExplainLocked(false);
      return;
    }
    if (kind === 'try') {
      setClockMs(c.start);
      await playBeats(c.beats, tk);
      return;
    }
    if (kind === 'check') {
      setClockMs(c.end);
      showCaption({ type: 'self', node: 'you', say: `Réponds à la question, tu peux réessayer si besoin.` });
      return;
    }
    if (kind === 'recap') {
      setClockMs(c.start);
      await playBeats(c.beats, tk);
      return;
    }
    if (kind === 'wrap') {
      showCaption({ type: 'self', node: 'you', say: `Bravo ! Tu as suivi tout le voyage d'un clic.` });
      return;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters, pos.ch, pos.sub]);

  useEffect(() => { activate(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [pos.ch, pos.sub, chapters]);

  const replay = () => { if (!explainLocked) activate(); };

  const goto = (ch, sub) => setPos({ ch, sub });
  const next = () => {
    const c = chapters[pos.ch];
    if (pos.sub < c.screens.length - 1) { goto(pos.ch, pos.sub + 1); return; }
    if (pos.ch < 5) goto(pos.ch + 1, 0);
  };
  const prev = () => {
    if (pos.sub > 0) { goto(pos.ch, pos.sub - 1); return; }
    if (pos.ch > 0) { const pc = chapters[pos.ch - 1]; goto(pos.ch - 1, pc.screens.length - 1); }
  };

  useEffect(() => {
    const check = () => {
      const w = (stageRef.current && stageRef.current.getBoundingClientRect().width) || window.innerWidth;
      setLayoutName(w < 560 ? 'tall' : 'wide');
    };
    check();
    const ro = new ResizeObserver(check);
    if (stageRef.current) ro.observe(stageRef.current);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowRight' || e.key === 'Enter') { if (!(screenKind === 'explain' && explainLocked) && !isLast) next(); }
      else if (e.key === 'ArrowLeft') prev();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pos, explainLocked, isLast]);

  /* -------------------------------- actions -------------------------------- */

  const parseDomain = (v) => {
    v = v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
    return /^[a-z0-9-]{1,40}(\.[a-z0-9-]{1,40})+$/.test(v) ? v : null;
  };
  const applyDomain = (v) => {
    const d = parseDomain(v);
    if (!d) { setDomErr(true); return; }
    setDomErr(false);
    setS((s) => ({ ...s, domain: d }));
  };
  const setOpt = (patch) => setS((s) => ({ ...s, ...patch }));

  const answerPredict = (chIdx, optIdx) => {
    const c = chapters[chIdx];
    setPredict((q) => {
      const cur = q[chIdx] || { wrong: [], solved: false, first: null };
      if (cur.solved) return q;
      if (optIdx === c.predict.a) return { ...q, [chIdx]: { ...cur, solved: true, first: cur.wrong.length === 0 } };
      return { ...q, [chIdx]: { ...cur, wrong: [...cur.wrong, optIdx], first: false } };
    });
  };
  const answerCheck = (chIdx, optIdx) => {
    const c = chapters[chIdx];
    setQuiz((q) => {
      const cur = q[chIdx] || { wrong: [], solved: false, first: null };
      if (cur.solved) return q;
      if (optIdx === c.quiz.a) return { ...q, [chIdx]: { ...cur, solved: true, first: cur.wrong.length === 0 } };
      return { ...q, [chIdx]: { ...cur, wrong: [...cur.wrong, optIdx], first: false } };
    });
  };

  /* --------------------------------- rendu --------------------------------- */

  const pn = phases({ ...S, cdn: false });
  const Pc = phases(S);

  function renderWidget(kind) {
    if (kind === 'anat') {
      const d = S.domain, i = d.lastIndexOf('.'), sld = d.slice(0, i), tl = d.slice(i);
      const parts = [
        ['https://', 'Protocole', "Le « s » de https annonce que tout sera chiffré."],
        ['www.', 'Sous-domaine', 'Une « pièce » du site : ici, le site principal.'],
        [sld, 'Nom de domaine', "Le nom choisi par le propriétaire. C'est ce que le DNS va chercher."],
        [tl, 'Extension', 'Le « quartier » du nom (.fr, .com…), qui indique à qui demander ensuite.'],
        ['/', 'Chemin', "La page demandée. Un simple « / » désigne la page d'accueil."],
      ];
      const note = S.anat < 0 ? `Touche un morceau de l'adresse pour savoir à quoi il sert.` : (<><b>{parts[S.anat][1]}.</b> {parts[S.anat][2]}</>);
      return (
        <div className="box">
          <div className="ctl">
            <span className="lab">Quel site veux-tu suivre ?</span>
            <div className="addr-row">
              <label className="addr-in">
                <span>https://www.</span>
                <input ref={domInputRef} defaultValue={S.domain} spellCheck={false} autoCapitalize="off" autoComplete="off" maxLength={40} aria-label="Nom de domaine"
                  onKeyDown={(e) => { if (e.key === 'Enter') applyDomain(e.currentTarget.value); }} />
              </label>
              <button type="button" className="btn small" onClick={() => applyDomain(domInputRef.current.value)}>Suivre ce site</button>
            </div>
            {domErr && <p className="hint-err">Essaie un nom comme exemple.fr ou wikipedia.org.</p>}
            <div className="presets">
              {['exemple.fr', 'wikipedia.org', 'lemonde.fr', 'github.com'].map((p) => (
                <button key={p} type="button" className="chip" onClick={() => { applyDomain(p); if (domInputRef.current) domInputRef.current.value = p; }}>{p}</button>
              ))}
            </div>
          </div>
          <div className="anat" role="group" aria-label="Morceaux de l'adresse">
            {parts.map((p, i) => (
              <button key={i} type="button" className={'seg-part' + (S.anat === i ? ' on' : '')} aria-pressed={S.anat === i}
                onClick={() => setOpt({ anat: S.anat === i ? -1 : i })}>{p[0]}</button>
            ))}
          </div>
          <p className="anat-note">{note}</p>
        </div>
      );
    }
    if (kind === 'dns') {
      return (
        <div className="box">
          <div className="ctl">
            <span className="lab">Le navigateur connaît-il déjà ce site ?</span>
            <Segmented name="dns" cur={S.dnsCached ? '1' : '0'} opts={[['0', 'Première visite'], ['1', 'Déjà visité']]} onChange={(v) => setOpt({ dnsCached: v === '1' })} />
          </div>
          <p className="result">Durée du DNS avec ce réglage : <b>{fmt(Pc.dns)} ms</b></p>
        </div>
      );
    }
    if (kind === 'net') {
      return (
        <div className="box">
          <div className="ctl">
            <span className="lab">Comment est la connexion ?</span>
            <Segmented name="net" cur={S.loss ? '1' : '0'} opts={[['0', 'Réseau fiable'], ['1', 'Réseau instable']]} onChange={(v) => setOpt({ loss: v === '1' })} />
          </div>
          <p className="result">Durée de la poignée de main : <b>{fmt(Pc.tcp)} ms</b></p>
        </div>
      );
    }
    if (kind === 'tls') {
      const http = S.spyView === 'http';
      return (
        <>
          <div className="box">
            <div className="ctl">
              <span className="lab">Et si quelqu'un se faisait passer pour le site ?</span>
              <Segmented name="cert" cur={S.cert} opts={[['ok', 'Vrai site'], ['bad', 'Imposteur']]} onChange={(v) => setOpt({ cert: v })} />
            </div>
            <p className="result">Durée de TLS : <b>{fmt(Pc.tls)} ms</b></p>
          </div>
          <div className="box">
            <div className="ctl">
              <span className="lab">Un curieux sur le Wi-Fi du café regarde passer ta connexion</span>
              <Segmented name="spy" cur={S.spyView} opts={[['http', 'Sans chiffrement'], ['https', 'Avec HTTPS']]} onChange={(v) => setOpt({ spyView: v })} />
            </div>
            <SpyCapture http={http} host={host} />
          </div>
        </>
      );
    }
    if (kind === 'cdn') {
      return (
        <div className="box">
          <div className="ctl"><span className="lab">Le site utilise-t-il un CDN ?</span>
            <Segmented name="cdn" cur={S.cdn ? '1' : '0'} opts={[['1', 'Avec CDN'], ['0', 'Sans CDN']]} onChange={(v) => setOpt({ cdn: v === '1' })} /></div>
          <div className="ctl"><span className="lab">Quelqu'un a-t-il déjà demandé cette page ?</span>
            <Segmented name="hit" off={!S.cdn} cur={S.hit ? '1' : '0'} opts={[['0', 'Non, première fois'], ['1', 'Oui, en cache']]} onChange={(v) => setOpt({ hit: v === '1' })} /></div>
          <div className="ctl"><span className="lab">Où se trouve le serveur d'origine ?</span>
            <Segmented name="origin" cur={String(S.origin)} opts={[['30', 'Même pays'], ['90', 'Autre continent'], ['250', 'Bout du monde']]} onChange={(v) => setOpt({ origin: +v })} /></div>
          <p className="result">Durée de la requête : <b>{fmt(Pc.http)} ms</b>. Sans CDN : <b>{fmt(pn.http)} ms</b>.</p>
        </div>
      );
    }
    if (kind === 'recap') {
      const defs = [['dns', "Trouver l'adresse"], ['tcp', 'Ouvrir la ligne'], ['tls', 'Chiffrer'], ['http', 'Demander la page']];
      let acc = 0;
      const rows = defs.map(([k, l]) => {
        const st = (acc / Pc.total) * 100, w = Math.max((Pc[k] / Pc.total) * 100, 1.5);
        acc += Pc[k];
        return { k, l, st, w, v: Pc[k] };
      });
      const sc = [['Sans CDN', { ...S, cdn: false }], ['Avec CDN, pas encore en cache', { ...S, cdn: true, hit: false }], ['Avec CDN, déjà en cache', { ...S, cdn: true, hit: true }]];
      const res = sc.map(([l, o]) => [l, phases(o)]);
      const max = Math.max(...res.map((r) => r[1].total));
      const cur = S.cdn ? (S.hit ? 2 : 1) : 0;
      const gain = res[0][1].total - res[2][1].total;
      return (
        <>
          <div className="box">
            <div className="browser">
              <div className="bar"><i></i><i></i><i></i><span><Icon name="lock" className="ico" />{host}</span></div>
              <div className="pg"><div className="sk h" /><div className="sk s" /><div className="sk s" style={{ width: '65%' }} /><div className="sk img" /></div>
            </div>
          </div>
          <div className="box">
            <div className="lab">Ton trajet : {fmt(Pc.total)} ms au total</div>
            <div className="wf">
              {rows.map((r) => (
                <div className="wf-row" key={r.k}>
                  <span className="wf-l">{r.l}</span>
                  <span className="wf-track"><i className={'wf-bar b-' + r.k} style={{ left: r.st + '%', width: r.w + '%' }} /></span>
                  <span className="wf-v">{fmt(r.v)} ms</span>
                </div>
              ))}
            </div>
            <div className="lab" style={{ marginTop: 4 }}>Le même voyage, trois scénarios</div>
            <div className="cmp">
              {res.map(([l, p], i) => (
                <div className={'cmp-row' + (i === cur ? ' on' : '')} key={l}>
                  <div className="cmp-h"><span>{l}</span><b>{fmt(p.total)} ms</b></div>
                  <div className="cmp-bar" style={{ width: (p.total / max) * 100 + '%' }}>
                    {['dns', 'tcp', 'tls', 'http'].map((k) => <i className={'b-' + k} style={{ flex: p[k] }} key={k} />)}
                  </div>
                </div>
              ))}
            </div>
            <div className="keys">
              <span><i className="b-dns" />DNS</span><span><i className="b-tcp" />TCP</span><span><i className="b-tls" />HTTPS</span><span><i className="b-http" />Requête</span>
            </div>
            <p className="help">Un CDN avec copie en cache fait gagner environ <b>{fmt(gain)} ms</b> sur ce trajet, à cette distance.</p>
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={() => setOpt({ cdn: false })}>Refaire sans CDN</button>
          </div>
        </>
      );
    }
    return null;
  }

  /* ------------------------------ écrans ------------------------------ */

  function Welcome() {
    return (
      <>
        <div className="kicker"><span className="chnum"><Icon name="flag" /></span>Bienvenue</div>
        <h2>Comment fonctionne Internet ?</h2>
        <p className="lead">Cette leçon t'emmène pas à pas, dans l'ordre, sans rien supposer que tu connaisses déjà. Voici comment ça se passe :</p>
        <ol className="welcome-list">
          <li><span className="num">1</span><span>À chaque étape, je te pose d'abord une petite question pour voir ce que tu devines.</span></li>
          <li><span className="num">2</span><span>Puis je t'explique ce qui se passe vraiment, avec une animation sur le schéma à côté.</span></li>
          <li><span className="num">3</span><span>Tu peux ensuite essayer par toi-même en changeant des réglages.</span></li>
          <li><span className="num">4</span><span>Et je vérifie avec toi que c'est bien clair, avant de passer à la suite.</span></li>
        </ol>
        <p className="help">Prends ton temps : rien n'avance tant que tu n'as pas cliqué sur « Continuer ».</p>
      </>
    );
  }
  function Predict({ ch }) {
    const c = chapters[ch], Q = c.predict, st = predict[ch] || { wrong: [], solved: false, first: null };
    return (
      <>
        <div className="kicker"><span className="chnum"><Icon name="help" /></span>Étape {ch + 1} sur 6 · à ton avis</div>
        <h2>{c.title}</h2>
        <div className="box">
          <div className="quiz">
            <p className="tagline">Avant de voir la réponse…</p>
            <p className="q">{Q.q}</p>
            {Q.opts.map((o, i) => {
              const right = st.solved && i === Q.a, wrong = st.wrong.includes(i);
              return <button key={i} type="button" className={'opt' + (right ? ' right' : '') + (wrong ? ' wrong' : '')} disabled={st.solved || wrong} onClick={() => answerPredict(ch, i)}>{o}</button>;
            })}
            {st.solved && <p className="why neutral"><b>{st.first ? 'Bonne intuition !' : 'Voyons voir…'}</b> {Q.why}</p>}
          </div>
        </div>
        {!st.solved && <p className="help">Choisis une réponse — il n'y a rien à perdre, c'est juste pour éveiller ta curiosité.</p>}
      </>
    );
  }
  function Explain({ ch }) {
    const c = chapters[ch];
    return (
      <>
        <div className="kicker"><span className="chnum"><Icon name={STEPS[ch].icon} /></span>Étape {ch + 1} sur 6 · explication</div>
        <h2>{c.title}</h2>
        <p className="gist">{c.gist}</p>
        <p className="lead">{c.lead}</p>
        <div className="analogy"><Icon name="spark" /><p><b>L'image à retenir.</b> {c.analogy}</p></div>
        {c.note && <p className="note">{c.note}</p>}
        <p className="help">Regarde le schéma à côté : l'animation se joue automatiquement.</p>
      </>
    );
  }
  function Try({ ch }) {
    const c = chapters[ch];
    return (
      <>
        <div className="kicker"><span className="chnum"><Icon name="spark" /></span>Étape {ch + 1} sur 6 · à toi d'essayer</div>
        <h2>Essaie par toi-même</h2>
        <p className="lead">Change le réglage ci-dessous : le schéma et les temps se mettent à jour, et l'animation se rejoue.</p>
        {renderWidget(c.widget)}
      </>
    );
  }
  function Check({ ch }) {
    const c = chapters[ch], Q = c.quiz, st = quiz[ch] || { wrong: [], solved: false, first: null };
    return (
      <>
        <div className="kicker"><span className="chnum"><Icon name="check" /></span>Étape {ch + 1} sur 6 · vérifions</div>
        <h2>As-tu bien suivi ?</h2>
        <div className="box">
          <div className="quiz">
            <p className="q">{Q.q}</p>
            {Q.opts.map((o, i) => {
              const right = st.solved && i === Q.a, wrong = st.wrong.includes(i);
              return <button key={i} type="button" className={'opt' + (right ? ' right' : '') + (wrong ? ' wrong' : '')} disabled={st.solved || wrong} onClick={() => answerCheck(ch, i)}>{o}</button>;
            })}
            {st.solved && <p className="why ok"><b>{st.first ? 'Bien vu.' : 'Voilà.'}</b> {Q.why}</p>}
            {!st.solved && st.wrong.length > 0 && <p className="why bad"><b>Pas tout à fait.</b> Relis l'explication et réessaie.</p>}
          </div>
        </div>
      </>
    );
  }
  function Recap() {
    const c = chapters[5];
    return (
      <>
        <div className="kicker"><span className="chnum"><Icon name="window" /></span>Étape 6 sur 6 · bilan</div>
        <h2>{c.title}</h2>
        <p className="gist">{c.gist}</p>
        <p className="lead">{c.lead}</p>
        <div className="analogy"><Icon name="spark" /><p><b>L'image à retenir.</b> {c.analogy}</p></div>
        {renderWidget('recap')}
      </>
    );
  }
  function Wrap() {
    return (
      <>
        <div className="kicker"><span className="chnum"><Icon name="flag" /></span>C'est fini</div>
        <h2>Tu connais maintenant le voyage d'un clic</h2>
        <p className="lead">Tu as obtenu <b>{score} bonne{score > 1 ? 's' : ''} réponse{score > 1 ? 's' : ''} sur 4</b> aux vérifications. En résumé : le <b>DNS</b> trouve l'adresse, <b>TCP</b> ouvre une ligne fiable, <b>TLS</b> la rend secrète, et le <b>CDN</b> rapproche la réponse de toi.</p>
        <p className="note">Pour aller plus loin : les navigateurs modernes anticipent souvent ces étapes avant même que tu cliques, et HTTP/3 remplace TCP par QUIC, qui fusionne poignée de main et chiffrement pour gagner un aller-retour.</p>
        <div className="actions">
          <button type="button" className="btn" onClick={() => goto(0, 0)}><Icon name="replay" />Recommencer</button>
          <button type="button" className="btn" onClick={() => goto(0, 3)}>Changer de site à suivre</button>
        </div>
      </>
    );
  }
  const SCREENS = { welcome: Welcome, predict: Predict, explain: Explain, try: Try, check: Check, recap: Recap, wrap: Wrap };
  const CurrentScreen = SCREENS[screenKind];

  /* ------------------------------ rendu du schéma ------------------------------ */

  function Scene() {
    return (
      <svg ref={svgRef} className="scene" viewBox={camBox} role="img"
        aria-label="Carte du trajet d'une requête entre ton navigateur, les serveurs DNS, le CDN et le serveur d'origine">
        <g>
          {LINKDEF.map(([a, b]) => {
            const idx = LINKDEF.findIndex(([x, y]) => x === a && y === b);
            const key = a + '|' + b;
            const st = linkState[key] || {};
            return <path key={key} data-link={key} className={'link' + (st.on ? ' on' : '') + (st.live ? ' live' : '')} d={L.paths[idx]} />;
          })}
        </g>
        <g>
          {pos.ch >= 1 && Object.entries(linkState).filter(([, v]) => v.on).map(([key]) => {
            const el = getPathEl(key);
            if (!el) return null;
            const pt = el.getPointAtLength(el.getTotalLength() / 2);
            const label = fmt(rttOf(key)) + ' ms';
            const w = label.length * 6.4 + 13;
            return (
              <g className="tag" transform={`translate(${pt.x},${pt.y})`} key={key}>
                <rect rx="8" height="17" y="-8.5" x={-w / 2} width={w} />
                <text textAnchor="middle" y="3.6">{label}</text>
              </g>
            );
          })}
        </g>
        {activeSet(pos.ch).has('spy') && (() => {
          const key = endpoint() === 'edge' ? 'you|edge' : 'you|origin';
          const el = getPathEl(key);
          if (!el) return null;
          const pt = el.getPointAtLength(el.getTotalLength() * 0.42);
          const [sx, sy] = P('spy');
          return <line className="spyline" x1={sx} y1={sy - rad('spy')} x2={pt.x} y2={pt.y} />;
        })()}
        <g>
          {['spy', 'origin', 'edge', 'auth', 'tld', 'root', 'resolver', 'you'].map((id) => {
            const [x, y] = P(id);
            const r = rad(id);
            const d = NODEDEF[id];
            const st = nodeState[id] || {};
            return (
              <g key={id} className={'node' + (st.dim ? ' dim' : '') + (st.hot ? ' hot' : '') + (st.bad ? ' bad' : '')}
                transform={`translate(${x},${y})`} tabIndex={0} role="button" style={{ '--ic': d.color }}
                aria-label={(st.label || '') + (st.sub ? ' : ' + st.sub : '')}
                onClick={() => showCaption({ type: 'self', node: id, say: d.info(tld, S.domain, S.cdn) })}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); showCaption({ type: 'self', node: id, say: d.info(tld, S.domain, S.cdn) }); } }}>
                <circle className="disk" r={r} />
                <path className="nic" transform={`translate(${-r * 0.48},${-r * 0.48}) scale(${(r * 0.96) / 24})`} d={ICONS[d.icon]} />
                <text className="lbl" y={r + 19} textAnchor="middle">{st.label}</text>
                <text className="sub" y={r + 33} textAnchor="middle">{st.sub}</text>
              </g>
            );
          })}
        </g>
        <g>
          {Object.entries(badges).map(([id, bd]) => {
            const [x, y] = P(id);
            const r = rad(id);
            const by = y - r - 20;
            const w = bd.text.length * 6.6 + 18;
            const vbw = +L.vb.split(' ')[2];
            const nx = Math.min(vbw - w / 2 - 4, Math.max(w / 2 + 4, x));
            return (
              <g className={'badge ' + (bd.tone || 'ok')} transform={`translate(${nx},${by})`} key={id}>
                <rect rx="10" height="20" y="-10" x={-w / 2} width={w} />
                <text textAnchor="middle" y="4">{bd.text}</text>
              </g>
            );
          })}
        </g>
        <g>
          {ring && (() => { const [x, y] = P(ring.id); return <circle className="ring" cx={x} cy={y} r={rad(ring.id)} style={{ stroke: ring.color || 'var(--blue)' }} />; })()}
          {timerRing && (() => {
            const [x, y] = P(timerRing.node), r = rad(timerRing.node) + 8, C = 2 * Math.PI * r, p = timerRing.p || 0;
            return <circle className="timer" cx={x} cy={y} r={r} strokeDasharray={C} strokeDashoffset={C * (1 - p)} transform={`rotate(-90 ${x} ${y})`} />;
          })()}
          {lostMark && <text className="lostx" x={lostMark.x} y={lostMark.y} textAnchor="middle">✕</text>}
        </g>
        <g>
          {packet && (
            <g className={'pkt ' + packet.kind} transform={`translate(${packet.x},${packet.y})`}>
              <circle r="16" className="halo" /><rect x="-12" y="-8" width="24" height="16" rx="5" /><path d="M-7 -3 0 3 7 -3" />
            </g>
          )}
        </g>
      </svg>
    );
  }

  /* --------------------------------- render --------------------------------- */

  return (
    <div className="ij">
      <style>{CSS}</style>
      <div className="app">
        <header className="top">
          <div className="brand">
            <h1>Le voyage d'un clic</h1>
            <p>Une petite leçon guidée, un écran à la fois — réponds, observe, essaie.</p>
          </div>
          <div className={'score' + (scoreBump % 2 ? ' bump' : '')} aria-live="polite">
            <Icon name="spark" className="ico" style={{ color: 'var(--sun)' }} />{score}/4
          </div>
        </header>

        <div className="prog">
          <div className="prog-top"><span>Étape {pos.ch + 1} sur 6</span><span>Écran {flatIndex + 1} sur {totalScreens}</span></div>
          <div className="prog-bar"><i style={{ width: ((flatIndex + 1) / totalScreens) * 100 + '%' }} /></div>
          <nav className="rail" aria-label="Les 6 grandes étapes">
            {STEPS.map((s, i) => (
              <button key={s.name} type="button" className={'pill' + (i === pos.ch ? ' cur' : '') + (i < pos.ch ? ' done' : '')}
                disabled={i > pos.ch} aria-current={i === pos.ch ? 'step' : 'false'} onClick={() => goto(i, 0)}>
                <Icon name={s.icon} />
                <span>{s.name}</span>
                <em className="ck"><Icon name="check" /></em>
              </button>
            ))}
          </nav>
        </div>

        <main className="grid">
          <section className="left" aria-label="Schéma animé">
            <div className="stage card" ref={stageRef}>
              <div className="map">
                <Scene />
                <div className="clock"><b>{fmt(clockMs)} ms</b><small>temps écoulé</small></div>
                <button type="button" className="replay" aria-label="Rejouer l'animation" title="Rejouer l'animation" disabled={explainLocked} onClick={replay}>
                  <Icon name="replay" />
                </button>
              </div>
              <div className="caption" key={captionKey}>
                {caption && (
                  caption.type === 'self' || caption.type === 'wait'
                    ? <><span className="who"><b>{nm(caption.node, tld)}</b></span><span className="say">{caption.say}</span></>
                    : <><span className="who"><b>{nm(caption.from, tld)}</b><span className="arr">→</span><b>{nm(caption.to, tld)}</b></span><span className="say">{caption.say}</span></>
                )}
              </div>
            </div>
            <div className="legend" aria-label="Légende des paquets">
              <span><i style={{ background: 'var(--blue)' }} />Requête</span>
              <span><i style={{ background: 'var(--mint)' }} />Réponse</span>
              <span><i style={{ background: 'var(--violet)' }} />Chiffré</span>
              <span><i style={{ background: 'var(--coral)' }} />Perdu</span>
            </div>
          </section>

          <section className="card">
            <div className="screen screenEnter" key={flatIndex}>
              <CurrentScreen ch={pos.ch} />
              <div className="navrow">
                <button type="button" className="btn ghost" disabled={isFirst} onClick={prev}><Icon name="arrowL" />Précédent</button>
                <span className="spacer" />
                {!isLast && (
                  <button type="button" className="btn primary" disabled={screenKind === 'explain' && explainLocked} onClick={next}>
                    {screenKind === 'welcome' ? 'Commencer' : 'Continuer'}<Icon name="arrowR" />
                  </button>
                )}
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}