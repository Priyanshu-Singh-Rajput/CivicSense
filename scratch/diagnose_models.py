import os
import sys
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")
print("API Key present:", bool(api_key), "Prefix:", api_key[:10] if api_key else "None")

from google import genai

client = genai.Client(api_key=api_key)

print("Listing accessible models...")
try:
    models = list(client.models.list())
    print(f"Found {len(models)} models:")
    for m in models:
        name = getattr(m, 'name', str(m))
        if 'flash' in name.lower() or 'gemma' in name.lower():
            print(" -", name)
except Exception as e:
    print("Error listing models:", type(e).__name__, e)

test_models = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-flash", "gemini-3.8-flash"]
for model in test_models:
    print(f"\nTesting generate_content with model '{model}'...")
    try:
        resp = client.models.generate_content(
            model=model,
            contents="Say 'OK'",
        )
        print(f" -> SUCCESS with {model}: {resp.text.strip()}")
        break
    except Exception as e:
        print(f" -> FAILED with {model}: {type(e).__name__} {e}")
