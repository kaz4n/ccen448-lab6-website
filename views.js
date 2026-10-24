const os = require('os');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') : 'never');

// Escape first, then turn the markers ts_headline put around matches into <mark>.
const highlight = (s) => esc(s).replace(/@@HL@@/g, '<mark>').replace(/@@\/HL@@/g, '</mark>');

const qs = (params) => {
  const u = new URLSearchParams();
  for (const [k, val] of Object.entries(params)) if (val !== '' && val != null && val !== false) u.set(k, val);
  const s = u.toString();
  return s ? '?' + s : '';
};

const render = (req, res, title, body, status = 200) =>
  res.status(status).send(layout(title, req.user, body, req.path));

function layout(title, user, body, path = '') {
  const tab = (href, label) =>
    `<a href="${href}"${path === href || (href === '/' && path.startsWith('/entries')) ? ' class="on"' : ''}>${label}</a>`;
  const tabs = user
    ? `<div class="tabs"><div class="wrap">
        ${tab('/', 'Entries')}${tab('/dashboard', 'Dashboard')}${tab('/progress', 'Lab progress')}${tab('/account', 'Account')}${
        user.role === 'admin' ? tab('/admin', 'Admin') : ''}
       </div></div>`
    : '';
  const nav = user
    ? `<span>Signed in as <strong>${esc(user.username)}</strong>${user.role === 'admin' ? ' (admin)' : ''}</span>
       <form method="post" action="/logout"><button class="link">Sign out</button></form>`
    : `<a href="/login">Sign in</a><a href="/register">Register</a>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - Lab Notebook</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<header>
  <div class="wrap bar">
    <div class="brand">
      <span class="uni">Khalifa University</span>
      <a href="/" class="app">CCEN 448 Lab Notebook</a>
    </div>
    <nav>${nav}</nav>
  </div>
</header>
${tabs}
<main class="wrap">
${body}
</main>
<footer>
  <div class="wrap">Served by <code>${esc(os.hostname())}</code> &middot; <a href="/status">status</a></div>
</footer>
</body>
</html>`;
}

// ---------- sign in / register ----------

function authPage(mode, error, username = '') {
  const login = mode === 'login';
  return `
<section class="narrow">
  <h1>${login ? 'Sign in' : 'Create an account'}</h1>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  <form method="post" action="/${mode}">
    <label>Username
      <input name="username" value="${esc(username)}" required autofocus
             autocomplete="username" pattern="[a-z0-9_]{3,32}"
             title="3 to 32 characters: lowercase letters, digits, underscore">
    </label>
    <label>Password
      <input name="password" type="password" required minlength="8"
             autocomplete="${login ? 'current-password' : 'new-password'}">
    </label>
    <button>${login ? 'Sign in' : 'Register'}</button>
  </form>
  <p class="hint">${login
    ? 'No account yet? <a href="/register">Register</a>.'
    : 'Password needs at least 8 characters. Already registered? <a href="/login">Sign in</a>.'}</p>
</section>`;
}

// ---------- entries ----------

function labOptions(selected, blank = 'General') {
  let out = `<option value="">${blank}</option>`;
  for (let n = 1; n <= 10; n++) out += `<option value="${n}"${Number(selected) === n ? ' selected' : ''}>Lab ${n}</option>`;
  return out;
}

function entryForm(action, entry = {}, button = 'Save entry') {
  return `
<form method="post" action="${action}" class="entry-form">
  <div class="row">
    <label class="grow">Title
      <input name="title" value="${esc(entry.title)}" required maxlength="120">
    </label>
    <label>Lab
      <select name="lab">${labOptions(entry.lab)}</select>
    </label>
  </div>
  <label>Notes
    <textarea name="body" rows="6" maxlength="5000">${esc(entry.body)}</textarea>
  </label>
  <label>Tags <span class="opt">comma separated, up to 8</span>
    <input name="tags" value="${esc((entry.tags || []).join(', '))}" maxlength="120" placeholder="opentofu, lightsail, ssh">
  </label>
  <button>${button}</button>
</form>`;
}

