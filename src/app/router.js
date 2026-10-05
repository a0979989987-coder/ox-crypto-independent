export function createViewRouter({ selector = "[data-app-view]" } = {}) {
  return Object.freeze({
    show(viewId) {
      document.querySelectorAll(selector).forEach(node => {
        node.hidden = node.dataset.appView !== viewId;
      });
    }
  });
}
