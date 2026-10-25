let dictionaryPromise;

export function normalizeWord(text) {
  return text.normalize('NFKC')
    .replace(/[\u00ad\u200b\ufeff]/g, '')
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[‐‑]/g, '-')
    .replace(/-\s*\r?\n\s*/g, '')
    .trim()
    .replace(/^[^a-zA-Z]+|[^a-zA-Z]+$/g, '')
    .toLowerCase();
}

export function isSingleWord(word) {
  return /^[a-z]+(?:['-][a-z]+)*$/.test(word);
}

export async function localPronunciation(text) {
  const word = normalizeWord(text);
  if (!isSingleWord(word)) return null;
  if (!dictionaryPromise) {
    dictionaryPromise = fetch(new URL('../public/dictionaries/en-US.json', import.meta.url))
      .then(response => {
        if (!response.ok) throw new Error('Cannot load local IPA dictionary');
        return response.json();
      }).catch(error => { dictionaryPromise = undefined; throw error; });
  }
  const dictionary = await dictionaryPromise;
  const ipa = Object.hasOwn(dictionary, word) ? dictionary[word] : '';
  return ipa ? {word, ipa, accent:'Anh–Mỹ', source:'ipa-dict (có sẵn trên máy)'} : null;
}

export function onlinePronunciation(entries) {
  if (!Array.isArray(entries)) return '';
  const values = entries.flatMap(entry => [entry.phonetic, ...(entry.phonetics || []).map(p => p.text)])
    .filter(value => typeof value === 'string' && value.trim());
  return [...new Set(values.map(value => value.trim()))].join(', ');
}