function entriesPage({ entries, tags, q, tag, lab, page, pages, total, highlighted }) {
  const filtered = Boolean(q || tag || lab);
  const base = { q, tag, lab: lab || '' };

  const rows = entries
    .map(
      (e) => `
    <tr>
      <td class="lab">${e.lab ? 'Lab ' + e.lab : '-'}</td>
      <td>
        <div class="title">${esc(e.title)}</div>
        ${e.excerpt ? `<div class="body">${highlighted ? highlight(e.excerpt) : esc(e.excerpt)}${!highlighted && e.excerpt.length >= 300 ? '...' : ''}</div>` : ''}
        ${e.tags.length ? `<div class="tags">${e.tags.map((t) => `<a href="/${qs({ tag: t })}">${esc(t)}</a>`).join('')}</div>` : ''}
      </td>
      <td class="when">${fmt(e.created_at)}</td>
      <td class="act">
        <a href="/entries/${e.id}/edit">Edit</a>
        <form method="post" action="/entries/${e.id}/delete" onsubmit="return confirm('Delete this entry?')">
          <button class="link danger">Delete</button>
        </form>
      </td>
    </tr>`
    )
    .join('');

  const pager =
    pages > 1
      ? `<nav class="pager">
      ${page > 1 ? `<a href="/${qs({ ...base, page: page - 1 })}">Previous</a>` : '<span>Previous</span>'}
      <span>Page ${page} of ${pages}</span>
      ${page < pages ? `<a href="/${qs({ ...base, page: page + 1 })}">Next</a>` : '<span>Next</span>'}
    </nav>`
      : '';

  return `
<div class="head">
  <h1>Your entries</h1>
  <a href="/export.csv" class="export">Download CSV</a>
</div>
<details class="new" ${total || filtered ? '' : 'open'}>
  <summary>New entry</summary>
  ${entryForm('/entries')}
</details>

<form method="get" action="/" class="search">
  <input name="q" value="${esc(q)}" placeholder="Search titles and notes" maxlength="100">
  <select name="lab" aria-label="Lab">${labOptions(lab, 'All labs')}</select>
  ${tag ? `<input type="hidden" name="tag" value="${esc(tag)}">` : ''}
  <button>Search</button>
  ${filtered ? '<a href="/">Clear</a>' : ''}
</form>

${tags.length
    ? `<p class="tagbar">Tags: ${tags
        .map((t) => `<a href="/${qs({ ...base, tag: t.tag })}"${t.tag === tag ? ' class="on"' : ''}>${esc(t.tag)} <small>${t.n}</small></a>`)
        .join('')}</p>`
    : ''}
${filtered ? `<p class="hint">${total} result${total === 1 ? '' : 's'}${tag ? ` tagged <strong>${esc(tag)}</strong>` : ''}${q ? `, best matches first` : ''}.</p>` : ''}

${
  entries.length
    ? `<table>
  <thead><tr><th>Lab</th><th>Entry</th><th>Created (UTC)</th><th></th></tr></thead>
  <tbody>${rows}</tbody>
</table>
${pager}`
    : `<p class="empty">${filtered ? 'No entries match.' : 'Nothing here yet. Add your first entry above.'}</p>`
}`;
}

function editPage(entry) {
  return `
<section class="narrow wide">
  <h1>Edit entry</h1>
  ${entryForm('/entries/' + entry.id, entry, 'Update entry')}
  <p class="hint"><a href="/">Back to entries</a></p>
</section>`;
}

// ---------- charts (plain SVG, no library) ----------

function barChart(labels, values, { height = 170, unit = '' } = {}) {
  const width = 640;
  const pad = { l: 8, r: 8, t: 20, b: 24 };
  const max = Math.max(1, ...values);
  const slot = (width - pad.l - pad.r) / values.length;
  const bw = Math.min(40, slot * 0.6);
  const plotH = height - pad.t - pad.b;
  const bars = values
    .map((n, i) => {
      const h = Math.round((n / max) * plotH);
      const x = pad.l + i * slot + (slot - bw) / 2;
      const y = pad.t + plotH - h;
      return `<rect class="bar" x="${x.toFixed(1)}" y="${y}" width="${bw.toFixed(1)}" height="${h}"><title>${esc(labels[i])}: ${n}${unit}</title></rect>
      ${n ? `<text class="val" x="${(x + bw / 2).toFixed(1)}" y="${y - 5}" text-anchor="middle">${n}</text>` : ''}
      <text class="lbl" x="${(x + bw / 2).toFixed(1)}" y="${height - 7}" text-anchor="middle">${esc(labels[i])}</text>`;
    })
    .join('');
  return `<svg viewBox="0 0 ${width} ${height}" class="chart" role="img" aria-label="Bar chart">
    <line class="axis" x1="${pad.l}" y1="${pad.t + plotH}" x2="${width - pad.r}" y2="${pad.t + plotH}"/>${bars}</svg>`;
}

