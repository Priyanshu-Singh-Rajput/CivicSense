import os
import time
import requests
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

test_candidates = [
    "gemini-flash-latest",
    "gemini-flash-lite-latest",
    "gemini-3.5-flash",
    "gemini-3.5-flash-lite",
    "gemini-3.7-flash",
    "gemini-2.5-flash-lite",
    "gemma-4-26b-a4b-it",
    "gemma-4-31b-it"
]

print("Testing candidate models for latency & reliability:\n")

best_model = None
fastest_time = 999.0

for m in test_candidates:
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{m}:generateContent?key={api_key}"
    payload = {
        "contents": [{"parts": [{"text": "You are a classifier. Return JSON: {\"status\": \"ok\"}"}]}],
        "generationConfig": {"response_mime_type": "application/json"}
    }
    t0 = time.time()
    try:
        r = requests.post(url, json=payload, timeout=8)
        dt = time.time() - t0
        print(f"[{m}] Status: {r.status_code} in {dt:.2f}s")
        if r.status_code == 200:
            print("   Response:", r.json()['candidates'][0]['content']['parts'][0]['text'].strip())
            if dt < fastest_time:
                fastest_time = dt
                best_model = m
        else:
            print("   Error:", r.text[:100])
    except Exception as e:
        print(f"[{m}] Error/Timeout: {e}")

print(f"\n=> FASTEST & RELIABLE MODEL: {best_model} ({fastest_time:.2f}s)")
