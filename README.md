# Civisense — AI-Assisted Civic Complaint Management

Civisense is a lightweight, full-stack MVP built for hackathons to demonstrate automated civic complaint intake, AI classification, and authority triage.

---

## 👥 Team Roles & Responsibilities

* **Member 1 (Frontend):** UI, styling, responsiveness, modal forms, dashboard rendering, client-side filtering ([`templates/index.html`](file:///c:/Users/himan/OneDrive/AppData/CiviSense/templates/index.html), [`static/style.css`](file:///c:/Users/himan/OneDrive/AppData/CiviSense/static/style.css), [`static/script.js`](file:///c:/Users/himan/OneDrive/AppData/CiviSense/static/script.js)).
* **Member 2 (AI Integration):** Gemma prompt engineering, JSON response formatting, fallback handling, output validation ([`ai_service.py`](file:///c:/Users/himan/OneDrive/AppData/CiviSense/ai_service.py)).
* **Member 3 (Backend & Integration):** Flask API endpoints, input validation, JSON persistence, integration wiring ([`app.py`](file:///c:/Users/himan/OneDrive/AppData/CiviSense/app.py)).

---

## 🛠️ Tech Stack

* **Frontend:** HTML5, CSS3, Vanilla JavaScript (no front-end build tools needed)
* **Backend:** Python 3.10+, Flask
* **AI:** Google GenAI SDK (`google-genai`) querying Gemma / Gemini models
* **Configuration:** `python-dotenv`
* **Data Storage:** Local JSON file ([`complaints.json`](file:///c:/Users/himan/OneDrive/AppData/CiviSense/complaints.json))

---

## 🚀 Getting Started

### 1. Clone & Set Up Virtual Environment

```bash
python -m venv venv
# On Windows (PowerShell):
.\venv\Scripts\Activate.ps1
# On macOS/Linux:
source venv/bin/activate
```

### 2. Install Dependencies

```bash
pip install -r requirements.txt
```

### 3. Configure Environment Variables

Copy [`.env.example`](file:///c:/Users/himan/OneDrive/AppData/CiviSense/.env.example) to `.env`:

```bash
cp .env.example .env
```

Open `.env` and fill in your Google API key:
```env
GEMINI_API_KEY=your_actual_api_key_here
GEMMA_MODEL=gemma-2-9b-it
```

> **Security Note:** Never commit your `.env` file to version control. It is already ignored by [`.gitignore`](file:///c:/Users/himan/OneDrive/AppData/CiviSense/.gitignore).

---

## 🤖 Testing & Using the Gemma AI Service (`ai_service.py`)

Member 2 owns `ai_service.py`, which is fully decoupled and independently testable without starting the web server.

### How to Run the Independent Test Suite

```bash
python ai_service.py
```

This runs both:
1. A live or fallback trial for an overflowing drain complaint.
2. A full unit and mock test suite verifying:
   - Broken streetlight near a market
   - Hazardous pothole near a school
   - Overflowing drain near residential buildings
   - Empty description and empty location handling
   - Missing or invalid API key handling
   - API quota exhaustion (429) & network error handling
   - Malformed/non-JSON model response recovery
   - Prompt injection resistance

### AI Service Output Contract

[`ai_service.py`](file:///c:/Users/himan/OneDrive/AppData/CiviSense/ai_service.py) exposes `analyze_complaint(description, location)` which returns a standardized Python dictionary:

```python
{
  "category": "Road" | "Drainage" | "Electricity" | "Water Supply" | "Sanitation" | "Other",
  "severity": "Low" | "Medium" | "High" | "Critical",
  "department": "Suggested municipal department",
  "summary": "1-2 sentence factual summary",
  "recommended_action": "Practical next step for civic responders",
  "ai_status": "success" | "unavailable",
  "error_detail": "Error description (only present when ai_status is 'unavailable')"
}
```

### Error Handling & Safe Fallback

- When `GEMINI_API_KEY` is missing or when Google's API returns a quota/network error, the system does **not** fail or crash.
- It returns `ai_status: "unavailable"` and routes the complaint to `"Municipal Grievance Cell (Manual Triage)"` with a default recommendation for manual verification.
- **Fair Representation:** Fallback responses are never labeled as verified AI output.

---

## 🔌 API Endpoints Contract

### `GET /`
Serves the single-page citizen submission and authority triage dashboard.

### `GET /api/complaints`
Fetches all stored complaints.
- **Response:**
  ```json
  [
    {
      "id": "c-1718012345",
      "description": "Streetlight not working near the market",
      "location": "Main Market",
      "category": "Electricity",
      "severity": "High",
      "department": "Electrical Department",
      "summary": "Reported broken streetlight causing dark roadway.",
      "recommended_action": "Inspect electrical pole and replace bulb.",
      "status": "Pending",
      "ai_status": "success",
      "created_at": "2026-10-10T11:30:00Z"
    }
  ]
  ```

### `POST /api/complaints`
Submits a new civic complaint for AI classification and storage.
- **Request Body:**
  ```json
  {
    "description": "Pothole on 5th cross road causing accidents",
    "location": "5th Cross Road, Indiranagar"
  }
  ```
- **Response:**
  ```json
  {
    "success": true,
    "complaint": { ... }
  }
  ```

### `PATCH /api/complaints/<id>`
Updates the status of an existing complaint.
- **Request Body:**
  ```json
  {
    "status": "In Progress"
  }
  ```
- **Allowed Statuses:** `Pending`, `In Progress`, `Resolved`
- **Response:**
  ```json
  {
    "success": true,
    "complaint": { ... }
  }
  ```

### `GET /uploads/<filename>` *(Phase 5)*
Safely serves uploaded citizen verification images directly from the storage directory via `send_from_directory`.

### `GET /api/reverse-geocode?lat=<lat>&lon=<lon>` *(Phase 5)*
Queries OpenStreetMap Nominatim with compliant User-Agent headers to convert coordinates into human-readable street addresses with graceful fallback.

---

## 📸 Phase 5 — Photo Submission & OpenStreetMap Geolocation

Phase 5 extends Civisense with end-to-end evidence intake and automatic geographic verification:

1. **Photo Upload & Camera Support:**
   - Mobile camera capture (`capture="environment"`) and device photo picker.
   - Client and server-side validation for JPEG, PNG, and WebP up to 10MB.
   - Magic byte inspection and Pillow verification to reject disguised or corrupt files.
   - Instant preview with replace and remove options.

2. **Automatic Browser Geolocation:**
   - Obtains high-accuracy device coordinates via `navigator.geolocation.getCurrentPosition()`.
   - Records latitude, longitude, GPS accuracy in meters, and submission timestamp.
   - Robust error handling for permission denial, timeout, and insecure contexts.

3. **Leaflet & OpenStreetMap Visualization:**
   - Renders interactive Leaflet map preview with official OpenStreetMap tiles and attribution.
   - Places interactive location marker and displays coordinates.
   - Graceful tile-loading degradation warning if tiles are delayed.

4. **Nominatim Reverse Geocoding:**
   - Automatically resolves latitude and longitude into readable locality addresses.
   - Coordinates remain authoritative if reverse geocoding is unavailable.

5. **Unified Multipart Intake:**
   - Submits photo, coordinates, accuracy, and problem description in a single `multipart/form-data` transaction.
   - Saves image to isolated `uploads/` directory with collision-free UUID filenames.

---

## 🧪 Testing the Flask Backend

Run the automated backend test suite (21 automated scenarios covering Phases 1–5):

```bash
python test_backend.py
```

This verifies:
1. Application initialization and root endpoint.
2. Empty complaints list retrieval.
3. Complaint submission, AI analysis integration, and storage.
4. Input validation (empty description, missing location, malformed JSON).
5. Status update validation and 404 for nonexistent complaints.
6. Data persistence across simulated server restarts.
7. Graceful handling of AI service exceptions and fallback preservation.
8. Status progression (`Pending` -> `In Progress` -> `Resolved`).
9. Phase 5 multipart photo & coordinates report submission and physical persistence.
10. Missing photo rejection (HTTP 400).
11. Unsupported file extension rejection (HTTP 400).
12. Disguised fake image rejection via binary signature inspection (HTTP 400).
13. Out-of-bounds latitude rejection (HTTP 400) and orphaned file cleanup.
14. Out-of-bounds longitude rejection (HTTP 400).
15. Non-positive accuracy rejection (HTTP 400).
16. Reverse-geocode parameter validation.
17. Path traversal prevention on `/uploads/`.

---

## ⚠️ Storage Limitations (Prototype Notice)

`complaints.json` uses atomic file replacement (`os.replace`) to safeguard against file corruption on single-process write operations.
However, JSON file persistence is intended strictly for local development and hackathon prototypes:
- It does **not** support concurrent multi-worker write locking.
- For production workloads, migrate storage to an ACID-compliant database such as PostgreSQL or SQLite.