function dashboardPage({ totals, perLab, perDay, topTags, done, doing }) {
  const stat = (n, label) => `<div><strong>${n}</strong><span>${label}</span></div>`;
  return `
<h1>Dashboard</h1>
<div class="stats">
  ${stat(totals.entries, 'entries')}
  ${stat(totals.words, 'words written')}
  ${stat(`${totals.labs} / 10`, 'labs with notes')}
  ${stat(`${done} / 10`, 'labs marked done')}
</div>
<p class="hint">Last entry: ${fmt(totals.latest)} UTC. ${doing} lab${doing === 1 ? '' : 's'} in progress.</p>

<h2>Entries per lab</h2>
${barChart(perLab.map((r) => 'L' + r.lab), perLab.map((r) => r.n))}

<h2>Entries per day, last 14 days</h2>
${barChart(perDay.map((r) => r.day), perDay.map((r) => r.n))}

<h2>Most used tags</h2>
${topTags.length
    ? `<table class="kv narrowtable">${topTags.map((t) => `<tr><th><a href="/${qs({ tag: t.tag })}">${esc(t.tag)}</a></th><td>${t.n}</td></tr>`).join('')}</table>`
    : '<p class="empty">No tags yet.</p>'}
`;
}

// ---------- lab progress ----------

function progressPage(rows, { saved }) {
  const doneCount = rows.filter((r) => r.status === 'done').length;
  const pct = doneCount * 10;
  const select = (lab, status) =>
    `<select name="lab${lab}" aria-label="Lab ${lab} status">${['todo', 'doing', 'done']
      .map((s) => `<option value="${s}"${s === status ? ' selected' : ''}>${{ todo: 'Not started', doing: 'In progress', done: 'Done' }[s]}</option>`)
      .join('')}</select>`;
  return `
<h1>Lab progress</h1>
${saved ? '<p class="ok">Saved.</p>' : ''}
<div class="meter" aria-label="${pct}% done"><span style="width:${pct}%"></span></div>
<p class="hint">${doneCount} of 10 labs done.</p>
<form method="post" action="/progress">
  <table>
    <thead><tr><th>Lab</th><th>Status</th><th>Entries</th></tr></thead>
    <tbody>
      ${rows
        .map(
          (r) => `<tr><td class="lab">Lab ${r.lab}</td><td class="sel">${select(r.lab, r.status)}</td>
          <td>${r.entries ? `<a href="/${qs({ lab: r.lab })}">${r.entries}</a>` : '0'}</td></tr>`
        )
        .join('')}
    </tbody>
  </table>
  <p><button>Save progress</button></p>
</form>`;
}

// ---------- account ----------

function accountPage(data, user, { error, done }) {
  return `
<h1>Account</h1>
<table class="kv">
  <tr><th>Username</th><td>${esc(user.username)}</td></tr>
  <tr><th>Role</th><td>${esc(user.role)}</td></tr>
  <tr><th>Member since</th><td>${fmt(data.created_at)} UTC</td></tr>
  <tr><th>Last sign-in</th><td>${fmt(data.last_login)} UTC</td></tr>
  <tr><th>Active sessions</th><td>${data.sessions}</td></tr>
</table>

<h2>Change password</h2>
${error ? `<p class="error">${esc(error)}</p>` : ''}
${done ? '<p class="ok">Password changed. Other devices were signed out.</p>' : ''}
<form method="post" action="/account/password" class="inline-form">
  <label>Current password
    <input name="current" type="password" required autocomplete="current-password">
  </label>
  <label>New password
    <input name="next" type="password" required minlength="8" autocomplete="new-password">
  </label>
  <button>Change password</button>
</form>

<h2>Recent activity</h2>
${data.events.length
    ? `<table>
  <thead><tr><th>Event</th><th>IP address</th><th>Time (UTC)</th></tr></thead>
  <tbody>${data.events.map((e) => `<tr><td>${esc(e.event)}</td><td><code>${esc(e.ip)}</code></td><td class="when">${fmt(e.created_at)}</td></tr>`).join('')}</tbody>
</table>`
    : '<p class="empty">No activity recorded.</p>'}`;
}

