import sys
sys.path.insert(0, r"c:\Users\VICTUS\New folder\CivicSenseNew")
import json
from ai_service import analyze_complaint

desc = "Large hazardous pothole on westbound lane near Metro Pillar 142. Cars are swerving abruptly."
loc = "Metro Pillar 142, Outer Ring Road"

print("Testing analyze_complaint with gemini-3.5-flash-lite...")
res = analyze_complaint(desc, loc, model_name="gemini-3.5-flash-lite")
print(json.dumps(res, indent=2))
