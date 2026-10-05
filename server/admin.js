#!/usr/bin/env node
// Admin CLI — the ONLY way accounts get created (invite-only platform).
// Usage:
//   npm run admin -- create-user <email> <password> "<Display Name>" [owner|staff]
//   npm run admin -- list-users
//   npm run admin -- set-rank <email> <owner|staff|none>
//   npm run admin -- reset-password <email> <newPassword>
//   npm run admin -- rename <email> "<New Display Name>"
//   npm run admin -- delete-user <email>
import db, { init, flush } from './db.js';
import { hashPassword } from './auth.js';
import { GLOBAL_RANKS } from './model.js';

const [, , cmd, ...args] = process.argv;

// Works against the local file DB or the cloud Postgres DB (set DATABASE_URL
// to manage hosted accounts, e.g. DATABASE_URL=... npm run admin -- create-user ...)
await init();

function tagFor(displayName) {
  const taken = new Set(db.filter('users', (u) => u.displayName.toLowerCase() === displayName.toLowerCase()).map((u) => u.tag));
  for (let i = 0; i < 9999; i++) {
    const t = String(Math.floor(1 + Math.random() * 9998)).padStart(4, '0');
    if (!taken.has(t)) return t;
  }
  return '0001';
}
const colors = ['#5865F2', '#57F287', '#FEE75C', '#EB459E', '#ED4245', '#3498db', '#9b59b6', '#1abc9c'];
const pick = () => colors[Math.floor(Math.random() * colors.length)];

function findByEmail(email) {
  return db.find('users', (u) => u.email.toLowerCase() === String(email || '').toLowerCase());
}

switch (cmd) {
  case 'create-user': {
    const [email, password, displayName, rank] = args;
    if (!email || !password || !displayName) {
      console.error('Usage: create-user <email> <password> "<Display Name>" [owner|staff]');
      process.exit(1);
    }
    if (findByEmail(email)) { console.error(`✗ A user with email ${email} already exists.`); process.exit(1); }
    const globalRank = rank && GLOBAL_RANKS[rank] ? rank : null;
    const user = db.insert('users', {
      email, passwordHash: hashPassword(password), displayName,
      tag: tagFor(displayName), avatarColor: pick(), globalRank, status: 'offline', createdAt: Date.now(),
    });
    await flush();
    console.log(`✓ Created account:`);
    console.log(`   Email:    ${user.email}`);
    console.log(`   Password: ${password}`);
    console.log(`   Name:     ${user.displayName}#${user.tag}`);
    console.log(`   Rank:     ${globalRank || 'member (no global rank)'}`);
    console.log(`\n   Give the email + password to your friend — they log in with it.`);
    break;
  }
  case 'list-users': {
    const users = db.all('users');
    if (!users.length) { console.log('No users yet.'); break; }
    console.log(`${users.length} account(s):\n`);
    users.forEach((u) =>
      console.log(`  ${u.displayName}#${u.tag}  <${u.email}>  ${u.globalRank ? '['+u.globalRank.toUpperCase()+']' : ''}`));
    break;
  }
  case 'set-rank': {
    const [email, rank] = args;
    const u = findByEmail(email);
    if (!u) { console.error(`✗ No user with email ${email}`); process.exit(1); }
    const newRank = rank === 'none' ? null : (GLOBAL_RANKS[rank] ? rank : undefined);
    if (newRank === undefined) { console.error('Rank must be: owner | staff | none'); process.exit(1); }
    db.update('users', u.id, { globalRank: newRank });
    await flush();
    console.log(`✓ ${u.displayName}#${u.tag} global rank → ${newRank || 'none'}`);
    break;
  }
  case 'reset-password': {
    const [email, pw] = args;
    const u = findByEmail(email);
    if (!u || !pw) { console.error('Usage: reset-password <email> <newPassword>'); process.exit(1); }
    db.update('users', u.id, { passwordHash: hashPassword(pw) });
    await flush();
    console.log(`✓ Password reset for ${u.email}`);
    break;
  }
  case 'rename': {
    const [email, name] = args;
    const u = findByEmail(email);
    if (!u || !name) { console.error('Usage: rename <email> "<New Display Name>"'); process.exit(1); }
    db.update('users', u.id, { displayName: name, tag: tagFor(name) });
    await flush();
    console.log(`✓ Renamed to ${name}#${db.byId('users', u.id).tag}`);
    break;
  }
  case 'delete-user': {
    const [email] = args;
    const u = findByEmail(email);
    if (!u) { console.error(`✗ No user with email ${email}`); process.exit(1); }
    db.remove('users', (x) => x.id === u.id);
    db.remove('serverMembers', (m) => m.userId === u.id);
    await flush();
    console.log(`✓ Deleted ${u.email}`);
    break;
  }
  default:
    console.log(`Discord-clone admin tool

  create-user <email> <password> "<Display Name>" [owner|staff]
  list-users
  set-rank <email> <owner|staff|none>
  reset-password <email> <newPassword>
  rename <email> "<New Display Name>"
  delete-user <email>
`);
}
process.exit(0); // PG pool keeps the process alive otherwise
