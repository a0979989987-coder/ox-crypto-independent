// Bound fetch, body reads and imports, including cancellation of a departed view.
export function withDeadline(operation, milliseconds, message = '載入逾時，請重試', {signal} = {}) {
  const controller = new AbortController();
  const abortError = () => signal?.reason || new DOMException('載入已取消', 'AbortError');
  if(signal?.aborted)return Promise.reject(abortError());
  let timer, cancel;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new DOMException(message, 'TimeoutError');
      controller.abort(error); reject(error);
    }, milliseconds);
  });
  const cancelled = new Promise((_, reject) => {
    cancel = () => {const error=abortError();controller.abort(error);reject(error);};
    signal?.addEventListener('abort',cancel,{once:true});
  });
  return Promise.race([Promise.resolve().then(() => operation(controller.signal)), timeout, cancelled])
    .finally(() => {clearTimeout(timer);signal?.removeEventListener('abort',cancel);});
}
