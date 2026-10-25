export async function listDocuments() {
  const response = await fetch('/api/library', {cache: 'no-store'});
  if (!response.ok) throw new Error(`Library API ${response.status}`);
  return (await response.json()).documents;
}

export async function getDocument(id) {
  const response = await fetch(`/api/library/file?name=${encodeURIComponent(id)}`, {cache: 'no-store'});
  if (!response.ok) throw new Error(`Document API ${response.status}`);
  const file = await response.blob();
  return {id, name: id, size: file.size, file};
}

export async function saveDocuments(files) {
  const body = new FormData();
  for (const file of files) body.append('files', file, file.name);
  const response = await fetch('/api/library', {method: 'POST', body});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || result.errors?.join('\n') || `Upload API ${response.status}`);
  return result;
}

export async function deleteDocument(id) {
  const response = await fetch(`/api/library?name=${encodeURIComponent(id)}`, {method: 'DELETE'});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Delete API ${response.status}`);
  return result;
}

export async function loadLibraryLayout() {
  const response = await fetch('/api/library/layout', {cache: 'no-store'});
  if (!response.ok) throw new Error(`Library layout API ${response.status}`);
  return response.json();
}

export async function saveLibraryLayout(layout) {
  const response = await fetch('/api/library/layout', {
    method: 'PUT',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(layout),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || `Library layout API ${response.status}`);
  return result;
}
