export const clamp = (value, min = 0, max = 100) => Math.min(max, Math.max(min, Number(value) || 0));

export const finiteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const formatPercent = (value, digits = 2) => {
  const parsed = finiteNumber(value);
  return `${parsed >= 0 ? "+" : ""}${parsed.toFixed(digits)}%`;
};

export const safeJsonParse = (value, fallback = null) => {
  try { return JSON.parse(value); } catch { return fallback; }
};

export const debounce = (fn, wait = 120) => {
  let timer = 0;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
};

export const isoDate = date => new Date(date).toISOString().slice(0, 10);
