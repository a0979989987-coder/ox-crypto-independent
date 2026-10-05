/* Presentation adapter, not a second radar design system.
 * Crypto remains the source of truth; no Crypto nodes/handlers are mutated.
 * IDs are namespaced before inserting the market-specific copy. */
export const radarId = id => `tw-radar-${id}`;
export function cryptoRadarPart(selector) {
  const source = document.querySelector(`#view-radar ${selector}`);
  if (!source) throw new Error(`Missing Crypto radar presentation: ${selector}`);
  const copy = source.cloneNode(true);
  for (const node of [copy, ...copy.querySelectorAll('*')]) {
    if (node.id) node.id = radarId(node.id);
    for (const attr of ['aria-controls', 'for']) {
      if (node.hasAttribute(attr)) node.setAttribute(attr, node.getAttribute(attr).split(' ').map(radarId).join(' '));
    }
  }
  return copy;
}

// Reuse the actual cascade, including its media queries and latest refinements.
// Only radar-scoped declarations are copied. Other views and markets never match.
export function attachCryptoRadarStyles(root, { summaryColumns } = {}) {
  const style = document.createElement('style');
  style.dataset.marketRadarPresentation = 'tw';
  const scope = '#market-unavailable-card.tw-radar-root .tw-chart-radar';
  const ids = new Set([...document.querySelectorAll('#view-radar [id]')].map(node => node.id));
  function selectors(text) {
    return text.split(/,(?![^()]*\))/).filter(selector => selector.includes('#view-radar') || /#(?:chart|radar-scanner-panel|screener-list)\b/.test(selector)).map(selector => {
      let result = selector.replaceAll('#view-radar', scope).replaceAll('.chart-focus', '.tw-chart-focus').replaceAll('.ox-scanner-collapsed', '.is-folded').replaceAll('[data-market="crypto"]','[data-market="tw"]');
      result = result.replace(/#([\w-]+)/g, (match, id) => ids.has(id) ? `#${radarId(id)}` : match);
      if (!result.includes(scope)) result = /^\s*body\S*\s/.test(result) ? result.replace(/^(\s*body\S*)\s+/,`$1 ${scope} `) : `${scope} ${result.trim()}`;
      return result;
    }).join(',');
  }
  function rules(list) {
    return [...list].map(rule => {
      if (rule.selectorText) {
        const selected = selectors(rule.selectorText);
        let declarations = rule.style.cssText;
        // A market without Crypto analysis fields must not reserve their tracks.
        // Keep the source proportions for the fields that are actually present.
        if (summaryColumns && rule.selectorText.includes('.market-line-card')) {
          declarations = declarations.replace(/grid-template-columns:\s*([^;]+);/g, (declaration, value) => {
            const priority = value.includes('!important') ? ' !important' : '';
            const tracks = value.replace(/\s*!important/, '').match(/minmax\([^)]*\)|repeat\([^)]*\)|[^\s]+/g) || [];
            return tracks.length > summaryColumns ? `grid-template-columns: ${tracks.slice(0, summaryColumns).join(' ')}${priority};` : declaration;
          });
        }
        return selected ? `${selected}{${declarations}}` : '';
      }
      if (rule.cssRules && (rule.conditionText || rule.name)) {
        const inner = rules(rule.cssRules);
        return inner ? `${rule.cssText.slice(0,rule.cssText.indexOf('{'))}{${inner}}` : '';
      }
      return '';
    }).join('\n');
  }
  style.textContent = [...document.styleSheets].filter(sheet => !sheet.ownerNode?.dataset?.marketRadarPresentation && !sheet.ownerNode?.dataset?.twChartStyle).map(sheet => {
    try { return rules(sheet.cssRules); } catch { return ''; }
  }).join('\n');
  root.prepend(style);
  return () => style.remove();
}
