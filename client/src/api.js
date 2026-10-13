async function request(method, url, body) {
  const headers = { 'X-Requested-With': 'fetch' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${url}`, {
    method,
    headers,
    credentials: 'same-origin',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (res.status === 401 && !url.startsWith('/auth/')) window.dispatchEvent(new Event('tt:unauthorized'));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (url) => request('GET', url),
  post: (url, body = {}) => request('POST', url, body),
  put: (url, body = {}) => request('PUT', url, body),
  del: (url) => request('DELETE', url),
};

export const qs = (params) =>
  new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
