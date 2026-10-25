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
