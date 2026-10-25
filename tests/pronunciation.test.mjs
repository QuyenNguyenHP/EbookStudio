import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {normalizeWord, isSingleWord, localPronunciation, onlinePronunciation} from '../src/pronunciation.js';

const data = JSON.parse(await readFile(new URL('../public/dictionaries/en-US.json', import.meta.url), 'utf8'));
const originalFetch = globalThis.fetch;
let calls = 0;
globalThis.fetch = async url => {
  assert.ok(String(url).endsWith('/public/dictionaries/en-US.json'), 'IPA must use local data');
  calls++;
  if (calls === 1) throw new Error('Simulated first-load failure');
  return {ok:true, json:async () => data};
};
try {
  await assert.rejects(localPronunciation('hello'), /Simulated/);
  const words = ['the','a','is','are','hello','world','simple','book','books','read','reading','science','universe','cosmology','matter','understand','beautiful','people','because','different'];
  for (const word of words) {
    const result = await localPronunciation(word);
    assert.ok(result?.ipa, `Missing IPA: ${word}`);
    assert.equal(result.accent, 'Anh–Mỹ');
  }
  for (const [input, expected] of [['“Hello,”','hello'],['BOOKS.','books'],['don’t',"don't"],['ﬁrst','first'],['uni\u00adverse','universe'],['read-\ning','reading']]) {
    assert.equal(normalizeWord(input), expected);
    assert.ok((await localPronunciation(input))?.ipa, `Missing normalized IPA: ${input}`);
  }
  assert.equal(isSingleWord(normalizeWord('two words')), false);
  assert.equal(await localPronunciation('two words'), null);
  assert.equal(await localPronunciation('qzxnonexistentword'), null);
  assert.equal(await localPronunciation('hasOwnProperty'), null);
  assert.equal(onlinePronunciation([{phonetics:[{audio:'only.mp3'}]}, {phonetics:[{text:'/test/'}]}]), '/test/');
  assert.equal(onlinePronunciation([{phonetic:'/test/',phonetics:[{text:'/test/'}]}]), '/test/');
  assert.equal(calls, 2, 'Retry failed load once, then reuse cached dictionary');
  console.log(`PASS: ${Object.keys(data).length} entries; common words, PDF normalization, retry/cache, missing words, all API entries.`);
} finally {
  globalThis.fetch = originalFetch;
}
