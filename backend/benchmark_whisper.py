"""
benchmark_whisper.py — Benchmark faster-whisper transcription performance
comparing CPU (int8) vs. NVIDIA RTX 4050 GPU (CUDA float16 + VAD filtering).
"""
import os
import sys
import time
import subprocess
from pathlib import Path

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.resolve()))

from app.services.transcription_service import (
    register_cuda_dll_directories,
    check_cuda_available,
    get_gpu_device_name,
    get_whisper_model,
    transcribe_audio,
)

def run_benchmark():
    print("=" * 70)
    print(" ClipperForge faster-whisper Performance Benchmark")
    print("=" * 70)

    # 1. Hardware & CUDA Diagnostics
    import ctranslate2
    cuda_count = ctranslate2.get_cuda_device_count()
    cuda_ok = check_cuda_available()
    gpu_name = get_gpu_device_name()

    print(f"[*] OS: {sys.platform}")
    print(f"[*] CUDA Device Count: {cuda_count}")
    print(f"[*] CUDA Operational: {cuda_ok}")
    print(f"[*] Detected GPU: {gpu_name}")
    print("-" * 70)

    # 2. Prepare 20-second sample audio from source.mp4
    sample_video = Path("backend/storage/projects/a0f19601-9ff1-4a25-a40a-244ea8b5cd94/source.mp4")
    if not sample_video.exists():
        # Fallback search for any mp4
        candidates = list(Path("backend/storage/projects").glob("*/source.mp4"))
        for c in candidates:
            if c.stat().st_size > 100000:
                sample_video = c
                break

    benchmark_wav = Path("backend/storage/benchmark_sample_20s.wav")
    benchmark_wav.parent.mkdir(parents=True, exist_ok=True)

    print(f"[*] Extracting 30-second audio snippet with speech from {sample_video}...")
    cmd = [
        "ffmpeg", "-y",
        "-ss", "00:00:18",
        "-t", "30",
        "-i", str(sample_video),
        "-vn",
        "-c:a", "pcm_s16le",
        "-ar", "16000",
        "-ac", "1",
        str(benchmark_wav),
    ]
    subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=True)
    file_size_kb = benchmark_wav.stat().st_size / 1024
    print(f"[+] Sample WAV prepared: {benchmark_wav} ({file_size_kb:.1f} KB, duration: 30.0s)")
    print("-" * 70)

    model_size = "base"

    # --- BENCHMARK 1: CPU (int8, no VAD) ---
    print(f"[*] Testing CPU Fallback Mode (device='cpu', compute_type='int8', vad=False)...")
    t0 = time.perf_counter()
    cpu_model = get_whisper_model(model_size=model_size, force_cpu=True)
    cpu_load_time = time.perf_counter() - t0

    t1 = time.perf_counter()
    cpu_segments, cpu_info = cpu_model.transcribe(
        str(benchmark_wav),
        word_timestamps=True,
        vad_filter=False,
    )
    cpu_results = list(cpu_segments)
    cpu_transcribe_time = time.perf_counter() - t1
    print(f"[CPU] Model Load: {cpu_load_time:.2f}s | Transcribe: {cpu_transcribe_time:.2f}s | Segments: {len(cpu_results)}")
    if cpu_results:
        print(f"      Preview text: {' '.join(s.text.strip() for s in cpu_results[:3])}...")

    # --- BENCHMARK 2: GPU (CUDA float16 + VAD Filter) ---
    print(f"\n[*] Testing GPU Accelerated Mode (device='cuda', compute_type='float16', vad=True)...")
    t2 = time.perf_counter()
    gpu_model = get_whisper_model(model_size=model_size, force_cpu=False)
    gpu_load_time = time.perf_counter() - t2

    t3 = time.perf_counter()
    gpu_segments = transcribe_audio(
        benchmark_wav,
        model_size=model_size,
    )
    gpu_transcribe_time = time.perf_counter() - t3
    print(f"[GPU] Model Load: {gpu_load_time:.2f}s | Transcribe: {gpu_transcribe_time:.2f}s | Segments: {len(gpu_segments)}")
    if gpu_segments:
        print(f"      Preview text: {' '.join(s['text'].strip() for s in gpu_segments[:3])}...")

    # --- SUMMARY ---
    speedup = cpu_transcribe_time / max(gpu_transcribe_time, 0.001)
    duration = 30.0
    rtf_cpu = cpu_transcribe_time / duration
    rtf_gpu = gpu_transcribe_time / duration

    print("\n" + "=" * 70)
    print(f" BENCHMARK RESULTS SUMMARY (Audio Duration: {duration:.1f}s)")
    print("=" * 70)
    print(f"{'Metric':<28} | {'CPU (int8)':<18} | {'GPU RTX 4050 (float16)':<22}")
    print("-" * 70)
    print(f"{'Device':<28} | {'CPU':<18} | {gpu_name:<22}")
    print(f"{'Model Size':<28} | {model_size:<18} | {model_size:<22}")
    print(f"{'Compute Type':<28} | {'int8':<18} | {'float16':<22}")
    print(f"{'VAD Filter':<28} | {'Disabled':<18} | {'Enabled (500ms silence)':<22}")
    print(f"{'Transcription Time':<28} | {cpu_transcribe_time:>7.2f}s           | {gpu_transcribe_time:>7.2f}s")
    print(f"{'Real-Time Factor (RTF)':<28} | {rtf_cpu:>7.2f}x           | {rtf_gpu:>7.2f}x")
    print(f"{'Processing Speed':<28} | {1.0/rtf_cpu:>7.1f}x real-time   | {1.0/rtf_gpu:>7.1f}x real-time")
    print("-" * 70)
    print(f"[>>>] SPEEDUP: GPU RTX 4050 adalah {speedup:.2f}x LEBIH CEPAT dibanding CPU!")
    print("=" * 70)

    # Cleanup sample wav
    if benchmark_wav.exists():
        benchmark_wav.unlink()

if __name__ == "__main__":
    run_benchmark()