// ---------- admin ----------

function adminPage({ users, events, stats }, me, msg) {
  const now = Date.now();
  return `
<h1>Administration</h1>
${msg ? `<p class="error">${esc(msg)}</p>` : ''}
<table class="kv">
  <tr><th>Database size</th><td>${esc(stats.db_size)}</td></tr>
  <tr><th>Entries stored</th><td>${stats.entries}</td></tr>
  <tr><th>Live sessions</th><td>${stats.sessions}</td></tr>
  <tr><th>Audit log rows</th><td>${stats.audit}</td></tr>
</table>

<h2>Users</h2>
<table>
  <thead><tr><th>User</th><th>Role</th><th>Entries</th><th>Last sign-in (UTC)</th><th></th></tr></thead>
  <tbody>
  ${users
    .map((u) => {
      const self = u.id === me.id;
      const locked = u.locked_until && new Date(u.locked_until).getTime() > now;
      return `<tr>
      <td>${esc(u.username)}${self ? ' <span class="hint">(you)</span>' : ''}${locked ? ' <span class="badge">locked</span>' : ''}</td>
      <td>${esc(u.role)}</td>
      <td>${u.entries}</td>
      <td class="when">${fmt(u.last_login)}</td>
      <td class="act wideact">${
        self
          ? ''
          : `<form method="post" action="/admin/users/${u.id}/role"><input type="hidden" name="role" value="${u.role === 'admin' ? 'user' : 'admin'}">
              <button class="link">${u.role === 'admin' ? 'Make user' : 'Make admin'}</button></form>
             <form method="post" action="/admin/users/${u.id}/delete" onsubmit="return confirm('Delete ${esc(u.username)} and all their entries?')">
              <button class="link danger">Delete</button></form>`
      }</td></tr>`;
    })
    .join('')}
  </tbody>
</table>

<h2>Latest audit events</h2>
<table>
  <thead><tr><th>User</th><th>Event</th><th>IP address</th><th>Time (UTC)</th></tr></thead>
  <tbody>${events
    .map((e) => `<tr><td>${esc(e.username || '-')}</td><td>${esc(e.event)}</td><td><code>${esc(e.ip)}</code></td><td class="when">${fmt(e.created_at)}</td></tr>`)
    .join('')}</tbody>
</table>`;
}

// ---------- status / errors ----------

function statusPage(info, req) {
  const row = (k, val) => `<tr><th>${esc(k)}</th><td>${val}</td></tr>`;
  return `
<h1>Status</h1>
<p class="hint">Where each part of this site is running right now.</p>
<table class="kv">
  ${row('Web server host', `<code>${esc(os.hostname())}</code>`)}
  ${row('Web server runtime', `Node.js ${esc(process.version)}, up ${Math.round(process.uptime())} s, using ${info.rssMb} MB`)}
  ${row('Memory on this machine', `${info.systemMemMb} MB`)}
  ${row('Database', `<code>${esc(info.dbVersion)}</code>`)}
  ${row('Database host', `<code>${esc(info.dbHost)}</code>`)}
  ${row('Database size', `${esc(info.dbSize)}, ${info.connections} open connection${info.connections === 1 ? '' : 's'}`)}
  ${row('Accounts / entries', `${info.users} / ${info.entries}`)}
  ${row('This request', `${esc(req.protocol)} to ${esc(req.hostname)} from ${esc(req.ip)}`)}
  ${row('X-Forwarded-Proto', `<code>${esc(req.get('x-forwarded-proto') || 'not set')}</code>`)}
</table>`;
}

function errorPage(status, message) {
  return `<section class="narrow"><h1>${status}</h1><p>${esc(message)}</p><p><a href="/">Back to start</a></p></section>`;
}

module.exports = {
  render, layout, authPage, entriesPage, editPage, dashboardPage, progressPage,
  accountPage, adminPage, statusPage, errorPage,
};
