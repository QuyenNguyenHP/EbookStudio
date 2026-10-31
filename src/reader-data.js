// Serialize writes and reject stale tabs instead of overwriting newer data.
export function itemsForDocument(items, docId) {
  if (!docId || !Array.isArray(items)) return [];
  return items.filter(item => item.docId === docId);
}

export function upsertDocumentWord(words, word, normalize, createId = () => crypto.randomUUID()) {
  const normalized = normalize(word.text);
  const existing = words.find(item => item.docId === word.docId && normalize(item.text) === normalized);
  if (existing) {
    existing.ipa = word.ipa || existing.ipa;
    existing.ipaSource = word.ipaSource || existing.ipaSource;
    existing.translation = word.translation || existing.translation;
    existing.definition = word.definition || existing.definition;
    existing.page = word.page;
    existing.book = word.book;
    return existing;
  }
  const saved = {...word, id: createId()};
  words.unshift(saved);
  return saved;
}

export function createReaderStore(state, report, storage = {setItem: (key, value) => localStorage.setItem(key, value)}, request = fetch) {
  let revision = null, lastSaved = '', queue = Promise.resolve(), blocked = false;
  const snapshot = () => JSON.stringify({notes: state.notes, words: state.words});
  const backup = data => {
    try { storage.setItem('ebookstudio-reader-recovery', data); } catch {}
  };
  async function saveSnapshot(data) {
    if (data === lastSaved) return true;
    backup(data);
    if (revision === null || blocked) {
      report('Chưa lưu được vào máy chủ. Hãy xuất ghi chú để sao lưu rồi tải lại trang.');
      return false;
    }
    try {
      const response = await request('/api/reader-data', {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({...JSON.parse(data), revision}),
      });
      if (response.status === 409) {
        blocked = true;
        throw new Error('Dữ liệu đã đổi ở tab khác. Hãy xuất thay đổi hiện tại rồi tải lại trang.');
      }
      if (!response.ok) throw new Error('Chưa lưu được vào máy chủ. Hãy thử lưu lại hoặc xuất ghi chú để sao lưu.');
      const result = await response.json();
      revision = result.revision;
      lastSaved = data;
      return true;
    } catch (error) {
      report(error.message);
      return false;
    }
  }
  return {
    async load() {
      try {
        const response = await request('/api/reader-data', {cache: 'no-store'});
        if (!response.ok) throw new Error('Không đọc được ghi chú và từ vựng từ máy chủ.');
        const data = await response.json();
        if (!Number.isInteger(data.revision) || !Array.isArray(data.notes) || !Array.isArray(data.words)) throw new Error('Dữ liệu máy chủ không hợp lệ.');
        revision = data.revision;
        if (revision === 0) return await saveSnapshot(snapshot());
        state.notes = data.notes;
        state.words = data.words;
        lastSaved = snapshot();
        return true;
      } catch (error) {
        report(`${error.message} Đang hiển thị bản trong trình duyệt; hãy tải lại trang khi máy chủ hoạt động.`);
        return false;
      }
    },
    save() {
      const data = snapshot();
      queue = queue.then(() => saveSnapshot(data));
      return queue;
    },
  };
}
