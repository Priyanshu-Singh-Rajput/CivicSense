import os
import requests
from dotenv import load_dotenv

load_dotenv()
api_key = os.getenv("GEMINI_API_KEY")

url = f"https://generativelanguage.googleapis.com/v1beta/models?key={api_key}"
r = requests.get(url, timeout=10)
print(f"Status: {r.status_code}")
if r.status_code == 200:
    data = r.json()
    models = data.get("models", [])
    print(f"Total models available: {len(models)}")
    for m in models:
        name = m.get("name")
        methods = m.get("supportedGenerationMethods", [])
        if "generateContent" in methods:
            print(f" - {name} ({m.get('displayName')})")
else:
    print(r.text)
