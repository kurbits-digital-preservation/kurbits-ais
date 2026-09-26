"""
Whisper transcription microservice.
Accepts audio/video file uploads, transcribes with faster-whisper,
returns results via polling.
"""
from __future__ import annotations

import os
import uuid
import threading
import queue
from datetime import datetime, timezone
from typing import Optional
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Header, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
import tempfile

# ── Config ────────────────────────────────────────────────────────────

API_KEY      = os.environ.get('WHISPER_API_KEY', 'changeme')
DEFAULT_MODEL = os.environ.get('WHISPER_DEFAULT_MODEL', 'tiny')
MODELS_DIR   = os.environ.get('WHISPER_MODELS_DIR', 'models')

# Models available in this service instance
# Override via WHISPER_AVAILABLE_MODELS env var as comma-separated list
_available_env = os.environ.get('WHISPER_AVAILABLE_MODELS', '')
AVAILABLE_MODELS: list[str] = (
    [m.strip() for m in _available_env.split(',') if m.strip()]
    if _available_env
    else [
        'tiny', 'base', 'small', 'medium', 'large',
        'KBLab/kb-whisper-tiny',
        'KBLab/kb-whisper-small',
        'KBLab/kb-whisper-medium',
        'KBLab/kb-whisper-large',
    ]
)

# ── Job store ─────────────────────────────────────────────────────────

class Job:
    def __init__(self, job_id: str, model: str, filename: str):
        self.job_id      = job_id
        self.model       = model
        self.filename    = filename
        self.status      = 'pending'   # pending | running | done | error
        self.progress    = 0
        self.transcript  = None
        self.language    = None
        self.error       = None
        self.created_at  = datetime.now(timezone.utc).isoformat()
        self.updated_at  = self.created_at
        self.tmp_path    = None        # path to uploaded file

    def to_dict(self) -> dict:
        return {
            'job_id':     self.job_id,
            'model':      self.model,
            'filename':   self.filename,
            'status':     self.status,
            'progress':   self.progress,
            'transcript': self.transcript,
            'language':   self.language,
            'error':      self.error,
            'created_at': self.created_at,
            'updated_at': self.updated_at,
        }


jobs: dict[str, Job] = {}
job_queue: queue.Queue = queue.Queue()
jobs_lock = threading.Lock()

# ── Worker thread ─────────────────────────────────────────────────────

def _worker():
    """Single worker thread — processes one job at a time from the queue."""
    while True:
        job_id = job_queue.get()
        try:
            _process_job(job_id)
        except Exception as e:
            with jobs_lock:
                job = jobs.get(job_id)
                if job:
                    job.status = 'error'
                    job.error  = str(e)
                    job.updated_at = datetime.now(timezone.utc).isoformat()
        finally:
            job_queue.task_done()


def _process_job(job_id: str) -> None:
    from faster_whisper import WhisperModel

    with jobs_lock:
        job = jobs.get(job_id)
        if not job:
            return
        job.status   = 'running'
        job.progress = 5
        job.updated_at = datetime.now(timezone.utc).isoformat()

    try:
        # Load model — downloads on first use, cached in MODELS_DIR
        model = WhisperModel(
            job.model,
            device='cpu',
            compute_type='int8',
            download_root=MODELS_DIR,
        )

        with jobs_lock:
            job.progress = 20
            job.updated_at = datetime.now(timezone.utc).isoformat()

        segments, info = model.transcribe(
            job.tmp_path,
            beam_size=5,
            language=None,
            vad_filter=True,
        )

        with jobs_lock:
            job.progress = 30
            job.updated_at = datetime.now(timezone.utc).isoformat()

        lines = []
        segment_list = list(segments)   # consume generator
        total = len(segment_list) or 1

        for i, seg in enumerate(segment_list):
            start = _fmt_time(seg.start)
            text  = seg.text.strip()
            if text:
                lines.append(f'[{start}] {text}')
            pct = 30 + int((i + 1) / total * 65)
            with jobs_lock:
                job.progress = pct
                job.updated_at = datetime.now(timezone.utc).isoformat()

        detected = getattr(info, 'language', None)
        header   = f'[Language detected: {detected}]\n\n' if detected else ''
        transcript = header + '\n'.join(lines)

        with jobs_lock:
            job.status     = 'done'
            job.progress   = 100
            job.transcript = transcript
            job.language   = detected
            job.updated_at = datetime.now(timezone.utc).isoformat()

    finally:
        # Clean up temp file
        if job.tmp_path and os.path.exists(job.tmp_path):
            try:
                os.unlink(job.tmp_path)
            except OSError:
                pass


def _fmt_time(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f'{h:02d}:{m:02d}:{s:02d}' if h else f'{m:02d}:{s:02d}'


# ── FastAPI app ───────────────────────────────────────────────────────

app = FastAPI(title='Whisper transcription service', version='1.0.0')

# Start worker thread on startup
_worker_thread = threading.Thread(target=_worker, daemon=True)
_worker_thread.start()


def _check_key(x_api_key: Optional[str]) -> None:
    if x_api_key != API_KEY:
        raise HTTPException(status_code=401, detail='Invalid API key')


# GET /health
@app.get('/health')
def health():
    return {
        'status':           'ok',
        'queue_size':       job_queue.qsize(),
        'available_models': AVAILABLE_MODELS,
        'default_model':    DEFAULT_MODEL,
    }


# GET /models
@app.get('/models')
def list_models(x_api_key: Optional[str] = Header(default=None)):
    _check_key(x_api_key)
    return {'models': AVAILABLE_MODELS, 'default': DEFAULT_MODEL}


# POST /jobs
@app.post('/jobs', status_code=202)
async def submit_job(
    file: UploadFile = File(...),
    model: str = DEFAULT_MODEL,
    x_api_key: Optional[str] = Header(default=None),
):
    _check_key(x_api_key)

    if model not in AVAILABLE_MODELS:
        raise HTTPException(
            status_code=400,
            detail=f'Model "{model}" not available. Available: {AVAILABLE_MODELS}',
        )

    # Save upload to temp file
    suffix = Path(file.filename or 'audio').suffix or '.audio'
    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    try:
        content = await file.read()
        tmp.write(content)
        tmp.flush()
    finally:
        tmp.close()

    job_id       = str(uuid.uuid4())
    job          = Job(job_id=job_id, model=model, filename=file.filename or '')
    job.tmp_path = tmp.name

    with jobs_lock:
        jobs[job_id] = job

    job_queue.put(job_id)

    return {
        'job_id':      job_id,
        'status':      'pending',
        'queue_position': job_queue.qsize(),
    }


# GET /jobs/<id>
@app.get('/jobs/{job_id}')
def get_job(job_id: str, x_api_key: Optional[str] = Header(default=None)):
    _check_key(x_api_key)
    with jobs_lock:
        job = jobs.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail='Job not found')
    return job.to_dict()


# GET /jobs  (list recent)
@app.get('/jobs')
def list_jobs(x_api_key: Optional[str] = Header(default=None)):
    _check_key(x_api_key)
    with jobs_lock:
        all_jobs = [j.to_dict() for j in jobs.values()]
    return {
        'jobs':       sorted(all_jobs, key=lambda j: j['created_at'], reverse=True)[:50],
        'queue_size': job_queue.qsize(),
    }