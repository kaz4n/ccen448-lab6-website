const os = require('os');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const fmt = (d) => new Date(d).toISOString().slice(0, 16).replace('T', ' ');

function layout(title, user, body) {
  const nav = user
    ? `<span>Signed in as <strong>${esc(user.username)}</strong></span>
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
<main class="wrap">
${body}
</main>
<footer>
  <div class="wrap">Served by <code>${esc(os.hostname())}</code> &middot; <a href="/status">status</a></div>
</footer>
</body>
</html>`;
}

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

function labOptions(selected) {
  let out = '<option value="">General</option>';
  for (let n = 1; n <= 10; n++) {
    out += `<option value="${n}"${Number(selected) === n ? ' selected' : ''}>Lab ${n}</option>`;
  }
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
  <button>${button}</button>
</form>`;
}

function homePage(entries, q, error) {
  const rows = entries
    .map(
      (e) => `
    <tr>
      <td class="lab">${e.lab ? 'Lab ' + e.lab : '-'}</td>
      <td>
        <div class="title">${esc(e.title)}</div>
        ${e.body ? `<div class="body">${esc(e.body)}</div>` : ''}
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

  return `
<h1>Your entries</h1>
${error ? `<p class="error">${esc(error)}</p>` : ''}
<details class="new" ${entries.length ? '' : 'open'}>
  <summary>New entry</summary>
  ${entryForm('/entries')}
</details>

<form method="get" action="/" class="search">
  <input name="q" value="${esc(q)}" placeholder="Search titles and notes">
  <button>Search</button>
  ${q ? '<a href="/">Clear</a>' : ''}
</form>

${
  entries.length
    ? `<table>
  <thead><tr><th>Lab</th><th>Entry</th><th>Created (UTC)</th><th></th></tr></thead>
  <tbody>${rows}</tbody>
</table>`
    : `<p class="empty">${q ? 'No entries match that search.' : 'Nothing here yet. Add your first entry above.'}</p>`
}`;
}

function editPage(entry, error) {
  return `
<section class="narrow wide">
  <h1>Edit entry</h1>
  ${error ? `<p class="error">${esc(error)}</p>` : ''}
  ${entryForm('/entries/' + entry.id, entry, 'Update entry')}
  <p class="hint"><a href="/">Back to entries</a></p>
</section>`;
}

function statusPage(info, req) {
  const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
  return `
<h1>Status</h1>
<p class="hint">Where each part of this site is running right now.</p>
<table class="kv">
  ${row('Web server host', `<code>${esc(os.hostname())}</code>`)}
  ${row('Web server runtime', `Node.js ${esc(process.version)}, up ${Math.round(process.uptime())} s`)}
  ${row('Database', `<code>${esc(info.dbVersion)}</code>`)}
  ${row('Database host', `<code>${esc(info.dbHost)}</code>`)}
  ${row('Accounts / entries', `${info.users} / ${info.entries}`)}
  ${row('This request', `${esc(req.protocol)} to ${esc(req.hostname)} from ${esc(req.ip)}`)}
  ${row('X-Forwarded-Proto', `<code>${esc(req.get('x-forwarded-proto') || 'not set')}</code>`)}
</table>`;
}

function errorPage(status, message) {
  return `<section class="narrow"><h1>${status}</h1><p>${esc(message)}</p><p><a href="/">Back to start</a></p></section>`;
}

module.exports = { layout, authPage, homePage, editPage, statusPage, errorPage };
