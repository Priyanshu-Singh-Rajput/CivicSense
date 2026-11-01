import os
import sys
import time
import requests
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

models_to_test = [
    "gemini-2.5-flash",
    "gemini-2.0-flash",
    "gemini-1.5-flash",
    "gemini-1.5-flash-8b",
    "gemini-2.0-flash-lite",
    "gemini-3.8-flash"
]

print(f"Testing Gemini REST endpoints with key prefix: {api_key[:8]}...\n", flush=True)

for model in models_to_test:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}"
    payload = {
        "contents": [{"parts": [{"text": "Reply with only: OK"}]}]
    }
    t0 = time.time()
    try:
        r = requests.post(url, json=payload, timeout=10)
        dt = time.time() - t0
        print(f"[{model}] Status: {r.status_code} in {dt:.2f}s", flush=True)
        if r.status_code == 200:
            res_json = r.json()
            text = res_json.get('candidates', [{}])[0].get('content', {}).get('parts', [{}])[0].get('text', '')
            print(f"   -> Response: {text.strip()}", flush=True)
        else:
            print(f"   -> Error: {r.text[:120]}", flush=True)
    except Exception as e:
        dt = time.time() - t0
        print(f"[{model}] Exception after {dt:.2f}s: {e}", flush=True)

print("\nDone testing.", flush=True)
