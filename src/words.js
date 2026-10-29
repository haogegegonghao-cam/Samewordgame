const whitespace = /[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+/gu;
const forbidden = /[\u0000-\u0008\u000e-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/u;
export function normalizeWord(value) {
  return String(value).normalize('NFKC').replace(whitespace, ' ').replace(/^ +| +$/g, '');
}
export function validateWord(value) {
  const word = normalizeWord(value);
  if (!word) return '先写下一个词，让联想开始。';
  if ([...word].length > 24) return '让这个词短一些：最多 24 个字符。';
  if (forbidden.test(word)) return '请去掉不可见字符或控制字符。';
  return '';
}
export function formatCode(value) { return value.toUpperCase().replace(/[^A-Z2-9]/g, '').slice(0, 10); }
export function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
