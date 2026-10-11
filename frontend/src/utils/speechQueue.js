/**
 * The audio for one answer's spoken pieces, filled while Claude writes.
 * `add(text)` asks for a piece's audio once the piece before it has arrived
 * (so they come in order, the next made while the current one plays);
 * `close()` says no more will come. Iterate with `for await` to get each
 * piece's audio in order: it waits for pieces still to be added, ends after
 * close(), and throws if a piece could not be made. It can be iterated again
 * (Replay) and never asks for a piece twice.
 */
export function createSpeechQueue(makeAudio) {
  const requests = [];
  let closed = false;
  let waiters = [];
  let previous = Promise.resolve();
  const wake = () => {
    waiters.forEach((w) => w());
    waiters = [];
  };

  return {
    get size() {
      return requests.length;
    },
    get closed() {
      return closed;
    },
    add(text) {
      const request = previous.then(() => makeAudio(text));
      request.catch(() => {}); // the reader sees the error; don't report it twice
      previous = request;
      requests.push(request);
      wake();
    },
    close() {
      closed = true;
      wake();
    },
    async *[Symbol.asyncIterator]() {
      for (let i = 0; ; i++) {
        while (i >= requests.length) {
          if (closed) return;
          await new Promise((resolve) => waiters.push(resolve));
        }
        yield await requests[i];
      }
    },
  };
}
