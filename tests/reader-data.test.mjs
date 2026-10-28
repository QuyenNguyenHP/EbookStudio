import assert from 'node:assert/strict';
import {createReaderStore} from '../src/reader-data.js';

let remote = {revision: 0, notes: [], words: []};
const messages = [], backups = new Map();
const storage = {setItem: (key, value) => backups.set(key, value)};
const request = async (url, options = {}) => {
  if (options.method !== 'PUT') return {ok: true, json: async () => JSON.parse(JSON.stringify(remote))};
  const data = JSON.parse(options.body);
  if (data.revision !== remote.revision) return {ok: false, status: 409};
  remote = {...data, revision: remote.revision + 1};
  return {ok: true, json: async () => ({revision: remote.revision})};
};
const state = {notes: [{id: 'n1', text: 'old browser note'}], words: [{id: 'w1', text: 'book'}]};
const store = createReaderStore(state, msg => messages.push(msg), storage, request);
assert.equal(await store.load(), true);
assert.equal(remote.notes[0].text, 'old browser note');
state.notes[0].text = 'edited';
const first = store.save();
state.words = [];
const second = store.save();
assert.deepEqual(await Promise.all([first, second]), [true, true]);
assert.equal(remote.notes[0].text, 'edited');
assert.deepEqual(remote.words, []);
const fresh = {notes: [], words: [{id: 'w1', text: 'stale local copy'}]};
assert.equal(await createReaderStore(fresh, () => {}, storage, request).load(), true);
assert.deepEqual(fresh.words, []); // Deleted words must not be resurrected.
assert.equal(fresh.notes[0].text, 'edited');
remote.revision++;
state.notes = [];
assert.equal(await store.save(), false);
assert.equal(remote.notes.length, 1);
assert.equal(messages.length, 1);
assert.equal(JSON.parse(backups.get('ebookstudio-reader-recovery')).notes.length, 0);
const offline = createReaderStore(state, msg => messages.push(msg), storage, async () => {throw Error('offline');});
assert.equal(await offline.load(), false);
state.words = [{id: 'offline'}];
assert.equal(await offline.save(), false);
console.log('Reader data: migration, reload, ordered edits/deletion, conflict and offline checks passed.');
