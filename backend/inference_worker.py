"""
inference_worker.py
--------------------
Runs vton_engine.run_inference() in a persistent, isolated worker PROCESS
(not a thread).

The previous design used concurrent.futures.ThreadPoolExecutor with a
future.result(timeout=...) call. That cannot actually cancel running work:
Python threads can't be killed from outside, so on timeout the HTTP client
gets an error response while the thread keeps burning CPU underneath it.
With max_workers=1, every later request then queues behind that zombie
computation and also uselessly times out.

InferenceProcessManager owns one persistent worker process + a pair of
multiprocessing.Queues. On timeout it terminates the stuck worker (which
actually frees the CPU/RAM, unlike abandoning a thread) and spawns a fresh
one so the next request isn't blocked by the last one's runaway work.
"""

import multiprocessing
import queue
import logging

logger = logging.getLogger("InferenceWorker")


def _worker_main(request_queue, response_queue):
    """
    Runs in the child process. Loads the VTON engine lazily on the first
    request (not at process spawn) so worker startup/respawn is fast and
    only pays the model-load cost when actually needed.
    """
    engine = None
    while True:
        request = request_queue.get()
        if request is None:  # sentinel: shut down cleanly
            return

        request_id, person_image, garment_image, category, target_size = request
        try:
            if engine is None:
                from vton_engine import VTONInferenceEngine
                engine = VTONInferenceEngine()
            output_pil, meta = engine.run_inference(
                person_image=person_image,
                garment_image=garment_image,
                category=category,
                target_size=target_size,
            )
            response_queue.put((request_id, "ok", output_pil, meta))
        except Exception as e:
            response_queue.put((request_id, "error", str(e), None))


class InferenceProcessManager:
    """
    Not safe for concurrent calls to run() from multiple threads -- this
    app already serializes access via app.py's own inference_lock before
    calling in, so that's not needed here.
    """

    def __init__(self):
        self._ctx = multiprocessing.get_context("spawn")
        self._process = None
        self._request_queue = None
        self._response_queue = None
        self._next_id = 0
        self._spawn_worker()

    def _spawn_worker(self):
        self._request_queue = self._ctx.Queue()
        self._response_queue = self._ctx.Queue()
        self._process = self._ctx.Process(
            target=_worker_main,
            args=(self._request_queue, self._response_queue),
            daemon=True,
        )
        self._process.start()
        logger.info(f"Inference worker process started (pid={self._process.pid}).")

    def _kill_and_respawn(self):
        logger.warning(f"Terminating stuck inference worker (pid={self._process.pid}).")
        self._process.terminate()
        self._process.join(timeout=5)
        if self._process.is_alive():
            self._process.kill()
            self._process.join(timeout=5)
        self._spawn_worker()

    def run(self, person_image, garment_image, category, timeout_seconds, target_size="1024x1536"):
        """
        Returns (output_pil, meta).
        Raises TimeoutError on timeout (the stuck worker is killed and
        replaced before this returns, so the NEXT call gets a clean
        worker), or RuntimeError if the worker itself raised.
        """
        if not self._process.is_alive():
            self._spawn_worker()

        self._next_id += 1
        request_id = self._next_id
        self._request_queue.put((request_id, person_image, garment_image, category, target_size))

        try:
            resp_id, status, payload, meta = self._response_queue.get(timeout=timeout_seconds)
        except queue.Empty:
            self._kill_and_respawn()
            raise TimeoutError(f"Inference timed out after {timeout_seconds}s")

        if resp_id != request_id:
            # Shouldn't happen (queues are replaced on every respawn), but
            # don't trust a response that doesn't match what we asked for.
            self._kill_and_respawn()
            raise TimeoutError(f"Inference timed out after {timeout_seconds}s (stale response)")

        if status == "error":
            raise RuntimeError(payload)

        return payload, meta
